import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationBailianClientService } from "../src/generation/generation-bailian-client.service.js";
import { BailianConnectionError, BailianProviderError } from "../src/generation/generation-provider-error.js";

afterEach(() => vi.unstubAllGlobals());

describe("generation Bailian client", () => {
  it("builds the Java-equivalent multimodal request and validates a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, successBody()));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient([{ asset_id: 9n, source_index: 0 }], [{ id: 9n, original_object_key: "users/7/original.png" }]);
    const result = await client.generate(task());
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ model: "qwen-image-2.0", input: { messages: [{ role: "user", content: [
      { image: "signed:users/7/original.png" }, { text: "a city" },
    ] }] }, parameters: { negative_prompt: "", size: "2048*2048", n: 1, prompt_extend: true, watermark: false } });
    expect(init.headers).toMatchObject({ authorization: "Bearer secret", "x-dashscope-wait-timeout": "30" });
    expect(result).toMatchObject({ requestId: "req-1", imageUrls: ["https://provider/image.png"],
      declaredImageCount: 1, declaredWidth: 2048, declaredHeight: 2048 });
    expect(client.restore(result.snapshot).imageUrls).toEqual(result.imageUrls);
  });

  it("preserves official error fields from a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(429, { code: "Throttling", message: "slow", request_id: "req-2" })));
    await expect(createClient([], []).generate(task())).rejects.toMatchObject({
      name: "BailianProviderError", httpStatus: 429, providerCode: "Throttling", requestId: "req-2",
    });
  });

  it("classifies fetch and response-body failures as connection failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(createClient([], []).generate(task())).rejects.toBeInstanceOf(BailianConnectionError);
  });

  it("rejects malformed success responses and mismatched image counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(200, { request_id: "req-3", output: { choices: [] }, usage: {} }))
      .mockResolvedValueOnce(response(200, successBody())));
    const client = createClient([], []);
    await expect(client.generate(task())).rejects.toBeInstanceOf(BailianProviderError);
    await expect(client.generate({ ...task(), requested_image_count: 2 })).rejects.toMatchObject({ httpStatus: 200, providerCode: null });
  });
});

function createClient(inputs: any[], assets: any[]) {
  const db = { selectFrom: (table: string) => chain(table === "generation_task_input_assets" ? inputs : assets) };
  const config = { get: (key: string) => ({ AIVISTA_BAILIAN_ENDPOINT: "https://bailian.example/generate",
    AIVISTA_BAILIAN_API_KEY: "secret", AIVISTA_BAILIAN_READ_TIMEOUT_MS: 330_000 } as Record<string, unknown>)[key] };
  return new GenerationBailianClientService(config as never, { db } as never,
    { original: (key: string) => `signed:${key}` } as never);
}

function chain(result: any[]) { const query: any = {}; for (const name of ["select", "where", "orderBy"]) query[name] = () => query;
  query.execute = async () => result; return query; }

function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status }); }
function successBody() { return { request_id: "req-1", output: { choices: [{ finish_reason: "stop", message: { content: [
  { image: "https://provider/image.png" }, { text: "ignored" },
] } }] }, usage: { output_image_count: 1, output_width: 2048, output_height: 2048 } }; }
function task() { return { id: 301n, user_id: 7n, session_id: 1n, creation_task_id: 1n, operation: "TEXT_TO_IMAGE",
  model: "bailian/qwen-image-2.0", status: "RUNNING", task_version: 1, attempt_count: 0,
  provider_call_started_at: null, final_prompt: "a city", final_negative_prompt: null, width: 2048, height: 2048,
  prompt_extend: true, requested_image_count: 1, completed_image_count: 0, quota_refunded_at: null,
  provider_request_id: null, provider_result_snapshot: null, failure_code: null, created_at: new Date(), updated_at: new Date(),
  started_at: new Date(), completed_at: null, transfer_started_at: null }; }
