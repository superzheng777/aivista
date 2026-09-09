import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";

type Values = Record<string, unknown>;

/** Maps the existing Spring local profile to the TypeScript runtime without copying secrets. */
export function loadJavaLocalEnvironment(path: string | undefined, processEnvironment: NodeJS.ProcessEnv): Values {
  if (!path) return {};
  const local = parse(readFileSync(path, "utf8")) as Values;
  const basePath = join(dirname(path), "application.yaml");
  const source = existsSync(basePath)
    ? merge(parse(readFileSync(basePath, "utf8")) as Values, local)
    : local;
  const value = (key: string) => resolve(pathValue(source, key), processEnvironment);
  const output: Values = {};
  const set = (name: string, candidate: unknown) => { if (candidate !== undefined && candidate !== null && candidate !== "") output[name] = candidate; };

  const jdbc = value("spring.datasource.url");
  if (typeof jdbc === "string") {
    const url = new URL(jdbc.replace(/^jdbc:/, ""));
    set("AIVISTA_DB_HOST", url.hostname);
    set("AIVISTA_DB_PORT", url.port || "3306");
    set("AIVISTA_DB_NAME", url.pathname.replace(/^\//, ""));
  }
  set("AIVISTA_DB_USERNAME", value("spring.datasource.username"));
  set("AIVISTA_DB_PASSWORD", value("spring.datasource.password"));
  const serverPort = value("server.port");
  const contextPath = value("server.servlet.context-path");
  set("AIVISTA_JAVA_BASE_URL", `http://127.0.0.1:${serverPort ?? 8888}${contextPath ?? ""}`);
  set("AIVISTA_GENERATION_WORKER_TOKEN", value("app.generation.worker-api.token"));
  set("AIVISTA_RABBITMQ_HOST", value("spring.rabbitmq.host"));
  set("AIVISTA_RABBITMQ_PORT", value("spring.rabbitmq.port"));
  set("AIVISTA_RABBITMQ_USERNAME", value("spring.rabbitmq.username"));
  set("AIVISTA_RABBITMQ_PASSWORD", value("spring.rabbitmq.password"));
  set("AIVISTA_RABBITMQ_VHOST", value("spring.rabbitmq.virtual-host"));
  set("AIVISTA_GENERATION_QUEUE_ENABLED", booleanString(value("app.generation.queue.enabled")));
  set("AIVISTA_GENERATION_EXCHANGE", value("app.generation.queue.exchange"));
  set("AIVISTA_AGENT_QUEUE_NAME", value("app.generation.queue.agent-name"));
  set("AIVISTA_AGENT_ROUTING_KEY", value("app.generation.queue.agent-routing-key"));
  set("AIVISTA_GENERATION_DEAD_LETTER_EXCHANGE", value("app.generation.queue.dead-letter-exchange"));
  set("AIVISTA_GENERATION_QUEUE_NAME", value("app.generation.queue.generation-name"));
  set("AIVISTA_GENERATION_ROUTING_KEY", value("app.generation.queue.generation-routing-key"));
  set("AIVISTA_GENERATION_CONSUMER_CONCURRENCY", value("app.generation.queue.generation-consumer-concurrency"));
  set("AIVISTA_BAILIAN_ENDPOINT", value("app.generation.bailian.endpoint"));
  set("AIVISTA_BAILIAN_API_KEY", value("app.generation.bailian.api-key"));
  set("AIVISTA_BAILIAN_READ_TIMEOUT_MS", durationMs(value("app.generation.bailian.read-timeout")));
  set("AIVISTA_BAILIAN_MAX_RETRIES", value("app.generation.bailian.max-retries"));
  set("AIVISTA_AGENT_ENABLED", booleanString(value("app.agent.enabled")));
  set("AIVISTA_AGENT_MODEL", value("app.agent.model.id"));
  set("AIVISTA_AGENT_BAILIAN_BASE_URL", value("app.agent.model.base-url"));
  set("AIVISTA_AGENT_BAILIAN_API_KEY", value("app.agent.model.api-key"));
  set("AIVISTA_AGENT_THINKING_ENABLED", booleanString(value("app.agent.model.thinking-enabled")));
  set("AIVISTA_AGENT_MAX_TURNS", value("app.agent.max-turns"));
  set("AIVISTA_AGENT_MAX_CONCURRENT", value("app.agent.max-concurrent"));
  set("AIVISTA_AGENT_TOOL_WAIT_TIMEOUT_MS", durationMs(value("app.agent.tool-wait-timeout")));
  set("AIVISTA_AGENT_LOOP_TIMEOUT_MS", durationMs(value("app.agent.loop-timeout")));
  set("AIVISTA_GENERATION_MAX_CONCURRENT_CALLS", value("app.generation.bailian.max-concurrent-calls"));
  set("AIVISTA_GENERATION_RATE_LIMIT_PER_SECOND", value("app.generation.bailian.rate-limit-per-second"));
  set("AIVISTA_OSS_ENDPOINT", value("app.generation.oss.endpoint"));
  set("AIVISTA_OSS_BUCKET", value("app.generation.oss.bucket"));
  set("AIVISTA_OSS_ACCESS_KEY_ID", value("app.generation.oss.access-key-id"));
  set("AIVISTA_OSS_ACCESS_KEY_SECRET", value("app.generation.oss.access-key-secret"));
  set("AIVISTA_OSS_OBJECT_PREFIX", value("app.generation.oss.object-prefix"));
  set("AIVISTA_OSS_SIGNED_URL_TTL_SECONDS", durationSeconds(value("app.generation.oss.signed-url-ttl")));
  set("AIVISTA_TRANSFER_SOURCE_READ_TIMEOUT_MS", durationMs(value("app.generation.image-transfer.source-read-timeout")));
  return output;
}

function merge(base: Values, override: Values): Values {
  const result: Values = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] = existing && value && typeof existing === "object" && typeof value === "object"
      && !Array.isArray(existing) && !Array.isArray(value)
      ? merge(existing as Values, value as Values)
      : value;
  }
  return result;
}

function pathValue(root: Values, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) =>
    current && typeof current === "object" ? (current as Values)[key] : undefined, root);
}

function resolve(value: unknown, environment: NodeJS.ProcessEnv): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([^:}]+)(?::([^}]*))?}/g, (_match, name: string, fallback: string | undefined) =>
    environment[name] ?? fallback ?? "");
}

function durationMs(value: unknown): number | undefined { return duration(value, 1); }
function booleanString(value: unknown): unknown { return typeof value === "boolean" ? String(value) : value; }
function durationSeconds(value: unknown): number | undefined { const milliseconds = duration(value, 1); return milliseconds === undefined ? undefined : milliseconds / 1000; }
function duration(value: unknown, numericMultiplier: number): number | undefined {
  if (typeof value === "number") return value * numericMultiplier;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (!match) return undefined;
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * multipliers[match[2]!.toLowerCase()]!;
}
