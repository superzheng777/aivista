import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./config/environment.js";
import { DatabaseModule } from "./database/database.module.js";
import { GenerationImageUrlService } from "./generation/generation-image-url.service.js";
import { GenerationBailianClientService } from "./generation/generation-bailian-client.service.js";
import { GenerationProviderCallGateService } from "./generation/generation-provider-call-gate.service.js";
import { GenerationTaskListenerService } from "./generation/generation-task-listener.service.js";
import { GenerationTaskConsumerService } from "./generation/generation-task-consumer.service.js";
import { GenerationImageTransferService } from "./generation/generation-image-transfer.service.js";
import { GenerationCompletionClientService } from "./generation/generation-completion-client.service.js";
import { GenerationPipelineStateService } from "./generation/generation-pipeline-state.service.js";
import { GenerationPipelineExecutionService } from "./generation/generation-pipeline-execution.service.js";

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }), DatabaseModule],
  providers: [GenerationImageUrlService, GenerationBailianClientService, GenerationProviderCallGateService,
    GenerationTaskListenerService, GenerationImageTransferService, GenerationTaskConsumerService,
    GenerationCompletionClientService, GenerationPipelineStateService,
    GenerationPipelineExecutionService] })
export class GenerationWorkerModule {}
