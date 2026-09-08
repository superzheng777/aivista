import { describe, expect, it } from "vitest";
import { realtimeEventTypeFor } from "../src/agent/agent-event-contract.js";

describe("agent event contract", () => {
  it("maps Pi observations to product events", () => {
    expect(realtimeEventTypeFor("message_update.text_delta")).toBe("TEXT_DELTA");
    expect(realtimeEventTypeFor("tool_execution_start")).toBe("TOOL_STARTED");
    expect(realtimeEventTypeFor("tool_execution_end")).toBe("TOOL_FINISHED");
  });

  it("keeps run and skill events owned by the runtime or Harness", () => {
    expect(realtimeEventTypeFor("runtime.before_prompt")).toBe("RUN_STARTED");
    expect(realtimeEventTypeFor("harness.skill_activated")).toBe("SKILL_SELECTED");
    expect(realtimeEventTypeFor("runtime.completion_committed")).toBe("RUN_FINISHED");
  });
});
