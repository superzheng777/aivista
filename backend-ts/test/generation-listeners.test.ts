import { describe, expect, it, vi } from "vitest";
import { GenerationTaskListenerService } from "../src/generation/generation-task-listener.service.js";
import { GenerationImageTransferListenerService } from "../src/generation/generation-image-transfer-listener.service.js";

describe("generation worker listeners", () => {
  it("acks completed work and requeues transient failures", async () => {
    const generationChannel = channel();
    await new GenerationTaskListenerService({ execute: vi.fn().mockResolvedValue(true) } as never)
      .consume(message('{"eventId":11,"taskId":301,"taskVersion":0}'), generationChannel as never);
    expect(generationChannel.ack).toHaveBeenCalledOnce();
    const transferChannel = channel();
    await new GenerationImageTransferListenerService({ execute: vi.fn().mockRejectedValue(new Error("temporary")) } as never)
      .consume(message('{"outboxEventId":12,"taskId":301,"taskVersion":2}'), transferChannel as never);
    expect(transferChannel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });
});

function message(body: string) { return { content: Buffer.from(body), properties: { headers: {} } } as never; }
function channel() { return { ack: vi.fn(), nack: vi.fn() }; }
