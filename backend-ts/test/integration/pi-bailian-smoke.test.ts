import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentModelBinding, type AgentModelBinding } from "../../src/agent/providers/bailian.js";
import { validateEnvironment, type Environment } from "../../src/config/environment.js";

const enabled = process.env.RUN_AGENT_SMOKE === "true";
const smoke = describe.runIf(enabled);

smoke.sequential("Pi + Bailian qwen3.8-flash smoke", () => {
  let environment: Environment;
  let binding: AgentModelBinding;
  const sessions: Array<{ dispose(): void }> = [];

  beforeAll(async () => {
    environment = validateEnvironment(process.env);
    binding = await createAgentModelBinding(environment);
  });

  afterAll(() => {
    for (const session of sessions) session.dispose();
  });

  it("streams a final text response and settles once", async () => {
    const session = await createSmokeSession(binding, []);
    sessions.push(session);
    let settled = 0;
    session.subscribe((event) => { if (event.type === "agent_settled") settled += 1; });

    await session.prompt("请只用一句中文回答：你是一个图像创作助手。你是谁？");

    expect(session.getLastAssistantText()?.trim()).toBeTruthy();
    expect(settled).toBe(1);
  }, 120_000);

  it("executes a tool result and continues to a final response", async () => {
    let calls = 0;
    const tool = defineTool({
      name: "get_test_value",
      label: "Get test value",
      description: "Return the fixed test value. Use this tool when the user explicitly asks for the test value.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        calls += 1;
        return {
          content: [{ type: "text" as const, text: "测试工具执行成功，值为 42。" }],
          details: { value: 42 },
        };
      },
    });
    const session = await createSmokeSession(binding, [tool]);
    sessions.push(session);

    await session.prompt("请务必调用 get_test_value 工具，然后告诉我工具返回的值。");

    expect(calls).toBe(1);
    expect(session.getLastAssistantText()).toContain("42");
  }, 120_000);

  it.runIf(Boolean(process.env.AIVISTA_AGENT_SMOKE_IMAGE_PATH))(
    "sends a WebP ImageContent to the model",
    async () => {
      const path = resolve(process.env.AIVISTA_AGENT_SMOKE_IMAGE_PATH!);
      if (extname(path).toLowerCase() !== ".webp") throw new Error("Smoke image must be a .webp file");
      const session = await createSmokeSession(binding, []);
      sessions.push(session);

      await session.prompt("请用一句中文描述这张图片。", {
        images: [{ type: "image", data: readFileSync(path).toString("base64"), mimeType: "image/webp" }],
      });

      const text = session.getLastAssistantText()?.trim();
      const last = [...session.messages].reverse().find((message) => message.role === "assistant");
      expect(text, last?.role === "assistant"
        ? `stopReason=${last.stopReason}; error=${last.errorMessage ?? "none"}` : "No assistant message")
        .toBeTruthy();
    },
    120_000,
  );
});

async function createSmokeSession(binding: AgentModelBinding, customTools: ToolDefinition[]) {
  const cwd = resolve(process.cwd());
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: resolve(cwd, ".pi"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: resolve(cwd, ".pi", "SYSTEM.md"),
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    modelRuntime: binding.modelRuntime,
    model: binding.model,
    thinkingLevel: "off",
    tools: customTools.length > 0 ? customTools.map((tool) => tool.name) : [],
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
  });
  return session;
}
