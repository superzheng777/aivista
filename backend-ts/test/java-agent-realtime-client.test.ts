import { afterEach, describe, expect, it, vi } from "vitest";
import { JavaAgentRealtimeClient, toWebSocketUrl } from "../src/agent/adapters/java-agent-realtime-client.js";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  send(value: string) { this.sent.push(value); }
  close() { this.fire("close"); }
  fire(type: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.instances = [];
});

describe("JavaAgentRealtimeClient", () => {
  it("authenticates once and drops events until Java confirms READY", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const client = new JavaAgentRealtimeClient(config());
    client.onModuleInit();
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("ws://127.0.0.1:8888/api/internal/agent-runtime");
    expect(client.publish("31", 4, { eventType: "RUN_STARTED", payload: {} })).toBe(false);
    socket.readyState = 1;
    socket.fire("open");
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "HELLO", contractVersion: 1, token: "secret" });
    socket.fire("message", { data: '{"type":"READY","contractVersion":1}' });
    expect(client.publish("31", 4, { eventType: "TEXT_DELTA",
      payload: { contentIndex: 0, delta: "构图" } })).toBe(true);
    expect(JSON.parse(socket.sent[1]!)).toEqual({ type: "EVENT", event: { creationTaskId: "31",
      revision: 4, eventType: "TEXT_DELTA", payload: { contentIndex: 0, delta: "构图" } } });
    client.onModuleDestroy();
  });

  it("derives secure WebSocket URLs without retaining query credentials", () => {
    expect(toWebSocketUrl("https://example.com/api/?ignored=yes#fragment"))
      .toBe("wss://example.com/api/internal/agent-runtime");
  });
});

function config() {
  const values: Record<string, unknown> = { AIVISTA_AGENT_ENABLED: true,
    AIVISTA_GENERATION_WORKER_TOKEN: "secret", AIVISTA_JAVA_BASE_URL: "http://127.0.0.1:8888/api" };
  return { get: vi.fn((key: string) => values[key]) } as never;
}
