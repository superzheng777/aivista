import { Injectable, Logger } from "@nestjs/common";
import type { Channel, ConsumeMessage } from "amqplib";
import { parseAgentExecuteMessage } from "./agent-execute-message.js";
import { AgentExecutionService } from "./agent-execution.service.js";

@Injectable()
export class AgentCommandListenerService {
  private readonly logger = new Logger(AgentCommandListenerService.name);

  constructor(private readonly execution: AgentExecutionService) {}

  async consume(message: ConsumeMessage, channel: Channel, signal?: AbortSignal): Promise<void> {
    let command;
    try {
      command = parseAgentExecuteMessage(message.content);
    } catch {
      channel.ack(message);
      return;
    }
    try {
      if (await this.execution.execute(command, signal)) {
        channel.ack(message);
        return;
      }
    } catch (error) {
      this.logger.error(`Agent command failed for creation ${command.creationTaskId}: ${messageOf(error)}`,
        error instanceof Error ? error.stack : undefined);
    }
    channel.nack(message, false, true);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
