import { describe, expect, it, vi } from "vitest";
import { GenerationProviderCallGateService } from "../src/generation/generation-provider-call-gate.service.js";

describe("generation provider call gate", () => {
  it("blocks a second call until the concurrency permit is released", async () => {
    const gate = createGate(1, 1_000_000);
    const first = await gate.acquire();
    let acquired = false;
    const secondPromise = gate.acquire().then((permit) => { acquired = true; return permit; });
    await Promise.resolve();
    expect(acquired).toBe(false);
    first();
    const second = await secondPromise;
    expect(acquired).toBe(true);
    second();
  });

  it("spaces starts according to the configured rate", async () => {
    vi.useFakeTimers();
    try {
      const gate = createGate(2, 2);
      const first = await gate.acquire();
      first();
      let started = false;
      const secondPromise = gate.acquire().then((permit) => { started = true; return permit; });
      await vi.advanceTimersByTimeAsync(499);
      expect(started).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const second = await secondPromise;
      second();
    } finally { vi.useRealTimers(); }
  });

  it("removes an aborted waiter without consuming a permit", async () => {
    const gate = createGate(1, 1_000_000);
    const first = await gate.acquire();
    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    first();
    const next = await gate.acquire();
    next();
  });
});

function createGate(concurrency: number, rate: number) {
  return new GenerationProviderCallGateService({ get: (key: string) => key.endsWith("MAX_CONCURRENT_CALLS") ? concurrency : rate } as never);
}
