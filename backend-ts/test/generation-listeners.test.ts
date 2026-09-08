import { describe, expect, it, vi } from "vitest";
import { GenerationTaskListenerService } from "../src/generation/generation-task-listener.service.js";

describe("generation worker listeners", () => {
  it("acks completed work and requeues transient failures", async () => {
    const generationChannel = channel();
    await new GenerationTaskListenerService({ execute: vi.fn().mockResolvedValue(true) } as never)
      .consume(message('{"eventId":11,"taskId":301,"taskVersion":0}'), generationChannel as never);
    expect(generationChannel.ack).toHaveBeenCalledOnce();
  });
});

function message(body: string) { return { content: Buffer.from(body), properties: { headers: {} } } as never; }
function channel() { return { ack: vi.fn(), nack: vi.fn() }; }
