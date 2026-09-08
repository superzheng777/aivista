import { Injectable, Logger } from "@nestjs/common";
import type { Channel, ConsumeMessage } from "amqplib";
import { GenerationPipelineExecutionService } from "./generation-pipeline-execution.service.js";
import { parseTaskExecuteMessage } from "./generation-task-message.js";

@Injectable()
export class GenerationTaskListenerService {
  private readonly logger = new Logger(GenerationTaskListenerService.name);
  constructor(private readonly execution: GenerationPipelineExecutionService) {}

  async consume(message: ConsumeMessage, channel: Channel, signal?: AbortSignal): Promise<void> {
    let command;
    try { command = parseTaskExecuteMessage(message.content); }
    catch { channel.ack(message); return; }
    try {
      if (await this.execution.execute(command, signal)) { channel.ack(message); return; }
    } catch (error) {
      this.logger.error(`Generation command failed for task ${command.taskId}: ${errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined);
    }
    channel.nack(message, false, true);
  }
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
