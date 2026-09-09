import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JavaAgentActivityClient } from "../src/agent/adapters/java-agent-activity-client.js";
import type { Environment } from "../src/config/environment.js";

afterEach(() => vi.unstubAllGlobals());

describe("JavaAgentActivityClient", () => {
  it("submits a validated stable Activity batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      creationTaskId: "151", revision: 0,
      activities: [{ activityKey: "tool:call-1", sequenceNo: 1, state: "RUNNING" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new JavaAgentActivityClient(new ConfigService<Environment, true>({
      AIVISTA_JAVA_BASE_URL: "http://127.0.0.1:8888/api",
      AIVISTA_GENERATION_WORKER_TOKEN: "worker-token",
      AIVISTA_JAVA_REQUEST_TIMEOUT_MS: 10_000,
    } as Environment));

    await expect(client.submit({ contractVersion: 1, creationTaskId: "151", revision: 0, activities: [{
      activityKey: "tool:call-1", type: "TOOL", state: "RUNNING", content: "正在执行文生图。",
      toolName: "text_to_image", generationTaskId: null,
      startedAt: "2026-09-09T01:00:00.000Z", completedAt: null,
    }] })).resolves.toMatchObject({ creationTaskId: "151" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8888/api/internal/generation-worker/agent-creations/151/activities",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
