import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OSS from "ali-oss";
import { Readable, Transform } from "node:stream";
import type { Selectable } from "kysely";
import type { Environment } from "../config/environment.js";
import type { GenerationTaskTable } from "../database/database.types.js";

export interface TransferredImage { sourceIndex: number; objectKey: string; fileSize: bigint; width: number; height: number }

@Injectable()
export class GenerationImageTransferService {
  private readonly logger = new Logger(GenerationImageTransferService.name);
  private readonly client?: OSS;
  private readonly bucket?: string;
  private readonly prefix: string;
  private readonly ttlSeconds: number;
  private readonly readTimeoutMs: number;
  constructor(config: ConfigService<Environment, true>) {
    const endpoint = config.get("AIVISTA_OSS_ENDPOINT", { infer: true }); this.bucket = config.get("AIVISTA_OSS_BUCKET", { infer: true });
    const accessKeyId = config.get("AIVISTA_OSS_ACCESS_KEY_ID", { infer: true });
    const accessKeySecret = config.get("AIVISTA_OSS_ACCESS_KEY_SECRET", { infer: true });
    if (endpoint && this.bucket && accessKeyId && accessKeySecret) this.client = new OSS({ endpoint, bucket: this.bucket, accessKeyId, accessKeySecret });
    this.prefix = config.get("AIVISTA_OSS_OBJECT_PREFIX", { infer: true });
    this.ttlSeconds = config.get("AIVISTA_OSS_SIGNED_URL_TTL_SECONDS", { infer: true });
    this.readTimeoutMs = config.get("AIVISTA_TRANSFER_SOURCE_READ_TIMEOUT_MS", { infer: true });
  }

  async transfer(task: Selectable<GenerationTaskTable>, urls: string[]): Promise<TransferredImage[]> {
    const images: TransferredImage[] = [];
    for (let index = 0; index < urls.length; index++) {
      try { images.push(await this.transferOne(task, index, urls[index]!)); }
      catch (error) { this.logger.warn(`Generation image transfer failed for task ${task.id} source index ${index}: ${errorName(error)}`); }
    }
    return images;
  }

  private async transferOne(task: Selectable<GenerationTaskTable>, sourceIndex: number, url: string): Promise<TransferredImage> {
    if (!this.client || !this.bucket) throw new Error("OSS transfer configuration is missing");
    const uri = new URL(url); if (uri.protocol !== "https:") throw new Error("Provider image URL must use HTTPS");
    const objectKey = `${this.prefix}/${task.user_id}/tasks/${task.id}/${sourceIndex}`;
    const original = `${objectKey}/original.png`;
    try {
      const response = await fetch(uri, { signal: AbortSignal.timeout(this.readTimeoutMs) });
      if (!response.ok || !response.body) throw new Error(`Provider image download failed with HTTP ${response.status}`);
      const counter = new ByteCountingTransform();
      Readable.fromWeb(response.body as never).pipe(counter);
      await this.client.put(original, counter, { headers: { "Content-Type": "image/png",
        "Cache-Control": `private, max-age=${this.ttlSeconds}` } });
      const processClient = this.client as OSS & { processObjectSave(source: string, target: string, process: string): Promise<unknown> };
      await processClient.processObjectSave(original, `${objectKey}/card.webp`, "image/resize,l_640/format,webp/quality,Q_80");
      await processClient.processObjectSave(original, `${objectKey}/display.webp`, "image/resize,l_1600/format,webp/quality,Q_85");
      return { sourceIndex, objectKey, fileSize: counter.bytes, width: task.width, height: task.height };
    } catch (error) { await this.deleteGroup(objectKey); throw error; }
  }

  private async deleteGroup(prefix: string) {
    if (!this.client) return;
    for (const key of [`${prefix}/original.png`, `${prefix}/card.webp`, `${prefix}/display.webp`]) {
      try { await this.client.delete(key); } catch (error) { this.logger.warn(`Generation image cleanup failed for object ${key}: ${errorName(error)}`); }
    }
  }
}

class ByteCountingTransform extends Transform {
  bytes = 0n;
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    this.bytes += BigInt(chunk.length); callback(null, chunk);
  }
}
function errorName(error: unknown) { return error instanceof Error ? error.name : "UnknownError"; }
