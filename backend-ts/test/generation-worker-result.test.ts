import { describe, expect, it } from "vitest";
import { providerSucceeded, transferSucceeded } from "../src/generation/generation-worker-result.js";

describe("generation worker result v1", () => {
  it("serializes BIGINT values as decimal strings", () => {
    const provider = providerSucceeded(9223372036854775807n, 0, { requestId: "req", snapshot: "{}",
      declaredWidth: 2048, declaredHeight: 2048, imageUrls: ["https://provider/1.png"] });
    const transfer = transferSucceeded(9223372036854775807n, 2,
      [{ sourceIndex: 0, objectKey: "key", fileSize: 9007199254740993n, width: 2048, height: 2048 }], 1, 2048, 2048);
    expect(provider.taskId).toBe("9223372036854775807");
    expect(transfer.images[0]?.fileSize).toBe("9007199254740993");
    expect(() => JSON.stringify(transfer)).not.toThrow();
  });
});
