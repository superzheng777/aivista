import { describe, expect, it, vi } from "vitest";
import { AgentCommandListenerService } from "../src/agent/agent-command-listener.service.js";

describe("AgentCommandListenerService", () => {
  it("acks only after the reliable execution boundary succeeds", async () => {
    const execution = { execute: vi.fn().mockResolvedValue(true) };
    const channel = { ack: vi.fn(), nack: vi.fn() };
    const message = { content: Buffer.from('{"eventId":11,"creationTaskId":151,"revision":0}') };

    await new AgentCommandListenerService(execution as never).consume(message as never, channel as never);

    expect(execution.execute).toHaveBeenCalledWith({ eventId: 11n, creationTaskId: 151n, revision: 0 }, undefined);
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });
});
