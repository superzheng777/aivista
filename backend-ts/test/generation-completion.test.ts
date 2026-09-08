import { describe, expect, it } from "vitest";
import { generationCompleted, generationFailed } from "../src/generation/generation-completion.js";

describe("generation completion contract", () => {
  it("contains one final result without provider or transfer phase fields", () => {
    const completion = generationCompleted(42n, 3, "provider-request", 2,
      [{ sourceIndex: 0, objectKey: "users/1/tasks/42/0", fileSize: 9007199254740993n,
        width: 1024, height: 1024 }]);

    expect(completion).toEqual({ contractVersion: 1, completionId: "generation-42-3", taskId: "42",
      taskVersion: 3, outcome: "COMPLETED", providerRequestId: "provider-request", expectedImageCount: 2,
      images: [{ sourceIndex: 0, objectKey: "users/1/tasks/42/0", contentType: "image/png",
        fileSize: "9007199254740993", width: 1024, height: 1024 }] });
    expect("phase" in completion).toBe(false);
    expect("providerResultSnapshot" in completion).toBe(false);
  });

  it("uses a discriminated failure shape without success-only null fields", () => {
    const completion = generationFailed(42n, 3, "IMAGE_TRANSFER_FAILED");

    expect(completion).toEqual({ contractVersion: 1, completionId: "generation-42-3", taskId: "42",
      taskVersion: 3, outcome: "FAILED", failureCode: "IMAGE_TRANSFER_FAILED", providerRequestId: null });
    expect("images" in completion).toBe(false);
    expect("expectedImageCount" in completion).toBe(false);
  });
});
