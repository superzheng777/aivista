import type { GenerationFailureCode } from "./generation-provider-error.js";
import type { TransferredImage } from "./generation-image-transfer.service.js";

interface CompletionBase {
  contractVersion: 1;
  completionId: string;
  taskId: string;
  taskVersion: number;
}

export type GenerationCompletion = GenerationCompleted | GenerationFailed;

export interface GenerationCompleted extends CompletionBase {
  outcome: "COMPLETED";
  providerRequestId: string | null;
  expectedImageCount: number;
  images: Array<{
    sourceIndex: number;
    objectKey: string;
    contentType: "image/png";
    fileSize: string;
    width: number;
    height: number;
  }>;
}

export interface GenerationFailed extends CompletionBase {
  outcome: "FAILED";
  failureCode: GenerationFailureCode;
  providerRequestId: string | null;
}

export function generationCompleted(taskId: bigint, taskVersion: number, providerRequestId: string | null,
  expectedImageCount: number, images: TransferredImage[]): GenerationCompleted {
  return { ...base(taskId, taskVersion), outcome: "COMPLETED", providerRequestId, expectedImageCount,
    images: images.map((image) => ({ ...image, contentType: "image/png", fileSize: image.fileSize.toString() })) };
}

export function generationFailed(taskId: bigint, taskVersion: number, failureCode: GenerationFailureCode,
  providerRequestId: string | null = null): GenerationFailed {
  return { ...base(taskId, taskVersion), outcome: "FAILED", failureCode, providerRequestId };
}

function base(taskId: bigint, taskVersion: number): CompletionBase {
  return { contractVersion: 1, completionId: `generation-${taskId}-${taskVersion}`,
    taskId: taskId.toString(), taskVersion };
}
