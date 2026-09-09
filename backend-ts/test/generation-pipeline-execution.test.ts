import { describe, expect, it, vi } from "vitest";
import { GenerationPipelineExecutionService } from "../src/generation/generation-pipeline-execution.service.js";
import { generationFailed } from "../src/generation/generation-completion.js";

describe("GenerationPipelineExecutionService", () => {
  it("claims the worker ledger before provider execution and commits the transferred result", async () => {
    const calls: string[] = [];
    const task = generationTask();
    const completionClient = {
      complete: vi.fn(async () => { calls.push("complete"); return { taskId: "301", status: "SUCCEEDED", taskVersion: 1, assets: [] }; }),
    };
    const state = {
      prepare: vi.fn().mockResolvedValue({ kind: "START", task }),
      markProviderCalling: vi.fn(async () => { calls.push("provider-calling"); return true; }),
      saveProvider: vi.fn(async () => { calls.push("provider-saved"); }),
      saveCompletion: vi.fn(async () => { calls.push("completion-saved"); }),
    };
    const bailian = {
      generate: vi.fn(async () => { calls.push("provider"); return { requestId: "req-1", imageUrls: ["https://provider/1"],
        declaredImageCount: 1, declaredWidth: 1024, declaredHeight: 1024, snapshot: "provider-json" }; }),
      restore: vi.fn(() => ({ requestId: "req-1", imageUrls: ["https://provider/1"], declaredImageCount: 1,
        declaredWidth: 1024, declaredHeight: 1024, snapshot: "provider-json" })),
    };
    const transfer = { transfer: vi.fn(async () => { calls.push("transfer"); return [{ sourceIndex: 0,
      objectKey: "generation/7/tasks/301/0", fileSize: 12n, width: 1024, height: 1024 }]; }) };
    const coordinator = { complete: vi.fn(() => { calls.push("notify-tool"); }) };
    const service = new GenerationPipelineExecutionService(config(), state as never, completionClient as never,
      bailian as never, transfer as never, { acquire: vi.fn().mockResolvedValue(() => undefined) } as never,
      coordinator as never);

    expect(await service.execute({ eventId: 11n, taskId: 301n, taskVersion: 0 })).toBe(true);
    expect(calls).toEqual(["provider-calling", "provider", "provider-saved", "transfer",
      "completion-saved", "complete", "notify-tool"]);
    expect(completionClient.complete).toHaveBeenCalledWith(expect.objectContaining({
      completionId: "generation-301-1", outcome: "COMPLETED", expectedImageCount: 1,
    }));
  });

  it("replays a saved completion without calling provider or OSS", async () => {
    const completion = generationFailed(301n, 1, "PROVIDER_CONNECTION_FAILED");
    const completionClient = { complete: vi.fn().mockResolvedValue({}) };
    const bailian = { generate: vi.fn(), restore: vi.fn() };
    const transfer = { transfer: vi.fn() };
    const service = new GenerationPipelineExecutionService(config(),
      { prepare: vi.fn().mockResolvedValue({ kind: "REPLAY", completion }) } as never,
      completionClient as never, bailian as never, transfer as never,
      { acquire: vi.fn() } as never, { complete: vi.fn() } as never);

    expect(await service.execute({ eventId: 11n, taskId: 301n, taskVersion: 0 })).toBe(true);
    expect(completionClient.complete).toHaveBeenCalledWith(completion);
    expect(bailian.generate).not.toHaveBeenCalled();
    expect(transfer.transfer).not.toHaveBeenCalled();
  });

  it("acks a concurrent duplicate without treating the live provider call as unknown", async () => {
    let releaseProvider!: () => void;
    const providerWait = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const task = generationTask();
    const state = { prepare: vi.fn().mockResolvedValue({ kind: "START", task }),
      markProviderCalling: vi.fn().mockResolvedValue(true), saveProvider: vi.fn(), saveCompletion: vi.fn() };
    const java = { complete: vi.fn().mockResolvedValue({}) };
    const bailian = { generate: vi.fn(async () => { await providerWait; return { requestId: "req-1",
      imageUrls: ["https://provider/1"], snapshot: "provider-json" }; }),
      restore: vi.fn(() => ({ imageUrls: ["https://provider/1"] })) };
    const transfer = { transfer: vi.fn().mockResolvedValue([{ sourceIndex: 0,
      objectKey: "generation/7/tasks/301/0", fileSize: 12n, width: 1024, height: 1024 }]) };
    const service = new GenerationPipelineExecutionService(config(), state as never, java as never, bailian as never,
      transfer as never, { acquire: vi.fn().mockResolvedValue(() => undefined) } as never,
      { complete: vi.fn() } as never);
    const command = { eventId: 11n, taskId: 301n, taskVersion: 0 };

    const first = service.execute(command);
    await vi.waitFor(() => expect(bailian.generate).toHaveBeenCalledOnce());
    expect(await service.execute(command)).toBe(true);
    expect(state.prepare).toHaveBeenCalledOnce();
    releaseProvider();
    expect(await first).toBe(true);
  });
});

function config() { return { get: vi.fn().mockReturnValue(0) } as never; }
function generationTask() {
  return { id: 301n, user_id: 7n, requested_image_count: 1, width: 1024, height: 1024 } as never;
}
