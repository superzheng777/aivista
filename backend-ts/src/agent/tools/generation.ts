import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const aspectRatioSchema = Type.Union([
  Type.Literal("1:1"),
  Type.Literal("16:9"),
  Type.Literal("9:16"),
  Type.Literal("4:3"),
  Type.Literal("3:4"),
], { description: "生成图片的画幅比例。" });

const promptSchema = Type.String({
  minLength: 1,
  maxLength: 1000,
  description: "交给图像生成模型的完整正向提示词。",
});

const negativePromptSchema = Type.Optional(Type.String({
  maxLength: 500,
  description: "可选负向提示词；仅在确有需要时填写。",
}));

const inputAssetIdsSchema = Type.Array(
  Type.String({ pattern: "^[1-9]\\d*$", description: "当前请求已授权的图片资产 ID。" }),
  { minItems: 1, maxItems: 3, uniqueItems: true },
);

const textToImageParameters = Type.Object({
  prompt: promptSchema,
  negativePrompt: negativePromptSchema,
  aspectRatio: aspectRatioSchema,
}, { additionalProperties: false });

const imageToImageParameters = Type.Object({
  prompt: promptSchema,
  negativePrompt: negativePromptSchema,
  aspectRatio: aspectRatioSchema,
  inputAssetIds: inputAssetIdsSchema,
}, { additionalProperties: false });

export type GenerationToolRequest = {
  operation: "TEXT_TO_IMAGE" | "IMAGE_TO_IMAGE";
  prompt: string;
  negativePrompt: string | null;
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  inputAssetIds: string[];
  promptExtend: true;
  imageCount: 1;
};

export type GenerationToolOutcome =
  | { outcome: "SUCCEEDED"; taskId: string; imageAssetIds: string[] }
  | { outcome: "FAILED"; taskId?: string; code: string; message: string; retryable: boolean };

export interface GenerationToolExecutor {
  execute(toolCallId: string, request: GenerationToolRequest, signal?: AbortSignal): Promise<GenerationToolOutcome>;
}

export interface GenerationToolOptions {
  executor: GenerationToolExecutor;
  authorizedInputAssetIds: ReadonlySet<string>;
}

export function createGenerationTools(options: GenerationToolOptions): ToolDefinition[] {
  const textToImage = defineTool<typeof textToImageParameters, GenerationToolOutcome>({
    name: "text_to_image",
    label: "文生图",
    description: "根据完整文字描述生成一张新图片。没有参考图片时使用；不要用于修改已有图片。",
    parameters: textToImageParameters,
    async execute(_toolCallId, params, signal) {
      const prompt = params.prompt.trim();
      if (!prompt) return invalidPromptResult();
      return resultOf(await options.executor.execute(_toolCallId, {
        operation: "TEXT_TO_IMAGE",
        prompt,
        negativePrompt: optionalText(params.negativePrompt),
        aspectRatio: params.aspectRatio,
        inputAssetIds: [],
        promptExtend: true,
        imageCount: 1,
      }, signal));
    },
  });

  const imageToImage = defineTool<typeof imageToImageParameters, GenerationToolOutcome>({
    name: "image_to_image",
    label: "图生图",
    description: "根据一至三张当前请求已授权的参考图片进行修改或再创作。需要参考已有图片时使用。",
    parameters: imageToImageParameters,
    async execute(_toolCallId, params, signal) {
      const prompt = params.prompt.trim();
      if (!prompt) return invalidPromptResult();
      const unauthorized = params.inputAssetIds.filter((id) => !options.authorizedInputAssetIds.has(id));
      if (unauthorized.length > 0) {
        const allowed = [...options.authorizedInputAssetIds];
        return resultOf({
          outcome: "FAILED",
          code: "INPUT_ASSET_NOT_AUTHORIZED",
          message: `图片资产未获得当前请求授权：${unauthorized.join(", ")}。`
            + (allowed.length > 0
              ? `本轮允许的图片资产 ID：${allowed.join(", ")}。请修正参数后重新调用。`
              : "本轮没有已授权的参考图片，不能调用图生图。"),
          retryable: true,
        });
      }
      return resultOf(await options.executor.execute(_toolCallId, {
        operation: "IMAGE_TO_IMAGE",
        prompt,
        negativePrompt: optionalText(params.negativePrompt),
        aspectRatio: params.aspectRatio,
        inputAssetIds: params.inputAssetIds,
        promptExtend: true,
        imageCount: 1,
      }, signal));
    },
  });

  return [textToImage, imageToImage];
}

function invalidPromptResult() {
  return resultOf({
    outcome: "FAILED",
    code: "INVALID_PROMPT",
    message: "prompt 不能只包含空白字符，请提供明确的画面描述。",
    retryable: true,
  });
}

function resultOf(result: GenerationToolOutcome) {
  if (result.outcome === "SUCCEEDED") {
    return {
      content: [{
        type: "text" as const,
        text: `图片生成成功。任务 ID：${result.taskId}；图片资产 ID：${result.imageAssetIds.join(", ")}。`,
      }],
      details: result,
    };
  }
  return {
    content: [{ type: "text" as const, text: `图片生成失败（${result.code}）：${result.message}` }],
    details: result,
  };
}

function optionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
