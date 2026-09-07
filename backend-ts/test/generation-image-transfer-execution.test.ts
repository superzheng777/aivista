import { describe, expect, it, vi } from "vitest";
import { GenerationImageTransferExecutionService } from "../src/generation/generation-image-transfer-execution.service.js";

describe("generation transfer execution boundary", () => {
  it("publishes transferred image metadata for Java to persist", async () => {
    const task = { id: 301n, provider_result_snapshot: "snapshot" };
    const state = { prepare: vi.fn().mockResolvedValue({ kind: "EXECUTE", task }), markStarted: vi.fn(), saveResult: vi.fn() };
    const bailian = { restore: vi.fn().mockReturnValue({ imageUrls: ["https://provider/1.png"], declaredWidth: 2048, declaredHeight: 2048 }) };
    const images = [{ sourceIndex: 0, objectKey: "users/7/tasks/301/0", fileSize: 10n, width: 2048, height: 2048 }];
    const transfer = { transfer: vi.fn().mockResolvedValue(images) }; const publisher = { publish: vi.fn() };
    const service = new GenerationImageTransferExecutionService(state as never, bailian as never, transfer as never, publisher as never);
    await expect(service.execute({ outboxEventId: 12n, taskId: 301n, taskVersion: 2 })).resolves.toBe(true);
    expect(state.saveResult).toHaveBeenCalledWith(expect.objectContaining({ phase: "TRANSFER", outcome: "SUCCEEDED",
      images: [expect.objectContaining({ fileSize: "10" })] }), expect.any(Date));
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
});
