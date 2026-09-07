import { describe, expect, it, vi } from "vitest";
import { GenerationTaskExecutionService } from "../src/generation/generation-task-execution.service.js";
import { BailianProviderError } from "../src/generation/generation-provider-error.js";

describe("generation task execution boundary", () => {
  it("publishes STARTED and a provider success without writing Java-owned state", async () => {
    const state = stateMock(); const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const client = { generate: vi.fn().mockResolvedValue(providerResult()) };
    const service = new GenerationTaskExecutionService(state as never, client as never,
      { acquire: vi.fn().mockResolvedValue(vi.fn()) } as never, publisher as never);
    await expect(service.execute(command())).resolves.toBe(true);
    expect(state.markProviderCallStarted).toHaveBeenCalledWith(301n, 0, expect.any(Date));
    expect(state.saveResult).toHaveBeenCalledWith(expect.objectContaining({ phase: "PROVIDER", outcome: "SUCCEEDED" }), expect.any(Date));
    expect(publisher.publish.mock.calls.map((call) => call[0].outcome)).toEqual(["STARTED", "SUCCEEDED"]);
  });

  it("maps provider rejection to a stable failed result for Java", async () => {
    const state = stateMock(); const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const client = { generate: vi.fn().mockRejectedValue(new BailianProviderError(429, "Throttling", "req-2", "slow")) };
    const service = new GenerationTaskExecutionService(state as never, client as never,
      { acquire: vi.fn().mockResolvedValue(vi.fn()) } as never, publisher as never);
    await service.execute(command());
    expect(state.saveResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: "FAILED",
      failureCode: "PROVIDER_RATE_LIMITED", providerRequestId: "req-2" }), expect.any(Date));
  });
});

function stateMock() { return { prepare: vi.fn().mockResolvedValue({ kind: "EXECUTE", task: { id: 301n } }),
  markProviderCallStarted: vi.fn().mockResolvedValue(true), saveResult: vi.fn().mockResolvedValue(undefined) }; }
function command() { return { eventId: 11n, taskId: 301n, taskVersion: 0 }; }
function providerResult() { return { requestId: "req-1", imageUrls: ["https://provider/1.png"], declaredImageCount: 1,
  declaredWidth: 2048, declaredHeight: 2048, snapshot: "{}" }; }
