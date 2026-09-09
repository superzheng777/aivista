import { createHash } from "node:crypto";
import { JavaGenerationApiError, type JavaGenerationClient } from "../adapters/java-generation-client.js";
import type { GenerationCompletionCoordinatorService } from "../../generation/generation-completion-coordinator.service.js";
import type { GenerationToolExecutor, GenerationToolOutcome, GenerationToolRequest } from "./generation.js";

export interface AgentGenerationExecutorOptions {
  creationTaskId: string;
  java: JavaGenerationClient;
  completions: GenerationCompletionCoordinatorService;
  toolWaitTimeoutMs?: number;
}

/** Creation-scoped executor used by the two formal Pi generation tools. */
export class AgentGenerationToolExecutor implements GenerationToolExecutor {
  constructor(private readonly options: AgentGenerationExecutorOptions) {}

  async execute(toolCallId: string, request: GenerationToolRequest,
      signal?: AbortSignal): Promise<GenerationToolOutcome> {
    try {
      const timeout = AbortSignal.timeout(this.options.toolWaitTimeoutMs ?? 660_000);
      const executionSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const created = await this.options.java.createTask(this.options.creationTaskId,
        stableIdempotencyKey(this.options.creationTaskId, toolCallId), request, executionSignal);
      const completed = await this.options.completions.wait(created.taskId, executionSignal);
      if ((completed.status === "SUCCEEDED" || completed.status === "PARTIALLY_SUCCEEDED")
          && completed.assets.length > 0) {
        return { outcome: "SUCCEEDED", taskId: completed.taskId,
          imageAssetIds: completed.assets.map((asset) => asset.assetId) };
      }
      return { outcome: "FAILED", taskId: completed.taskId,
        code: completed.failureCode ?? "GENERATION_FAILED",
        message: "图片生成未成功，请根据错误调整方案。", retryable: true };
    } catch (error) {
      if (isAbort(error)) throw error;
      if (error instanceof JavaGenerationApiError) {
        return { outcome: "FAILED", code: `JAVA_${error.code ?? error.status}`,
          message: error.message, retryable: retryableJavaError(error) };
      }
      return { outcome: "FAILED", code: "GENERATION_SERVICE_UNAVAILABLE",
        message: "图片生成服务暂时不可用，请稍后再试。", retryable: true };
    }
  }
}

function stableIdempotencyKey(creationTaskId: string, toolCallId: string): string {
  const hex = createHash("sha256").update(`${creationTaskId}:${toolCallId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function retryableJavaError(error: JavaGenerationApiError): boolean {
  return error.status >= 500 || error.status === 409;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
