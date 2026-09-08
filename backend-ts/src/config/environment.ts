import { z } from "zod";
import { loadJavaLocalEnvironment } from "./java-local-environment.js";

const optionalNonEmpty = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const environmentSchema = z.object({
  AIVISTA_JAVA_LOCAL_YAML: optionalNonEmpty,
  AIVISTA_JAVA_BASE_URL: z.string().url().default("http://127.0.0.1:8888/api"),
  AIVISTA_GENERATION_WORKER_TOKEN: optionalNonEmpty,
  AIVISTA_JAVA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  AIVISTA_DB_HOST: optionalNonEmpty,
  AIVISTA_DB_PORT: z.coerce.number().int().min(1).max(65_535).default(3306),
  AIVISTA_DB_NAME: optionalNonEmpty,
  AIVISTA_DB_USERNAME: optionalNonEmpty,
  AIVISTA_DB_PASSWORD: optionalNonEmpty,
  AIVISTA_OSS_ENDPOINT: optionalNonEmpty,
  AIVISTA_OSS_BUCKET: optionalNonEmpty,
  AIVISTA_OSS_ACCESS_KEY_ID: optionalNonEmpty,
  AIVISTA_OSS_ACCESS_KEY_SECRET: optionalNonEmpty,
  AIVISTA_OSS_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  AIVISTA_OSS_OBJECT_PREFIX: z.string().min(1).default("users"),
  AIVISTA_TRANSFER_SOURCE_READ_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AIVISTA_GENERATION_MAX_CONCURRENT_CALLS: z.coerce.number().int().positive().default(25),
  AIVISTA_GENERATION_RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(2),
  AIVISTA_BAILIAN_ENDPOINT: optionalNonEmpty,
  AIVISTA_BAILIAN_API_KEY: optionalNonEmpty,
  AIVISTA_BAILIAN_READ_TIMEOUT_MS: z.coerce.number().int().positive().default(330_000),
  AIVISTA_BAILIAN_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  AIVISTA_RABBITMQ_HOST: optionalNonEmpty,
  AIVISTA_RABBITMQ_PORT: z.coerce.number().int().min(1).max(65_535).default(5672),
  AIVISTA_RABBITMQ_USERNAME: optionalNonEmpty,
  AIVISTA_RABBITMQ_PASSWORD: optionalNonEmpty,
  AIVISTA_RABBITMQ_VHOST: z.string().min(1).default("/aivista"),
  AIVISTA_GENERATION_QUEUE_ENABLED: z.stringbool().default(false),
  AIVISTA_GENERATION_EXCHANGE: z.string().min(1).default("aivista.generation.commands"),
  AIVISTA_GENERATION_DEAD_LETTER_EXCHANGE: z.string().min(1).default("aivista.generation.dead-letter"),
  AIVISTA_GENERATION_QUEUE_NAME: z.string().min(1).default("generation.task.execute"),
  AIVISTA_GENERATION_CONSUMER_CONCURRENCY: z.coerce.number().int().positive().default(25),
  AIVISTA_GENERATION_ROUTING_KEY: z.string().min(1).default("generation.task.execute"),
  AIVISTA_RABBITMQ_CONFIRM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const path = typeof input.AIVISTA_JAVA_LOCAL_YAML === "string" ? input.AIVISTA_JAVA_LOCAL_YAML : undefined;
  return environmentSchema.parse({ ...loadJavaLocalEnvironment(path, process.env), ...input });
}
