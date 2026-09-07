import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationImageTransferService } from "../src/generation/generation-image-transfer.service.js";

afterEach(() => vi.unstubAllGlobals());

describe("generation image transfer", () => {
  it("streams the original, counts bytes, and asks OSS to persist both variants", async () => {
    const oss = ossMock(); const service = createService(oss);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]))));
    const images = await service.transfer(task(), ["https://provider.example/0.png"]);
    expect(images).toEqual([{ sourceIndex: 0, objectKey: "users/7/tasks/301/0", fileSize: 4n, width: 2048, height: 2048 }]);
    expect(oss.put).toHaveBeenCalledWith("users/7/tasks/301/0/original.png", expect.anything(), { headers: {
      "Content-Type": "image/png", "Cache-Control": "private, max-age=600" } });
    expect(oss.processObjectSave).toHaveBeenNthCalledWith(1, "users/7/tasks/301/0/original.png",
      "users/7/tasks/301/0/card.webp", "image/resize,l_640/format,webp/quality,Q_80");
    expect(oss.processObjectSave).toHaveBeenNthCalledWith(2, "users/7/tasks/301/0/original.png",
      "users/7/tasks/301/0/display.webp", "image/resize,l_1600/format,webp/quality,Q_85");
  });

  it("cleans a failed object group and continues with later images", async () => {
    const oss = ossMock(); oss.processObjectSave.mockRejectedValueOnce(new Error("variant failed"));
    const service = createService(oss); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]))));
    const images = await service.transfer(task(), ["https://provider.example/0.png", "https://provider.example/1.png"]);
    expect(images).toEqual([{ sourceIndex: 1, objectKey: "users/7/tasks/301/1", fileSize: 1n, width: 2048, height: 2048 }]);
    expect(oss.delete).toHaveBeenCalledTimes(3);
  });

  it("rejects non-HTTPS source URLs per the Java boundary", async () => {
    const oss = ossMock(); const service = createService(oss);
    await expect(service.transfer(task(), ["http://provider.example/0.png"])).resolves.toEqual([]);
    expect(oss.put).not.toHaveBeenCalled();
  });
});

function createService(oss: ReturnType<typeof ossMock>) {
  const values: Record<string, unknown> = { AIVISTA_OSS_ENDPOINT: "https://oss.example", AIVISTA_OSS_BUCKET: "private",
    AIVISTA_OSS_ACCESS_KEY_ID: "id", AIVISTA_OSS_ACCESS_KEY_SECRET: "secret", AIVISTA_OSS_OBJECT_PREFIX: "users",
    AIVISTA_OSS_SIGNED_URL_TTL_SECONDS: 600, AIVISTA_TRANSFER_SOURCE_READ_TIMEOUT_MS: 30000 };
  const service = new GenerationImageTransferService({ get: (key: string) => values[key] } as never);
  Object.assign(service as any, { client: oss }); return service;
}
function ossMock() { return { put: vi.fn(async (_key: string, stream: AsyncIterable<Buffer>) => { for await (const _chunk of stream) { /* consume */ } }),
  processObjectSave: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) }; }
function task() { return { id: 301n, user_id: 7n, width: 2048, height: 2048 } as never; }
