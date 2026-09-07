import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadJavaLocalEnvironment } from "../src/config/java-local-environment.js";

describe("Java local profile bridge", () => {
  it("maps shared infrastructure and resolves Spring placeholders without copying configuration", () => {
    const path = fileURLToPath(new URL("./fixtures/java-application-local.yaml", import.meta.url));
    const result = loadJavaLocalEnvironment(path, { TEST_DB_HOST: "mysql.internal" });

    expect(result).toMatchObject({
      AIVISTA_DB_HOST: "mysql.internal",
      AIVISTA_DB_PORT: "3307",
      AIVISTA_DB_NAME: "aivista",
      AIVISTA_RABBITMQ_HOST: "rabbit.example",
      AIVISTA_RABBITMQ_PORT: 5673,
      AIVISTA_RABBITMQ_VHOST: "/aivista",
      AIVISTA_GENERATION_QUEUE_ENABLED: "true",
      AIVISTA_GENERATION_EXCHANGE: "custom.exchange",
      AIVISTA_GENERATION_CONSUMER_CONCURRENCY: 7,
      AIVISTA_TRANSFER_CONSUMER_CONCURRENCY: 3,
      AIVISTA_BAILIAN_READ_TIMEOUT_MS: 330000,
      AIVISTA_OSS_SIGNED_URL_TTL_SECONDS: 600,
    });
  });
});
