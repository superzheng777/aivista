import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./config/environment.js";
import { DatabaseModule } from "./database/database.module.js";
import { GenerationImageUrlService } from "./generation/generation-image-url.service.js";
import { GenerationBailianClientService } from "./generation/generation-bailian-client.service.js";
import { GenerationProviderCallGateService } from "./generation/generation-provider-call-gate.service.js";
import { GenerationTaskExecutionStateService } from "./generation/generation-task-execution-state.service.js";
import { GenerationTaskExecutionService } from "./generation/generation-task-execution.service.js";
import { GenerationTaskListenerService } from "./generation/generation-task-listener.service.js";
import { GenerationTaskConsumerService } from "./generation/generation-task-consumer.service.js";
import { GenerationImageTransferService } from "./generation/generation-image-transfer.service.js";
import { GenerationImageTransferStateService } from "./generation/generation-image-transfer-state.service.js";
import { GenerationImageTransferExecutionService } from "./generation/generation-image-transfer-execution.service.js";
import { GenerationImageTransferListenerService } from "./generation/generation-image-transfer-listener.service.js";
import { RabbitConfirmPublisherService } from "./generation/rabbit-confirm-publisher.service.js";
import { GenerationWorkerResultPublisherService } from "./generation/generation-worker-result-publisher.service.js";

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }), DatabaseModule],
  providers: [GenerationImageUrlService, GenerationBailianClientService, GenerationProviderCallGateService,
    GenerationTaskExecutionStateService, GenerationTaskExecutionService, GenerationTaskListenerService,
    GenerationImageTransferService, GenerationImageTransferStateService, GenerationImageTransferExecutionService,
    GenerationImageTransferListenerService, GenerationTaskConsumerService, RabbitConfirmPublisherService,
    GenerationWorkerResultPublisherService] })
export class GenerationWorkerModule {}
