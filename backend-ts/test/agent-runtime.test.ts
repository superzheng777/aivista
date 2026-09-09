import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { defineTool, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
  runAgentPrompt,
  type AgentRuntimeEvent,
} from "../src/agent/agent-runtime.js";
import type { AgentModelBinding } from "../src/agent/providers/bailian.js";
import { createGenerationTools, type GenerationToolRequest } from "../src/agent/tools/index.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

describe("Agent runtime", () => {
  it("runs one in-memory Pi loop and projects native lifecycle and text events", async () => {
    const { binding, faux } = await createFauxBinding();
    faux.setResponses([fauxAssistantMessage("你好，我是 AiVista。")]);
    const events: AgentRuntimeEvent[] = [];

    const result = await runAgentPrompt({
      binding,
      prompt: "你好",
      maxTurns: 20,
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ text: "你好，我是 AiVista。", turns: 1 });
    expect(events[0]).toEqual({ type: "agent_start" });
    expect(events).toContainEqual({ type: "turn_start", turn: 1 });
    expect(events).toContainEqual({ type: "text_end", contentIndex: 0, text: "你好，我是 AiVista。" });
    expect(events.at(-1)).toEqual({ type: "agent_settled" });
  });

  it("rejects a turn budget outside the configured product limit", async () => {
    const { binding } = await createFauxBinding();

    await expect(runAgentPrompt({ binding, prompt: "你好", maxTurns: 21 }))
      .rejects.toThrow("maxTurns must be an integer between 1 and 20");
  });

  it("preloads bounded database history into the in-memory Pi session with original roles", async () => {
    const { binding, faux } = await createFauxBinding();
    let rolesAndText: string[] = [];
    faux.setResponses([(context) => {
      rolesAndText = context.messages.map((message) => {
        const text = typeof message.content === "string" ? message.content
          : message.content.filter((item) => item.type === "text").map((item) => item.text).join("");
        return `${message.role}:${text}`;
      });
      return fauxAssistantMessage("继续创作。");
    }]);

    await runAgentPrompt({ binding, prompt: "把标题改成秋日特饮", maxTurns: 20, history: [
      { role: "USER", content: "制作一张饮品海报" },
      { role: "ASSISTANT", content: "海报已经生成。" },
    ] });

    expect(rolesAndText).toEqual([
      "user:制作一张饮品海报", "assistant:海报已经生成。", "user:把标题改成秋日特饮",
    ]);
  });

  it("binds injected images to their authorized Asset IDs in per-run system context", async () => {
    const { binding, faux } = await createFauxBinding();
    let systemPrompt = "";
    faux.setResponses([(context) => {
      systemPrompt = context.systemPrompt ?? "";
      return fauxAssistantMessage("已识别参考图片。");
    }]);

    await runAgentPrompt({
      binding,
      prompt: "修改参考图片",
      maxTurns: 20,
      authorizedInputAssetIds: ["101", "202"],
    });

    expect(systemPrompt).toContain("图片 1：Asset ID 101");
    expect(systemPrompt).toContain("图片 2：Asset ID 202");
    expect(systemPrompt).toContain("inputAssetIds 只能从上述 ID 中选择");
  });

  it("feeds the formal generation Tool Result into the next Pi turn", async () => {
    const { binding, faux } = await createFauxBinding();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("text_to_image", {
        prompt: "夏日饮品海报",
        aspectRatio: "3:4",
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage("海报已经生成。"),
    ]);
    const requests: GenerationToolRequest[] = [];
    const events: AgentRuntimeEvent[] = [];
    const tools = createGenerationTools({
      authorizedInputAssetIds: new Set(),
      executor: {
        async execute(_toolCallId, request) {
          requests.push(request);
          return { outcome: "SUCCEEDED", taskId: "9001", imageAssetIds: ["7001"] };
        },
      },
    });

    const result = await runAgentPrompt({
      binding,
      prompt: "生成一张夏日饮品海报",
      maxTurns: 20,
      tools,
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ text: "海报已经生成。", turns: 2 });
    expect(requests).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_start", toolName: "text_to_image",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_end", toolName: "text_to_image", isError: false,
    }));
    expect(requests[0]).toMatchObject({
      operation: "TEXT_TO_IMAGE",
      promptExtend: true,
      imageCount: 1,
    });
  });

  it("aborts without completing a turn beyond the twentieth", async () => {
    const { binding, faux } = await createFauxBinding();
    faux.setResponses(Array.from({ length: 20 }, () =>
      fauxAssistantMessage(fauxToolCall("continue_test", {}), { stopReason: "toolUse" })));
    let calls = 0;
    const tool = defineTool({
      name: "continue_test",
      label: "Continue test",
      description: "Continue the local turn-limit test.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        calls += 1;
        return { content: [{ type: "text" as const, text: "continue" }], details: {} };
      },
    });
    const turns: number[] = [];

    await expect(runAgentPrompt({
      binding,
      prompt: "continue",
      maxTurns: 20,
      tools: [tool],
      onEvent: (event) => {
        if (event.type === "turn_start") turns.push(event.turn);
      },
    })).rejects.toMatchObject({ name: "AgentTurnLimitError", maxTurns: 20 });
    expect(calls).toBe(20);
    expect(turns).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });
});

async function createFauxBinding(): Promise<{
  binding: AgentModelBinding;
  faux: ReturnType<typeof registerFauxProvider>;
}> {
  const faux = registerFauxProvider();
  cleanup.push(() => faux.unregister());
  const model = faux.getModel();
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    apiKey: "faux-key",
    api: faux.api,
    models: [{
      id: model.id,
      name: model.name,
      api: model.api,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      baseUrl: model.baseUrl,
    }],
  });
  const registered = modelRuntime.getModel(model.provider, model.id);
  if (!registered) throw new Error("Faux model registration failed");
  return { binding: { modelRuntime, model: registered }, faux };
}
