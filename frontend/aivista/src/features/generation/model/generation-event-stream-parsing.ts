import type { GenerationTaskStatus, PublicationReviewStatus } from "@/entities/generation/model/generation";

export type GenerationStreamStatus = "DISCONNECTED" | "CONNECTING" | "SYNCING" | "READY" | "RECONNECTING";

export type GenerationTaskUpdateEvent = {
  sessionId: string;
  taskId: string;
  taskVersion: number;
  status: GenerationTaskStatus;
  retryCount: number;
  maxRetryCount: number;
};

export type PublicationStatusUpdateEvent = {
  imageId: string;
  publicationVersion: number;
  status: PublicationReviewStatus;
  publicAt: string | null;
};

export type GenerationSessionIndicator = "ACTIVE" | "COMPLETED" | "ATTENTION";

export type AgentRealtimeEvent = {
  creationTaskId: string;
  sessionId: string;
  revision: number;
  streamId: string;
  sequence: number;
  eventType: "RUN_STARTED" | "TEXT_STARTED" | "TEXT_DELTA" | "TEXT_FINISHED"
    | "SKILL_SELECTED" | "TOOL_STARTED" | "TOOL_PROGRESS" | "TOOL_FINISHED"
    | "RUN_FINISHED" | "RUN_FAILED";
  payload: Record<string, unknown>;
};

export type AgentLiveRun = { streamId: string; revision: number; sequence: number; text: string;
  tools: Array<{ toolCallId: string; toolName: string; state: "RUNNING" | "SUCCEEDED" | "FAILED" }> };

export const TASK_EVENT_NAME = "generation.task.updated";
export const PUBLICATION_EVENT_NAME = "publication.updated";
export const READY_EVENT_NAME = "generation.stream.ready";
export const INTERACTION_NOTIFICATION_EVENT_NAME = "interaction.notification.created";
export const AGENT_EVENT_NAME = "agent.creation.event";
export const MAX_RECONNECT_DELAY_MS = 3_000;

/** 发布终态：只有这些状态才允许驱动“信号 → 全量重拉”。 */
export const PUBLICATION_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["APPROVED", "REJECTED", "FAILED"]);

export function isTaskUpdateEvent(value: unknown): value is GenerationTaskUpdateEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<GenerationTaskUpdateEvent>;
  return typeof event.sessionId === "string"
    && typeof event.taskId === "string"
    && typeof event.taskVersion === "number"
    && typeof event.status === "string"
    && typeof event.retryCount === "number"
    && typeof event.maxRetryCount === "number";
}

export function isPublicationStatusUpdateEvent(value: unknown): value is PublicationStatusUpdateEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<PublicationStatusUpdateEvent>;
  if (typeof event.imageId !== "string") return false;
  if (typeof event.publicationVersion !== "number" || !Number.isSafeInteger(event.publicationVersion)) return false;
  if (typeof event.status !== "string" || !PUBLICATION_TERMINAL_STATUSES.has(event.status)) return false;
  return event.publicAt === null || typeof event.publicAt === "string";
}

export function isAgentRealtimeEvent(value: unknown): value is AgentRealtimeEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AgentRealtimeEvent>;
  return typeof event.creationTaskId === "string" && typeof event.sessionId === "string"
    && Number.isSafeInteger(event.revision) && typeof event.streamId === "string" && event.streamId.length > 0
    && Number.isSafeInteger(event.sequence) && (event.sequence ?? 0) > 0
    && typeof event.eventType === "string" && AGENT_EVENT_TYPES.has(event.eventType)
    && !!event.payload && typeof event.payload === "object" && !Array.isArray(event.payload);
}

const AGENT_EVENT_TYPES: ReadonlySet<string> = new Set(["RUN_STARTED", "TEXT_STARTED", "TEXT_DELTA",
  "TEXT_FINISHED", "SKILL_SELECTED", "TOOL_STARTED", "TOOL_PROGRESS", "TOOL_FINISHED",
  "RUN_FINISHED", "RUN_FAILED"]);

export function applyAgentRealtimeEvent(current: AgentLiveRun | undefined,
    event: AgentRealtimeEvent): AgentLiveRun {
  if (current && event.revision < current.revision) return current;
  if (current && event.streamId === current.streamId && event.sequence <= current.sequence) return current;
  const next = !current || event.streamId !== current.streamId
    ? { streamId: event.streamId, revision: event.revision, sequence: 0, text: "", tools: [] }
    : { ...current, tools: [...current.tools] };
  next.sequence = event.sequence;
  if (event.eventType === "RUN_STARTED") return { ...next, text: "", tools: [] };
  if (event.eventType === "TEXT_DELTA" && typeof event.payload.delta === "string") {
    next.text += event.payload.delta;
  }
  if (event.eventType === "TOOL_STARTED" && toolPayload(event.payload)) {
    next.tools = [...next.tools.filter((tool) => tool.toolCallId !== event.payload.toolCallId),
      { toolCallId: event.payload.toolCallId, toolName: event.payload.toolName, state: "RUNNING" }];
  }
  if (event.eventType === "TOOL_FINISHED" && toolPayload(event.payload)) {
    const state = event.payload.outcome === "FAILED" ? "FAILED" : "SUCCEEDED";
    next.tools = next.tools.map((tool) => tool.toolCallId === event.payload.toolCallId ? { ...tool, state } : tool);
  }
  return next;
}

function toolPayload(payload: Record<string, unknown>): payload is Record<string, unknown>
    & { toolCallId: string; toolName: string } {
  return typeof payload.toolCallId === "string" && typeof payload.toolName === "string";
}

export function isTerminalStatus(status: GenerationTaskStatus): boolean {
  return status === "SUCCEEDED" || status === "PARTIALLY_SUCCEEDED"
    || status === "FAILED";
}

export function parseSseBlock(block: string): { eventName: string; data: string } | null {
  let eventName = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
    if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart());
  }
  return data.length ? { eventName, data: data.join("\n") } : null;
}

export function reconnectDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
}

export async function consumeSseStream(
  response: Response,
  onReady: () => void,
  onTaskUpdate: (event: GenerationTaskUpdateEvent) => void,
  onPublicationUpdate: (event: PublicationStatusUpdateEvent) => void,
  onInteractionNotification: () => void = () => undefined,
  onAgentEvent: (event: AgentRealtimeEvent) => void = () => undefined,
): Promise<void> {
  if (!response.body) throw new Error("The event stream has no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();
    pending = (pending + decoder.decode(value, { stream: !done })).replaceAll("\r\n", "\n");
    let boundary = pending.indexOf("\n\n");
    while (boundary !== -1) {
      const parsed = parseSseBlock(pending.slice(0, boundary));
      pending = pending.slice(boundary + 2);
      boundary = pending.indexOf("\n\n");
      if (!parsed) continue;
      if (parsed.eventName === READY_EVENT_NAME) {
        onReady();
        continue;
      }
      if (parsed.eventName === INTERACTION_NOTIFICATION_EVENT_NAME) { onInteractionNotification(); continue; }
      try {
        const event: unknown = JSON.parse(parsed.data);
        if (parsed.eventName === TASK_EVENT_NAME && isTaskUpdateEvent(event)) {
          onTaskUpdate(event);
        } else if (parsed.eventName === PUBLICATION_EVENT_NAME && isPublicationStatusUpdateEvent(event)) {
          onPublicationUpdate(event);
        } else if (parsed.eventName === AGENT_EVENT_NAME && isAgentRealtimeEvent(event)) {
          onAgentEvent(event);
        }
      } catch {
        // REST reconciliation after the next connection remains authoritative.
      }
    }
    if (done) return;
  }
}
