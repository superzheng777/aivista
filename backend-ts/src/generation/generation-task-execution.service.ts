import { Injectable, Logger } from "@nestjs/common";
import { GenerationBailianClientService } from "./generation-bailian-client.service.js";
import { BailianConnectionError, BailianProviderError, providerFailureCode } from "./generation-provider-error.js";
import { GenerationProviderCallGateService } from "./generation-provider-call-gate.service.js";
import { GenerationTaskExecutionStateService, type TaskExecuteMessage } from "./generation-task-execution-state.service.js";
import { failed, providerSucceeded, started } from "./generation-worker-result.js";
import { GenerationWorkerResultPublisherService } from "./generation-worker-result-publisher.service.js";

@Injectable()
export class GenerationTaskExecutionService {
  private readonly logger = new Logger(GenerationTaskExecutionService.name);
  constructor(private readonly state: GenerationTaskExecutionStateService,
    private readonly client: GenerationBailianClientService, private readonly gate: GenerationProviderCallGateService,
    private readonly publisher: GenerationWorkerResultPublisherService) {}

  async execute(message: TaskExecuteMessage, signal?: AbortSignal): Promise<boolean> {
    const plan = await this.state.prepare(message, new Date());
    if (plan.kind === "ACK") return true;
    if (plan.kind === "REPLAY") { await this.publisher.publish(plan.result); return true; }
    if (plan.kind === "OUTCOME_UNKNOWN") {
      const result = failed("PROVIDER", message.taskId, message.taskVersion, "PROVIDER_CALL_OUTCOME_UNKNOWN");
      await this.state.saveResult(result, new Date()); await this.publisher.publish(result); return true;
    }
    await this.publisher.publish(started("PROVIDER", message.taskId, message.taskVersion));
    let release: (() => void) | undefined;
    let result;
    try {
      release = await this.gate.acquire(signal);
      if (!await this.state.markProviderCallStarted(message.taskId, message.taskVersion, new Date())) return false;
      const providerResult = await this.client.generate(plan.task);
      result = providerSucceeded(message.taskId, message.taskVersion, providerResult);
    } catch (error) {
      if (isAbort(error)) return false;
      result = error instanceof BailianProviderError
        ? failed("PROVIDER", message.taskId, message.taskVersion, providerFailureCode(error), error.requestId)
        : error instanceof BailianConnectionError
          ? failed("PROVIDER", message.taskId, message.taskVersion, "PROVIDER_CONNECTION_FAILED")
          : failed("PROVIDER", message.taskId, message.taskVersion, "PROVIDER_CALL_OUTCOME_UNKNOWN");
      this.logger.warn(`Generation provider execution failed for task ${message.taskId}: ${errorName(error)}`);
    } finally { release?.(); }
    await this.state.saveResult(result, new Date()); await this.publisher.publish(result); return true;
  }
}

function isAbort(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
function errorName(error: unknown) { return error instanceof Error ? error.name : "UnknownError"; }
