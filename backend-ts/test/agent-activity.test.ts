import { describe, expect, it } from "vitest";
import { AgentActivityCollector } from "../src/agent/agent-activity.js";

describe("AgentActivityCollector", () => {
  it("classifies text before a Tool as narration and does not expose Tool details", () => {
    const times = [new Date("2026-09-09T01:00:00Z"), new Date("2026-09-09T01:01:00Z")];
    const collector = new AgentActivityCollector(() => times.shift()!);

    expect(collector.accept({ type: "text_end", contentIndex: 0, text: " 我先整理海报布局。 " })).toEqual([]);
    expect(collector.accept({ type: "tool_start", toolCallId: "call-1", toolName: "text_to_image", args: {} }))
      .toEqual([
        expect.objectContaining({ activityKey: "narration:1", type: "NARRATION",
          state: "COMPLETED", content: "我先整理海报布局。" }),
        expect.objectContaining({ activityKey: "tool:call-1", type: "TOOL", state: "RUNNING",
          content: "正在执行文生图。" }),
      ]);
    expect(collector.accept({ type: "tool_end", toolCallId: "call-1", toolName: "text_to_image",
      result: { content: [{ type: "text", text: "private" }],
        details: { outcome: "SUCCEEDED", taskId: "9001", imageAssetIds: ["secret"] } }, isError: false }))
      .toEqual([expect.objectContaining({ activityKey: "tool:call-1", state: "COMPLETED",
        content: "文生图已完成。", generationTaskId: "9001" })]);
    expect(collector.snapshot()).toEqual([
      expect.objectContaining({ activityKey: "narration:1" }),
      expect.objectContaining({ activityKey: "tool:call-1", state: "COMPLETED" }),
    ]);
  });

  it("keeps the last assistant text out of Activity because it is the final message", () => {
    const collector = new AgentActivityCollector();
    collector.accept({ type: "text_end", contentIndex: 0, text: "这是最终回答。" });
    collector.discardFinalText();
    expect(collector.accept({ type: "agent_settled" })).toEqual([]);
  });

  it("projects a business-level Tool failure as a stable failed step", () => {
    const collector = new AgentActivityCollector(() => new Date("2026-09-09T01:00:00Z"));
    collector.accept({ type: "tool_start", toolCallId: "call-2", toolName: "image_to_image", args: {} });
    expect(collector.accept({ type: "tool_end", toolCallId: "call-2", toolName: "image_to_image",
      result: { details: { outcome: "FAILED", code: "GENERATION_FAILED", taskId: "9002" } },
      isError: false })).toEqual([expect.objectContaining({ state: "FAILED", content: "图生图未完成。",
        generationTaskId: "9002" })]);
  });

  it("persists a successfully read Skill as SKILL rather than a generic Tool", () => {
    const collector = new AgentActivityCollector(() => new Date("2026-09-09T01:00:00Z"));
    expect(collector.accept({ type: "tool_start", toolCallId: "read-1", toolName: "read",
      args: { path: "C:/app/.pi/skills/poster-design/SKILL.md" } })).toEqual([]);
    expect(collector.accept({ type: "tool_end", toolCallId: "read-1", toolName: "read",
      result: { content: [{ type: "text", text: "skill body" }] }, isError: false }))
      .toEqual([expect.objectContaining({ activityKey: "skill:poster-design", type: "SKILL",
        state: "COMPLETED", content: "已启用海报设计 Skill。" })]);
  });
});
