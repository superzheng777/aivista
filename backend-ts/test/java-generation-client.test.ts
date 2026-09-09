import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JavaGenerationApiError, JavaGenerationClient } from "../src/agent/adapters/java-generation-client.js";
import type { Environment } from "../src/config/environment.js";
import type { GenerationToolRequest } from "../src/agent/tools/index.js";

afterEach(() => vi.unstubAllGlobals());

describe("JavaGenerationClient", () => {
  it("creates an Agent child generation task with worker authentication and idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      taskId: "301", sessionId: "101", status: "QUEUED", taskVersion: 0,
      requestedImageCount: 1, createdAt: "2026-09-09T02:00:00Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new JavaGenerationClient(config());

    const result = await client.createTask("151", "b719c741-8607-4b0f-9a72-2dcbfdd6b6ee", request());

    expect(result.taskId).toBe("301");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://java/api/internal/generation-worker/agent-creations/151/generation-tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-AiVista-Worker-Token": "worker-secret",
          "Idempotency-Key": "b719c741-8607-4b0f-9a72-2dcbfdd6b6ee",
        }),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual(request());
  });

  it("preserves Java business code and safe message for Tool error mapping", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 42901, message: "今日生成图片额度已用尽", data: null,
    }), { status: 429, headers: { "Content-Type": "application/json" } })));
    const client = new JavaGenerationClient(config());

    const error = await client.createTask("151", "b719c741-8607-4b0f-9a72-2dcbfdd6b6ee", request())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(JavaGenerationApiError);
    expect(error).toMatchObject({ status: 429, code: 42901, message: "今日生成图片额度已用尽" });
  });

  it("loads and validates the minimal Agent execution snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      contractVersion: 1, creationTaskId: "151", revision: 0, status: "RUNNING", sessionId: "101",
      prompt: "把这张图改成海报", history: [{ role: "USER", content: "上一轮" }],
      inputAssets: [{ assetId: "501", objectKey: "users/7/x/display.webp",
        contentType: "image/webp", fileSize: 1234, width: 800, height: 1200 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new JavaGenerationClient(config());

    const result = await client.getAgentExecution("151");

    expect(result.inputAssets[0]?.contentType).toBe("image/webp");
    expect(result.history).toEqual([{ role: "USER", content: "上一轮" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://java/api/internal/generation-worker/agent-creations/151/execution",
      expect.objectContaining({ headers: { "X-AiVista-Worker-Token": "worker-secret" } }),
    );
  });

  it("does not call Java without the configured worker credential", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const values = { ...baseValues(), AIVISTA_GENERATION_WORKER_TOKEN: undefined } as Environment;
    const client = new JavaGenerationClient(new ConfigService<Environment, true>(values));

    await expect(client.createTask("151", "b719c741-8607-4b0f-9a72-2dcbfdd6b6ee", request()))
      .rejects.toThrow("token is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function request(): GenerationToolRequest {
  return {
    operation: "TEXT_TO_IMAGE", prompt: "夏日饮品海报", negativePrompt: null,
    aspectRatio: "3:4", inputAssetIds: [], promptExtend: true, imageCount: 1,
  };
}

function config(): ConfigService<Environment, true> {
  return new ConfigService<Environment, true>(baseValues() as Environment);
}

function baseValues() {
  return { AIVISTA_JAVA_BASE_URL: "http://java/api", AIVISTA_GENERATION_WORKER_TOKEN: "worker-secret",
    AIVISTA_JAVA_REQUEST_TIMEOUT_MS: 10_000 };
}
