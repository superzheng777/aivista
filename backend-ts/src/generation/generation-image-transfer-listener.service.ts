import { Injectable } from "@nestjs/common";
import type { Channel, ConsumeMessage } from "amqplib";
import { GenerationImageTransferExecutionService } from "./generation-image-transfer-execution.service.js";
import { parseImageTransferMessage } from "./generation-image-transfer-message.js";

@Injectable()
export class GenerationImageTransferListenerService {
  constructor(private readonly execution: GenerationImageTransferExecutionService) {}
  async consume(message: ConsumeMessage, channel: Channel): Promise<void> {
    let command;
    try { command = parseImageTransferMessage(message.content); } catch { channel.ack(message); return; }
    try { if (await this.execution.execute(command)) { channel.ack(message); return; } } catch { /* retry below */ }
    channel.nack(message, false, true);
  }
}
