import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Selectable } from "kysely";
import type { Environment } from "../config/environment.js";
import type { GenerationTaskTable } from "../database/database.types.js";
import { GenerationBailianClientService } from "./generation-bailian-client.service.js";
import { GenerationCompletionClientService } from "./generation-completion-client.service.js";
import { generationCompleted, generationFailed, type GenerationCompletion } from "./generation-completion.js";
import { GenerationImageTransferService } from "./generation-image-transfer.service.js";
import { GenerationPipelineStateService } from "./generation-pipeline-state.service.js";
import { BailianConnectionError, BailianProviderError, providerFailureCode } from "./generation-provider-error.js";
import { GenerationProviderCallGateService } from "./generation-provider-call-gate.service.js";
import type { TaskExecuteMessage } from "./generation-task-message.js";

@Injectable()
export class GenerationPipelineExecutionService {
  private readonly logger = new Logger(GenerationPipelineExecutionService.name);
  private readonly maxRetries: number;
  private readonly active = new Set<string>();

  constructor(config: ConfigService<Environment, true>, private readonly state: GenerationPipelineStateService,
    private readonly java: GenerationCompletionClientService, private readonly bailian: GenerationBailianClientService,
    private readonly transfer: GenerationImageTransferService, private readonly gate: GenerationProviderCallGateService) {
    this.maxRetries = config.get("AIVISTA_BAILIAN_MAX_RETRIES", { infer: true });
  }

  async execute(message: TaskExecuteMessage, signal?: AbortSignal): Promise<boolean> {
    const executionKey = `${message.taskId}:${message.taskVersion}`;
    // The outbox is at-least-once. A concurrently delivered duplicate must not
    // interpret this instance's in-flight provider call as a crashed call.
    if (this.active.has(executionKey)) return true;
    this.active.add(executionKey);
    try { return await this.executeOnce(message, signal); }
    finally { this.active.delete(executionKey); }
  }

  private async executeOnce(message: TaskExecuteMessage, signal?: AbortSignal): Promise<boolean> {
    const plan = await this.state.prepare(message, new Date());
    if (plan.kind === "ACK") return true;
    if (plan.kind === "REPLAY") { await this.java.complete(plan.completion); return true; }
    const executionVersion = message.taskVersion + 1;
    if (plan.kind === "OUTCOME_UNKNOWN") {
      return this.commit(message, generationFailed(message.taskId, executionVersion, "PROVIDER_CALL_OUTCOME_UNKNOWN"));
    }
    if (plan.kind === "TRANSFER") {
      return this.transferAndCommit(message, executionVersion, plan.task, plan.provider.providerRequestId,
        plan.provider.snapshot);
    }
    if (!await this.state.markProviderCalling(message.taskId, message.taskVersion, new Date())) return false;
    let provider;
    try {
      provider = await this.generateWithRetry(plan.task, signal);
    } catch (error) {
      if (isAbort(error)) return false;
      const code = error instanceof BailianProviderError ? providerFailureCode(error)
        : error instanceof BailianConnectionError ? "PROVIDER_CONNECTION_FAILED" : "PROVIDER_CALL_OUTCOME_UNKNOWN";
      this.logger.warn(`Generation pipeline provider failed for task ${message.taskId}: ${errorName(error)}`);
      return this.commit(message, generationFailed(message.taskId, executionVersion, code,
        error instanceof BailianProviderError ? error.requestId : null));
    }
    await this.state.saveProvider(message.taskId, message.taskVersion,
      { providerRequestId: provider.requestId, snapshot: provider.snapshot }, new Date());
    return this.transferAndCommit(message, executionVersion, plan.task, provider.requestId, provider.snapshot);
  }

  private async transferAndCommit(message: TaskExecuteMessage, executionVersion: number,
    task: Selectable<GenerationTaskTable>, providerRequestId: string | null, snapshot: string): Promise<boolean> {
    let completion: GenerationCompletion;
    try {
      const provider = this.bailian.restore(snapshot);
      const images = await this.transfer.transfer(task, provider.imageUrls);
      completion = generationCompleted(message.taskId, executionVersion, providerRequestId,
        provider.imageUrls.length, images);
    } catch (error) {
      this.logger.warn(`Generation pipeline transfer failed for task ${message.taskId}: ${errorName(error)}`);
      completion = generationFailed(message.taskId, executionVersion, "IMAGE_TRANSFER_FAILED", providerRequestId);
    }
    return this.commit(message, completion);
  }

  private async commit(message: TaskExecuteMessage, completion: GenerationCompletion): Promise<boolean> {
    await this.state.saveCompletion(completion, message.taskVersion, new Date());
    await this.java.complete(completion);
    return true;
  }

  private async generateWithRetry(task: Selectable<GenerationTaskTable>, signal?: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      let release: (() => void) | undefined;
      try {
        release = await this.gate.acquire(signal);
        return await this.bailian.generate(task);
      } catch (error) {
        if (attempt >= this.maxRetries || !retryable(error)) throw error;
        await delay(1000 * (1 << attempt), signal);
      } finally { release?.(); }
    }
  }
}

function retryable(error: unknown) {
  if (error instanceof BailianConnectionError) return true;
  return error instanceof BailianProviderError
    && ["PROVIDER_RATE_LIMITED", "PROVIDER_SERVICE_UNAVAILABLE"].includes(providerFailureCode(error));
}
function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}
function isAbort(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
function errorName(error: unknown) { return error instanceof Error ? error.name : "UnknownError"; }
