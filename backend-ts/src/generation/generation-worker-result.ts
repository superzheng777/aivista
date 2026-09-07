import type { GenerationFailureCode } from "./generation-provider-error.js";
import type { TransferredImage } from "./generation-image-transfer.service.js";

export type WorkerPhase = "PROVIDER" | "TRANSFER";
export type WorkerOutcome = "STARTED" | "SUCCEEDED" | "FAILED";

export interface GenerationWorkerResult {
  contractVersion: 1;
  resultId: string;
  phase: WorkerPhase;
  outcome: WorkerOutcome;
  taskId: string;
  taskVersion: number;
  providerRequestId: string | null;
  providerResultSnapshot: string | null;
  declaredWidth: number | null;
  declaredHeight: number | null;
  expectedImageCount: number | null;
  failureCode: GenerationFailureCode | null;
  images: Array<{ sourceIndex: number; objectKey: string; fileSize: string; width: number; height: number }>;
}

export function started(phase: WorkerPhase, taskId: bigint, taskVersion: number): GenerationWorkerResult {
  return base(phase, "STARTED", taskId, taskVersion);
}

export function providerSucceeded(taskId: bigint, taskVersion: number, result: {
  requestId: string | null; snapshot: string; declaredWidth: number; declaredHeight: number; imageUrls: string[];
}): GenerationWorkerResult {
  return { ...base("PROVIDER", "SUCCEEDED", taskId, taskVersion), providerRequestId: result.requestId,
    providerResultSnapshot: result.snapshot, declaredWidth: result.declaredWidth, declaredHeight: result.declaredHeight,
    expectedImageCount: result.imageUrls.length };
}

export function failed(phase: WorkerPhase, taskId: bigint, taskVersion: number,
  failureCode: GenerationFailureCode, providerRequestId: string | null = null): GenerationWorkerResult {
  return { ...base(phase, "FAILED", taskId, taskVersion), failureCode, providerRequestId };
}

export function transferSucceeded(taskId: bigint, taskVersion: number, images: TransferredImage[],
  expectedImageCount: number, width: number, height: number): GenerationWorkerResult {
  return { ...base("TRANSFER", "SUCCEEDED", taskId, taskVersion), expectedImageCount,
    declaredWidth: width, declaredHeight: height,
    images: images.map((image) => ({ ...image, fileSize: image.fileSize.toString() })) };
}

function base(phase: WorkerPhase, outcome: WorkerOutcome, taskId: bigint, taskVersion: number): GenerationWorkerResult {
  return { contractVersion: 1, resultId: `${phase.toLowerCase()}-${taskId}-${taskVersion}-${outcome.toLowerCase()}`,
    phase, outcome, taskId: taskId.toString(), taskVersion, providerRequestId: null,
    providerResultSnapshot: null, declaredWidth: null, declaredHeight: null,
    expectedImageCount: null, failureCode: null, images: [] };
}

export function encodeWorkerResult(result: GenerationWorkerResult): Buffer {
  return Buffer.from(JSON.stringify(result));
}
