import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentEventNormalizer, type AgentRealtimeEvent } from "../src/agent/agent-event-normalizer.js";

afterEach(() => vi.useRealTimers());

describe("AgentEventNormalizer", () => {
  it("projects lifecycle events without leaking tool arguments or results", () => {
    const events: AgentRealtimeEvent[] = [];
    const normalizer = new AgentEventNormalizer({ emit: (event) => events.push(event) });
    normalizer.start();
    normalizer.accept({ type: "tool_start", toolCallId: "call-1", toolName: "text_to_image",
      args: { prompt: "secret" } });
    normalizer.accept({ type: "tool_progress", toolCallId: "call-1", toolName: "text_to_image",
      partialResult: { providerSecret: "secret" } });
    normalizer.accept({ type: "tool_end", toolCallId: "call-1", toolName: "text_to_image",
      result: { content: "secret", details: { outcome: "FAILED" } }, isError: false });

    expect(events).toEqual([
      { eventType: "RUN_STARTED", payload: {} },
      { eventType: "TOOL_STARTED", payload: { toolCallId: "call-1", toolName: "text_to_image" } },
      { eventType: "TOOL_PROGRESS", payload: { toolCallId: "call-1", toolName: "text_to_image" } },
      { eventType: "TOOL_FINISHED", payload: {
        toolCallId: "call-1", toolName: "text_to_image", outcome: "FAILED",
      } },
    ]);
  });

  it("batches text at the character threshold and before semantic boundaries", () => {
    const events: AgentRealtimeEvent[] = [];
    const normalizer = new AgentEventNormalizer({ emit: (event) => events.push(event),
      flushAfterCharacters: 4 });
    normalizer.accept({ type: "text_start", contentIndex: 0 });
    normalizer.accept({ type: "text_delta", contentIndex: 0, delta: "海报" });
    normalizer.accept({ type: "text_delta", contentIndex: 0, delta: "设计" });
    normalizer.accept({ type: "text_delta", contentIndex: 0, delta: "完成" });
    normalizer.accept({ type: "text_end", contentIndex: 0, text: "海报设计完成" });

    expect(events).toEqual([
      { eventType: "TEXT_STARTED", payload: { contentIndex: 0 } },
      { eventType: "TEXT_DELTA", payload: { contentIndex: 0, delta: "海报设计" } },
      { eventType: "TEXT_DELTA", payload: { contentIndex: 0, delta: "完成" } },
      { eventType: "TEXT_FINISHED", payload: { contentIndex: 0 } },
    ]);
  });

  it("flushes a short delta after 40ms and clears its timer on dispose", () => {
    vi.useFakeTimers();
    const events: AgentRealtimeEvent[] = [];
    const normalizer = new AgentEventNormalizer({ emit: (event) => events.push(event) });
    normalizer.accept({ type: "text_delta", contentIndex: 2, delta: "正在构图" });
    vi.advanceTimersByTime(39);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual([
      { eventType: "TEXT_DELTA", payload: { contentIndex: 2, delta: "正在构图" } },
    ]);
    normalizer.accept({ type: "text_delta", contentIndex: 2, delta: "。" });
    normalizer.dispose();
    vi.runAllTimers();
    expect(events).toHaveLength(2);
  });

  it("splits one oversized Pi delta on UTF-8 character boundaries", () => {
    const events: AgentRealtimeEvent[] = [];
    const normalizer = new AgentEventNormalizer({ emit: (event) => events.push(event),
      flushAfterCharacters: 1, maxDeltaBytes: 6 });
    normalizer.accept({ type: "text_delta", contentIndex: 0, delta: "图像生成" });

    expect(events).toEqual([
      { eventType: "TEXT_DELTA", payload: { contentIndex: 0, delta: "图像" } },
      { eventType: "TEXT_DELTA", payload: { contentIndex: 0, delta: "生成" } },
    ]);
  });

  it("projects a successful restricted Skill read as activation instead of a technical Tool", () => {
    const events: AgentRealtimeEvent[] = [];
    const normalizer = new AgentEventNormalizer({ emit: (event) => events.push(event) });
    normalizer.accept({ type: "tool_start", toolCallId: "read-1", toolName: "read",
      args: { path: "E:/project/backend-ts/.pi/skills/poster-design/SKILL.md" } });
    normalizer.accept({ type: "tool_end", toolCallId: "read-1", toolName: "read",
      result: { content: [{ type: "text", text: "skill" }] }, isError: false });
    expect(events).toEqual([{ eventType: "SKILL_SELECTED", payload: { skillName: "poster-design" } }]);
  });
});
