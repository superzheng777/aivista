import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../src/config/environment.js";
import { GenerationCompletionClientService } from "../src/generation/generation-completion-client.service.js";
import { generationFailed } from "../src/generation/generation-completion.js";

describe("generation completion client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("authenticates and posts the discriminated completion contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ taskId: "42", status: "FAILED",
      taskVersion: 2, assets: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GenerationCompletionClientService(config());

    await client.complete(generationFailed(42n, 1, "PROVIDER_CONFIGURATION_ERROR"));

    expect(fetchMock).toHaveBeenCalledWith("http://java/api/internal/generation-worker/completion",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({
        "X-AiVista-Worker-Token": "worker-secret" }) }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({ contractVersion: 1, completionId: "generation-42-1",
      taskId: "42", taskVersion: 1, outcome: "FAILED", failureCode: "PROVIDER_CONFIGURATION_ERROR",
      providerRequestId: null });
  });

  it("fails before the network call when no worker token is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const values = { ...baseValues(), AIVISTA_GENERATION_WORKER_TOKEN: undefined } as Environment;
    const client = new GenerationCompletionClientService(new ConfigService<Environment, true>(values));

    await expect(client.complete(generationFailed(42n, 1, "PROVIDER_CONFIGURATION_ERROR")))
      .rejects.toThrow("token is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function config(): ConfigService<Environment, true> {
  return new ConfigService<Environment, true>(baseValues() as Environment);
}

function baseValues() {
  return { AIVISTA_JAVA_BASE_URL: "http://java/api", AIVISTA_GENERATION_WORKER_TOKEN: "worker-secret",
    AIVISTA_JAVA_REQUEST_TIMEOUT_MS: 10_000 };
}
