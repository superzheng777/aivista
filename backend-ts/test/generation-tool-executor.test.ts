import { describe, expect, it, vi } from "vitest";
import { AgentGenerationToolExecutor } from "../src/agent/tools/generation-executor.js";
import type { GenerationToolRequest } from "../src/agent/tools/generation.js";

describe("AgentGenerationToolExecutor", () => {
  it("creates, waits, and returns authoritative image asset IDs", async () => {
    const java = { createTask: vi.fn().mockResolvedValue({ taskId: "301" }) };
    const completions = { wait: vi.fn().mockResolvedValue({ taskId: "301", status: "SUCCEEDED",
      taskVersion: 1, failureCode: null, assets: [{ assetId: "501" }] }) };
    const executor = new AgentGenerationToolExecutor({ creationTaskId: "151",
      java: java as never, completions: completions as never });

    await expect(executor.execute("call-1", request())).resolves.toEqual({
      outcome: "SUCCEEDED", taskId: "301", imageAssetIds: ["501"],
    });
    expect(java.createTask).toHaveBeenCalledWith("151",
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      request(), expect.any(AbortSignal));
    expect(completions.wait).toHaveBeenCalledWith("301", expect.any(AbortSignal));
  });

  it("uses the same idempotency key for the same Pi Tool call", async () => {
    const java = { createTask: vi.fn().mockResolvedValue({ taskId: "301" }) };
    const completions = { wait: vi.fn().mockResolvedValue({ taskId: "301", status: "FAILED",
      taskVersion: 1, failureCode: "PROVIDER_RATE_LIMITED", assets: [] }) };
    const executor = new AgentGenerationToolExecutor({ creationTaskId: "151",
      java: java as never, completions: completions as never });

    await executor.execute("call-1", request());
    await executor.execute("call-1", request());
    expect(java.createTask.mock.calls[0]?.[1]).toBe(java.createTask.mock.calls[1]?.[1]);
  });
});

function request(): GenerationToolRequest {
  return { operation: "TEXT_TO_IMAGE", prompt: "海报", negativePrompt: null, aspectRatio: "3:4",
    inputAssetIds: [], promptExtend: true, imageCount: 1 };
}
