import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../config/environment.js";
import type { AgentRealtimeEvent } from "../agent-event-normalizer.js";

const OPEN = 1;

/** One process-level transient channel. Disconnected events are intentionally dropped, never replayed stale. */
@Injectable()
export class JavaAgentRealtimeClient implements OnModuleInit, OnModuleDestroy {
  private socket: WebSocket | undefined;
  private ready = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  onModuleInit(): void {
    if (this.config.get("AIVISTA_AGENT_ENABLED", { infer: true })
        && this.config.get("AIVISTA_GENERATION_WORKER_TOKEN", { infer: true })) this.connect();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket?.close();
  }

  publish(creationTaskId: string, revision: number, event: AgentRealtimeEvent): boolean {
    if (!this.ready || this.socket?.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify({ type: "EVENT", event: { creationTaskId, revision, ...event } }));
    return true;
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(toWebSocketUrl(this.config.get("AIVISTA_JAVA_BASE_URL", { infer: true })));
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.stopped) return;
      socket.send(JSON.stringify({ type: "HELLO", contractVersion: 1,
        token: this.config.get("AIVISTA_GENERATION_WORKER_TOKEN", { infer: true }) }));
    });
    socket.addEventListener("message", (message) => {
      if (this.socket !== socket || typeof message.data !== "string") return;
      try {
        const frame = JSON.parse(message.data) as { type?: unknown; contractVersion?: unknown };
        if (frame.type === "READY" && frame.contractVersion === 1) {
          this.ready = true;
          this.reconnectAttempt = 0;
          this.startHeartbeat(socket);
        }
      } catch { /* Invalid server frames do not enter the runtime. */ }
    });
    const disconnected = () => {
      if (this.socket !== socket) return;
      this.ready = false;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      this.scheduleReconnect();
    };
    socket.addEventListener("close", disconnected);
    socket.addEventListener("error", () => socket.close());
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.socket === socket && this.ready && socket.readyState === OPEN) {
        socket.send('{"type":"PING"}');
      }
    }, 15_000);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(15_000, 500 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }
}

export function toWebSocketUrl(javaBaseUrl: string): string {
  const url = new URL(javaBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/internal/agent-runtime`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
