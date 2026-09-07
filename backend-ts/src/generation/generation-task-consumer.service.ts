import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { connect, type Channel, type ChannelModel } from "amqplib";
import type { Environment } from "../config/environment.js";
import { GenerationTaskListenerService } from "./generation-task-listener.service.js";
import { GenerationImageTransferListenerService } from "./generation-image-transfer-listener.service.js";

@Injectable()
export class GenerationTaskConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationTaskConsumerService.name);
  private readonly abort = new AbortController();
  private connection?: ChannelModel;
  private readonly channels: Channel[] = [];
  constructor(private readonly config: ConfigService<Environment, true>, private readonly listener: GenerationTaskListenerService,
    private readonly transferListener: GenerationImageTransferListenerService) {}

  async onModuleInit() {
    if (!this.config.get("AIVISTA_GENERATION_QUEUE_ENABLED", { infer: true })) return;
    const host = this.config.get("AIVISTA_RABBITMQ_HOST", { infer: true });
    const username = this.config.get("AIVISTA_RABBITMQ_USERNAME", { infer: true });
    const password = this.config.get("AIVISTA_RABBITMQ_PASSWORD", { infer: true });
    if (!host || !username || !password) throw new Error("RabbitMQ configuration is missing");
    this.connection = await connect({ protocol: "amqp", hostname: host,
      port: this.config.get("AIVISTA_RABBITMQ_PORT", { infer: true }), username, password,
      vhost: this.config.get("AIVISTA_RABBITMQ_VHOST", { infer: true }) });
    const generationConcurrency = this.config.get("AIVISTA_GENERATION_CONSUMER_CONCURRENCY", { infer: true });
    for (let index = 0; index < generationConcurrency; index++) await this.startChannel("generation");
    const transferConcurrency = this.config.get("AIVISTA_TRANSFER_CONSUMER_CONCURRENCY", { infer: true });
    for (let index = 0; index < transferConcurrency; index++) await this.startChannel("transfer");
  }

  async onModuleDestroy() {
    this.abort.abort();
    await Promise.allSettled(this.channels.map((channel) => channel.close()));
    if (this.connection) await this.connection.close();
  }

  private async startChannel(kind: "generation" | "transfer") {
    const channel = await this.connection!.createChannel(); this.channels.push(channel);
    const exchange = this.config.get("AIVISTA_GENERATION_EXCHANGE", { infer: true });
    const queue = this.config.get(kind === "generation" ? "AIVISTA_GENERATION_QUEUE_NAME" : "AIVISTA_TRANSFER_QUEUE_NAME", { infer: true });
    const routingKey = this.config.get(kind === "generation" ? "AIVISTA_GENERATION_ROUTING_KEY" : "AIVISTA_TRANSFER_ROUTING_KEY", { infer: true });
    await channel.assertExchange(exchange, "direct", { durable: true });
    await channel.assertQueue(queue, { durable: true, arguments: { "x-queue-type": "quorum" } });
    await channel.bindQueue(queue, exchange, routingKey); await channel.prefetch(1);
    await channel.consume(queue, (message) => {
      if (message) void (kind === "generation" ? this.listener.consume(message, channel, this.abort.signal)
        : this.transferListener.consume(message, channel))
        .catch((error) => this.logger.error("Generation consumer acknowledgement failed", error));
    }, { noAck: false });
  }
}
