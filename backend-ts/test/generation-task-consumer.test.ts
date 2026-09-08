import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("amqplib", () => ({ connect: mocks.connect }));
import { GenerationTaskConsumerService } from "../src/generation/generation-task-consumer.service.js";

describe("generation task consumer adapter", () => {
  beforeEach(() => mocks.connect.mockReset());
  it("creates isolated prefetch-one channels for the generation consumer pool", async () => {
    const channels = [channel(), channel()]; let index = 0;
    const connection = { createChannel: vi.fn(async () => channels[index++]!), close: vi.fn(async () => undefined) };
    mocks.connect.mockResolvedValue(connection);
    const consumer = new GenerationTaskConsumerService({ get: (key: string) => config[key] } as never,
      { consume: vi.fn() } as never);
    await consumer.onModuleInit();
    expect(connection.createChannel).toHaveBeenCalledTimes(2);
    for (const value of channels) {
      expect(value.prefetch).toHaveBeenCalledWith(1);
    }
    expect(channels[0]!.consume).toHaveBeenCalledWith("generation.task.execute", expect.any(Function), { noAck: false });
    expect(channels[1]!.consume).toHaveBeenCalledWith("generation.task.execute", expect.any(Function), { noAck: false });
    await consumer.onModuleDestroy(); expect(connection.close).toHaveBeenCalled();
  });
});

function channel() { return { assertExchange: vi.fn(async () => undefined), assertQueue: vi.fn(async () => undefined),
  bindQueue: vi.fn(async () => undefined), prefetch: vi.fn(async () => undefined), consume: vi.fn(async () => ({ consumerTag: "tag" })),
  close: vi.fn(async () => undefined) }; }
const config: Record<string, unknown> = { AIVISTA_GENERATION_QUEUE_ENABLED: true,
  AIVISTA_RABBITMQ_HOST: "localhost",
  AIVISTA_RABBITMQ_PORT: 5672, AIVISTA_RABBITMQ_USERNAME: "guest", AIVISTA_RABBITMQ_PASSWORD: "guest",
  AIVISTA_RABBITMQ_VHOST: "/aivista", AIVISTA_GENERATION_CONSUMER_CONCURRENCY: 2,
  AIVISTA_GENERATION_EXCHANGE: "aivista.generation.commands", AIVISTA_GENERATION_QUEUE_NAME: "generation.task.execute",
  AIVISTA_GENERATION_ROUTING_KEY: "generation.task.execute" };
