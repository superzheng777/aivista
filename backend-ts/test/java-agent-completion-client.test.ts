import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JavaAgentCompletionClient } from "../src/agent/adapters/java-agent-completion-client.js";
import type { Environment } from "../src/config/environment.js";

afterEach(() => vi.unstubAllGlobals());

describe("JavaAgentCompletionClient", () => {
  it("submits a deterministic Agent completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ creationTaskId: "151",
      status: "SUCCEEDED", revision: 1, failureCode: null, finalMessage: "海报已生成。" }),
    { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new JavaAgentCompletionClient(new ConfigService<Environment, true>({
      AIVISTA_JAVA_BASE_URL: "http://java/api", AIVISTA_GENERATION_WORKER_TOKEN: "worker-secret",
      AIVISTA_JAVA_REQUEST_TIMEOUT_MS: 10_000,
    } as Environment));
    const command = { contractVersion: 1 as const, completionId: "agent-151", creationTaskId: "151",
      revision: 0, outcome: "SUCCEEDED" as const, failureCode: null, finalMessage: "海报已生成。",
      activities: [] };

    await expect(client.complete(command)).resolves.toMatchObject({ status: "SUCCEEDED", revision: 1 });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual(command);
  });
});
