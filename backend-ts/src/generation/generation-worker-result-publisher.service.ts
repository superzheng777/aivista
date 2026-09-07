import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";
import { RabbitConfirmPublisherService } from "./rabbit-confirm-publisher.service.js";
import { encodeWorkerResult, type GenerationWorkerResult } from "./generation-worker-result.js";

@Injectable()
export class GenerationWorkerResultPublisherService {
  private readonly routingKey: string;
  constructor(config: ConfigService<Environment, true>, private readonly rabbit: RabbitConfirmPublisherService) {
    this.routingKey = config.get("AIVISTA_GENERATION_WORKER_RESULT_ROUTING_KEY", { infer: true });
  }

  publish(result: GenerationWorkerResult): Promise<void> {
    return this.rabbit.publish(this.routingKey, result.resultId, encodeWorkerResult(result));
  }
}
