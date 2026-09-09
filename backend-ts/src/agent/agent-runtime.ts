import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentModelBinding } from "./providers/bailian.js";
import type { ImageContent } from "@earendil-works/pi-ai";

export type AgentRuntimeEvent =
  | { type: "agent_start" }
  | { type: "turn_start"; turn: number }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_progress"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "agent_settled" };

export interface RunAgentPromptOptions {
  binding: AgentModelBinding;
  prompt: string;
  maxTurns: number;
  tools?: Array<ToolDefinition<any, any>>;
  images?: ImageContent[];
  authorizedInputAssetIds?: string[];
  history?: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
  signal?: AbortSignal;
  onEvent?: (event: AgentRuntimeEvent) => void;
}

export interface AgentPromptResult {
  text: string;
  turns: number;
}

export class AgentTurnLimitError extends Error {
  constructor(readonly maxTurns: number) {
    super(`Agent exceeded the ${maxTurns} turn limit`);
    this.name = "AgentTurnLimitError";
  }
}

export async function runAgentPrompt(options: RunAgentPromptOptions): Promise<AgentPromptResult> {
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1 || options.maxTurns > 20) {
    throw new RangeError("maxTurns must be an integer between 1 and 20");
  }
  // Keep Pi project-resource discovery independent from the shell launch directory.
  const cwd = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  let turns = 0;
  let turnLimitReached = false;
  const extension: InlineExtension = {
    name: "aivista-harness",
    hidden: true,
    factory(pi) {
      pi.on("turn_start", (event, context) => {
        if (event.turnIndex >= options.maxTurns) {
          turnLimitReached = true;
          context.abort();
          return;
        }
        turns = event.turnIndex + 1;
        options.onEvent?.({ type: "turn_start", turn: turns });
      });
      pi.on("turn_end", (event, context) => {
        if (event.turnIndex + 1 >= options.maxTurns && event.toolResults.length > 0) {
          turnLimitReached = true;
          context.abort();
        }
      });
    },
  };
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: resolve(cwd, ".pi"),
    extensionFactories: [extension],
    noExtensions: true,
    noSkills: true,
    additionalSkillPaths: [resolve(cwd, ".pi", "skills")],
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: resolve(cwd, ".pi", "SYSTEM.md"),
    appendSystemPromptOverride: (base) => [
      ...base,
      ...authorizedInputAssetContext(options.authorizedInputAssetIds ?? []),
    ],
  });
  await resourceLoader.reload();
  const tools = options.tools ?? [];
  const sessionManager = SessionManager.inMemory(cwd);
  appendHistory(sessionManager, options.history ?? [], options.binding);
  const { session } = await createAgentSession({
    cwd,
    modelRuntime: options.binding.modelRuntime,
    model: options.binding.model,
    thinkingLevel: "off",
    ...(tools.length === 0
      ? { noTools: "all" as const }
      : { tools: tools.map((tool) => tool.name), customTools: tools }),
    resourceLoader,
    sessionManager,
  });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start") options.onEvent?.({ type: "agent_start" });
    if (event.type === "agent_settled") options.onEvent?.({ type: "agent_settled" });
    if (event.type === "tool_execution_start") {
      options.onEvent?.({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName,
        args: event.args });
    }
    if (event.type === "tool_execution_update") {
      options.onEvent?.({ type: "tool_progress", toolCallId: event.toolCallId, toolName: event.toolName,
        partialResult: event.partialResult });
    }
    if (event.type === "tool_execution_end") {
      options.onEvent?.({ type: "tool_end", toolCallId: event.toolCallId, toolName: event.toolName,
        result: event.result, isError: event.isError });
    }
    if (event.type !== "message_update") return;
    const update = event.assistantMessageEvent;
    if (update.type === "text_start") {
      options.onEvent?.({ type: "text_start", contentIndex: update.contentIndex });
    } else if (update.type === "text_delta") {
      options.onEvent?.({ type: "text_delta", contentIndex: update.contentIndex, delta: update.delta });
    } else if (update.type === "text_end") {
      options.onEvent?.({ type: "text_end", contentIndex: update.contentIndex, text: update.content });
    }
  });

  const abort = () => { void session.abort(); };
  try {
    options.signal?.throwIfAborted();
    options.signal?.addEventListener("abort", abort, { once: true });
    await session.prompt(options.prompt, options.images?.length ? { images: options.images } : undefined);
    if (turnLimitReached) throw new AgentTurnLimitError(options.maxTurns);
    const text = session.getLastAssistantText()?.trim();
    if (!text) throw new Error("Agent returned an empty final response");
    return { text, turns };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}

function authorizedInputAssetContext(assetIds: string[]): string[] {
  if (assetIds.length === 0) return [];
  const entries = assetIds.map((assetId, index) => `- 图片 ${index + 1}：Asset ID ${assetId}`).join("\n");
  return [`## 本轮授权参考图片\n${entries}\n调用 image_to_image 时，inputAssetIds 只能从上述 ID 中选择，且必须原样填写。不要在面向用户的回复中展示这些内部 ID。`];
}

function appendHistory(sessionManager: SessionManager,
    history: Array<{ role: "USER" | "ASSISTANT"; content: string }>, binding: AgentModelBinding): void {
  for (const message of history) {
    if (message.role === "USER") {
      sessionManager.appendMessage({ role: "user", content: message.content, timestamp: Date.now() });
      continue;
    }
    sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: message.content }],
      api: binding.model.api, provider: binding.model.provider, model: binding.model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now() });
  }
}
