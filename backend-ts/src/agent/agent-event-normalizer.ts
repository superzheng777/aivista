import type { AgentRuntimeEvent } from "./agent-runtime.js";
import { selectedSkillName } from "./agent-activity.js";

export type AgentRealtimeEvent =
  | { eventType: "RUN_STARTED"; payload: Record<string, never> }
  | { eventType: "TEXT_STARTED"; payload: { contentIndex: number } }
  | { eventType: "TEXT_DELTA"; payload: { contentIndex: number; delta: string } }
  | { eventType: "TEXT_FINISHED"; payload: { contentIndex: number } }
  | { eventType: "SKILL_SELECTED"; payload: { skillName: string } }
  | { eventType: "TOOL_STARTED"; payload: { toolCallId: string; toolName: string } }
  | { eventType: "TOOL_PROGRESS"; payload: { toolCallId: string; toolName: string } }
  | { eventType: "TOOL_FINISHED"; payload: {
      toolCallId: string; toolName: string; outcome: "SUCCEEDED" | "FAILED";
    } };

export interface AgentEventNormalizerOptions {
  emit: (event: AgentRealtimeEvent) => void;
  flushAfterMs?: number;
  flushAfterCharacters?: number;
  maxDeltaBytes?: number;
}

/** Converts Pi observations into the safe transient product stream. Network metadata belongs to the transport. */
export class AgentEventNormalizer {
  private readonly flushAfterMs: number;
  private readonly flushAfterCharacters: number;
  private readonly maxDeltaBytes: number;
  private pending: { contentIndex: number; delta: string } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly skillCalls = new Map<string, string>();

  constructor(private readonly options: AgentEventNormalizerOptions) {
    this.flushAfterMs = options.flushAfterMs ?? 40;
    this.flushAfterCharacters = options.flushAfterCharacters ?? 128;
    this.maxDeltaBytes = options.maxDeltaBytes ?? 64 * 1024;
    if (this.flushAfterMs < 1 || this.flushAfterCharacters < 1 || this.maxDeltaBytes < 4) {
      throw new RangeError("Agent event flush thresholds must be positive");
    }
  }

  start(): void {
    this.options.emit({ eventType: "RUN_STARTED", payload: {} });
  }

  accept(event: AgentRuntimeEvent): void {
    switch (event.type) {
      case "text_start":
        this.flush();
        this.options.emit({ eventType: "TEXT_STARTED", payload: { contentIndex: event.contentIndex } });
        return;
      case "text_delta":
        this.acceptText(event.contentIndex, event.delta);
        return;
      case "text_end":
        this.flush();
        this.options.emit({ eventType: "TEXT_FINISHED", payload: { contentIndex: event.contentIndex } });
        return;
      case "tool_start":
        this.flush();
        {
          const skillName = selectedSkillName(event.toolName, event.args);
          if (skillName) {
            this.skillCalls.set(event.toolCallId, skillName);
            return;
          }
        }
        this.options.emit({ eventType: "TOOL_STARTED",
          payload: { toolCallId: event.toolCallId, toolName: event.toolName } });
        return;
      case "tool_progress":
        if (this.skillCalls.has(event.toolCallId)) return;
        this.flush();
        this.options.emit({ eventType: "TOOL_PROGRESS",
          payload: { toolCallId: event.toolCallId, toolName: event.toolName } });
        return;
      case "tool_end":
        this.flush();
        {
          const skillName = this.skillCalls.get(event.toolCallId);
          if (skillName) {
            this.skillCalls.delete(event.toolCallId);
            if (!event.isError && toolOutcome(event) === "SUCCEEDED") {
              this.options.emit({ eventType: "SKILL_SELECTED", payload: { skillName } });
            }
            return;
          }
        }
        this.options.emit({ eventType: "TOOL_FINISHED", payload: { toolCallId: event.toolCallId,
          toolName: event.toolName, outcome: toolOutcome(event) } });
        return;
      default:
        return;
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending?.delta) {
      for (const delta of splitUtf8(pending.delta, this.maxDeltaBytes)) {
        this.options.emit({ eventType: "TEXT_DELTA",
          payload: { contentIndex: pending.contentIndex, delta } });
      }
    }
  }

  dispose(): void {
    this.flush();
  }

  private acceptText(contentIndex: number, delta: string): void {
    if (!delta) return;
    if (this.pending && this.pending.contentIndex !== contentIndex) this.flush();
    this.pending = { contentIndex, delta: `${this.pending?.delta ?? ""}${delta}` };
    if ([...this.pending.delta].length >= this.flushAfterCharacters) {
      this.flush();
      return;
    }
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushAfterMs);
  }
}

function splitUtf8(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (chunk && bytes + characterBytes > maxBytes) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function toolOutcome(event: Extract<AgentRuntimeEvent, { type: "tool_end" }>): "SUCCEEDED" | "FAILED" {
  if (event.isError) return "FAILED";
  const result = event.result;
  if (typeof result !== "object" || result === null) return "SUCCEEDED";
  const details = Reflect.get(result, "details");
  return typeof details === "object" && details !== null && Reflect.get(details, "outcome") === "FAILED"
    ? "FAILED" : "SUCCEEDED";
}
