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
import { GenerationCompletionCoordinatorService } from "./generation/generation-completion-coordinator.service.js";
import { JavaGenerationClient } from "./agent/adapters/java-generation-client.js";
import { JavaAgentCompletionClient } from "./agent/adapters/java-agent-completion-client.js";
import { JavaAgentActivityClient } from "./agent/adapters/java-agent-activity-client.js";
import { AgentExecutionStateService } from "./agent/agent-execution-state.service.js";
import { AgentImageLoaderService } from "./agent/agent-image-loader.service.js";
import { AgentModelService } from "./agent/agent-model.service.js";
import { AgentExecutionService } from "./agent/agent-execution.service.js";
import { AgentCommandListenerService } from "./agent/agent-command-listener.service.js";
import { AgentCommandConsumerService } from "./agent/agent-command-consumer.service.js";
import { JavaAgentRealtimeClient } from "./agent/adapters/java-agent-realtime-client.js";

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }), DatabaseModule],
  providers: [GenerationImageUrlService, GenerationBailianClientService, GenerationProviderCallGateService,
    GenerationTaskListenerService, GenerationImageTransferService, GenerationTaskConsumerService,
    GenerationCompletionClientService, GenerationPipelineStateService,
    GenerationPipelineExecutionService, GenerationCompletionCoordinatorService,
    JavaGenerationClient, JavaAgentCompletionClient, JavaAgentActivityClient,
    AgentExecutionStateService, AgentImageLoaderService,
    AgentModelService, JavaAgentRealtimeClient, AgentExecutionService,
    AgentCommandListenerService, AgentCommandConsumerService] })
export class GenerationWorkerModule {}
