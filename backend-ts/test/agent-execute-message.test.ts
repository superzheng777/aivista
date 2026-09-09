import { describe, expect, it } from "vitest";
import { parseAgentExecuteMessage } from "../src/agent/agent-execute-message.js";

describe("parseAgentExecuteMessage", () => {
  it("preserves Java BIGINT identifiers", () => {
    expect(parseAgentExecuteMessage(Buffer.from(
      '{"eventId":9007199254740993,"creationTaskId":9007199254740995,"revision":0}')))
      .toEqual({ eventId: 9007199254740993n, creationTaskId: 9007199254740995n, revision: 0 });
  });
});
