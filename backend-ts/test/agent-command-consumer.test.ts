import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("amqplib", () => ({ connect: mocks.connect }));
import { AgentCommandConsumerService } from "../src/agent/agent-command-consumer.service.js";

describe("AgentCommandConsumerService", () => {
  beforeEach(() => mocks.connect.mockReset());

  it("creates an isolated prefetch-one Agent consumer pool", async () => {
    const channels = [channel(), channel()];
    let index = 0;
    const connection = { createChannel: vi.fn(async () => channels[index++]!), close: vi.fn(async () => undefined) };
    mocks.connect.mockResolvedValue(connection);
    const consumer = new AgentCommandConsumerService({ get: (key: string) => config[key] } as never,
      { consume: vi.fn() } as never);

    await consumer.onModuleInit();

    expect(connection.createChannel).toHaveBeenCalledTimes(2);
    for (const value of channels) expect(value.prefetch).toHaveBeenCalledWith(1);
    expect(channels[0]!.consume).toHaveBeenCalledWith("agent.creation.execute", expect.any(Function), { noAck: false });
    await consumer.onModuleDestroy();
  });
});

function channel() { return { assertExchange: vi.fn(), assertQueue: vi.fn(), bindQueue: vi.fn(), prefetch: vi.fn(),
  consume: vi.fn(), close: vi.fn() }; }
const config: Record<string, unknown> = { AIVISTA_AGENT_ENABLED: true, AIVISTA_RABBITMQ_HOST: "localhost",
  AIVISTA_RABBITMQ_PORT: 5672, AIVISTA_RABBITMQ_USERNAME: "guest", AIVISTA_RABBITMQ_PASSWORD: "guest",
  AIVISTA_RABBITMQ_VHOST: "/aivista", AIVISTA_AGENT_MAX_CONCURRENT: 2,
  AIVISTA_GENERATION_EXCHANGE: "aivista.generation.commands", AIVISTA_AGENT_QUEUE_NAME: "agent.creation.execute",
  AIVISTA_AGENT_ROUTING_KEY: "agent.creation.execute" };
