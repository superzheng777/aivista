import { Injectable } from "@nestjs/common";
import type { Channel, ConsumeMessage } from "amqplib";
import { GenerationTaskExecutionService } from "./generation-task-execution.service.js";
import { parseTaskExecuteMessage } from "./generation-task-message.js";

@Injectable()
export class GenerationTaskListenerService {
  constructor(private readonly execution: GenerationTaskExecutionService) {}

  async consume(message: ConsumeMessage, channel: Channel, signal?: AbortSignal): Promise<void> {
    let command;
    try { command = parseTaskExecuteMessage(message.content); }
    catch { channel.ack(message); return; }
    try {
      if (await this.execution.execute(command, signal)) { channel.ack(message); return; }
    } catch { /* RabbitMQ redelivery below */ }
    channel.nack(message, false, true);
  }
}
