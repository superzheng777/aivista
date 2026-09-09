import { describe, expect, it, vi } from "vitest";
import { AgentImageLoaderService } from "../src/agent/agent-image-loader.service.js";

describe("AgentImageLoaderService", () => {
  it("loads ordered private objects as Pi ImageContent", async () => {
    const service = createService({ get: vi.fn()
      .mockResolvedValueOnce({ content: Buffer.from([1, 2]) })
      .mockResolvedValueOnce({ content: Buffer.from([3]) }) });

    const images = await service.load([
      input("501", "users/7/a/display.webp", "image/webp"),
      input("502", "users/7/b/original.jpg", "image/jpeg"),
    ]);

    expect(images).toEqual([
      { type: "image", data: "AQI=", mimeType: "image/webp" },
      { type: "image", data: "Aw==", mimeType: "image/jpeg" },
    ]);
  });

  it("does not require OSS configuration for a text-only prompt", async () => {
    const service = new AgentImageLoaderService({ get: vi.fn() } as never);
    await expect(service.load([])).resolves.toEqual([]);
  });
});

function createService(client: { get: ReturnType<typeof vi.fn> }) {
  const config = { get: (key: string) => ({ AIVISTA_OSS_ENDPOINT: "oss.example", AIVISTA_OSS_BUCKET: "private",
    AIVISTA_OSS_ACCESS_KEY_ID: "id", AIVISTA_OSS_ACCESS_KEY_SECRET: "secret" })[key] };
  const service = new AgentImageLoaderService(config as never);
  Object.assign(service as object, { client });
  return service;
}

function input(assetId: string, objectKey: string, contentType: "image/webp" | "image/jpeg") {
  return { assetId, objectKey, contentType, fileSize: 100, width: 800, height: 1200 };
}
