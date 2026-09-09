import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { connect, type Channel, type ChannelModel } from "amqplib";
import type { Environment } from "../config/environment.js";
import { AgentCommandListenerService } from "./agent-command-listener.service.js";

/** 与 Generation Worker 隔离的 Agent RabbitMQ 消费池。 */
@Injectable()
export class AgentCommandConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentCommandConsumerService.name);
  private readonly abort = new AbortController();
  private connection?: ChannelModel;
  private readonly channels: Channel[] = [];

  constructor(private readonly config: ConfigService<Environment, true>,
    private readonly listener: AgentCommandListenerService) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get("AIVISTA_AGENT_ENABLED", { infer: true })) return;
    const host = this.config.get("AIVISTA_RABBITMQ_HOST", { infer: true });
    const username = this.config.get("AIVISTA_RABBITMQ_USERNAME", { infer: true });
    const password = this.config.get("AIVISTA_RABBITMQ_PASSWORD", { infer: true });
    if (!host || !username || !password) throw new Error("RabbitMQ configuration is missing");
    this.connection = await connect({ protocol: "amqp", hostname: host,
      port: this.config.get("AIVISTA_RABBITMQ_PORT", { infer: true }), username, password,
      vhost: this.config.get("AIVISTA_RABBITMQ_VHOST", { infer: true }) });
    const concurrency = this.config.get("AIVISTA_AGENT_MAX_CONCURRENT", { infer: true });
    for (let index = 0; index < concurrency; index++) await this.startChannel();
  }

  async onModuleDestroy(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled(this.channels.map((channel) => channel.close()));
    if (this.connection) await this.connection.close();
  }

  private async startChannel(): Promise<void> {
    const channel = await this.connection!.createChannel();
    this.channels.push(channel);
    const exchange = this.config.get("AIVISTA_GENERATION_EXCHANGE", { infer: true });
    const queue = this.config.get("AIVISTA_AGENT_QUEUE_NAME", { infer: true });
    const routingKey = this.config.get("AIVISTA_AGENT_ROUTING_KEY", { infer: true });
    await channel.assertExchange(exchange, "direct", { durable: true });
    await channel.assertQueue(queue, { durable: true, arguments: { "x-queue-type": "quorum" } });
    await channel.bindQueue(queue, exchange, routingKey);
    await channel.prefetch(1);
    await channel.consume(queue, (message) => {
      if (message) void this.listener.consume(message, channel, this.abort.signal)
        .catch((error) => this.logger.error("Agent consumer acknowledgement failed", error));
    }, { noAck: false });
  }
}
