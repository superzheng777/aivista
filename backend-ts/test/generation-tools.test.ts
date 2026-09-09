import { describe, expect, it, vi } from "vitest";
import { Value } from "typebox/value";
import {
  createGenerationTools,
  type GenerationToolExecutor,
  type GenerationToolRequest,
} from "../src/agent/tools/index.js";

describe("Agent generation tools", () => {
  it("defines strict and distinct text-to-image and image-to-image schemas", () => {
    const [textToImage, imageToImage] = createGenerationTools({
      executor: executorOf(),
      authorizedInputAssetIds: new Set(["101"]),
    });

    expect(textToImage?.name).toBe("text_to_image");
    expect(imageToImage?.name).toBe("image_to_image");
    expect(Value.Check(textToImage!.parameters, {
      prompt: "海边日落",
      aspectRatio: "16:9",
    })).toBe(true);
    expect(Value.Check(textToImage!.parameters, {
      prompt: "海边日落",
      aspectRatio: "2:1",
    })).toBe(false);
    expect(Value.Check(imageToImage!.parameters, {
      prompt: "改成夜景",
      aspectRatio: "1:1",
      inputAssetIds: ["101", "102", "103", "104"],
    })).toBe(false);
  });

  it("normalizes fixed Agent generation parameters before execution", async () => {
    const execute = vi.fn(async (_toolCallId: string, _request: GenerationToolRequest) => ({
      outcome: "SUCCEEDED" as const,
      taskId: "9001",
      imageAssetIds: ["7001"],
    }));
    const [textToImage] = createGenerationTools({
      executor: { execute },
      authorizedInputAssetIds: new Set(),
    });

    const result = await textToImage!.execute("call-1", {
      prompt: "  极简海报  ",
      negativePrompt: "  模糊  ",
      aspectRatio: "3:4",
    }, undefined, undefined, {} as never);

    expect(execute).toHaveBeenCalledWith("call-1", {
      operation: "TEXT_TO_IMAGE",
      prompt: "极简海报",
      negativePrompt: "模糊",
      aspectRatio: "3:4",
      inputAssetIds: [],
      promptExtend: true,
      imageCount: 1,
    }, undefined);
    expect(result.details).toMatchObject({ outcome: "SUCCEEDED", taskId: "9001" });
  });

  it("returns an actionable Tool Result without executing an unauthorized image", async () => {
    const execute = vi.fn();
    const [, imageToImage] = createGenerationTools({
      executor: { execute },
      authorizedInputAssetIds: new Set(["101"]),
    });

    const result = await imageToImage!.execute("call-2", {
      prompt: "改成蓝色",
      aspectRatio: "1:1",
      inputAssetIds: ["999"],
    }, undefined, undefined, {} as never);

    expect(execute).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(/999.*101.*重新调用/),
    });
    expect(result.details).toMatchObject({
      outcome: "FAILED",
      code: "INPUT_ASSET_NOT_AUTHORIZED",
      retryable: true,
    });
  });
});

function executorOf(): GenerationToolExecutor {
  return {
    async execute() {
      return { outcome: "SUCCEEDED", taskId: "1", imageAssetIds: ["2"] };
    },
  };
}
