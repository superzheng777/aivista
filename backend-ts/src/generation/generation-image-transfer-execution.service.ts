import { Injectable, Logger } from "@nestjs/common";
import { GenerationBailianClientService } from "./generation-bailian-client.service.js";
import { GenerationImageTransferService } from "./generation-image-transfer.service.js";
import { GenerationImageTransferStateService, type ImageTransferMessage } from "./generation-image-transfer-state.service.js";
import { failed, started, transferSucceeded } from "./generation-worker-result.js";
import { GenerationWorkerResultPublisherService } from "./generation-worker-result-publisher.service.js";

@Injectable()
export class GenerationImageTransferExecutionService {
  private readonly logger = new Logger(GenerationImageTransferExecutionService.name);
  constructor(private readonly state: GenerationImageTransferStateService,
    private readonly bailian: GenerationBailianClientService, private readonly transfer: GenerationImageTransferService,
    private readonly publisher: GenerationWorkerResultPublisherService) {}

  async execute(message: ImageTransferMessage): Promise<boolean> {
    const plan = await this.state.prepare(message, new Date());
    if (plan.kind === "ACK") return true;
    if (plan.kind === "REPLAY") { await this.publisher.publish(plan.result); return true; }
    await this.publisher.publish(started("TRANSFER", message.taskId, message.taskVersion));
    await this.state.markStarted(message.taskId, message.taskVersion, new Date());
    let result;
    try {
      const provider = this.bailian.restore(plan.task.provider_result_snapshot as string);
      const images = await this.transfer.transfer(plan.task, provider.imageUrls);
      result = transferSucceeded(message.taskId, message.taskVersion, images, provider.imageUrls.length,
        provider.declaredWidth, provider.declaredHeight);
    } catch (error) {
      this.logger.warn(`Generation image transfer failed for task ${message.taskId}: ${errorName(error)}`);
      result = failed("TRANSFER", message.taskId, message.taskVersion, "IMAGE_TRANSFER_FAILED");
    }
    await this.state.saveResult(result, new Date()); await this.publisher.publish(result); return true;
  }
}

function errorName(error: unknown) { return error instanceof Error ? error.name : "UnknownError"; }
