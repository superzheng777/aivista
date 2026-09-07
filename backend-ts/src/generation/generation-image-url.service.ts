import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OSS from "ali-oss";
import type { Environment } from "../config/environment.js";

@Injectable()
export class GenerationImageUrlService {
  private readonly ttlSeconds: number;
  private readonly client: OSS | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.ttlSeconds = config.get("AIVISTA_OSS_SIGNED_URL_TTL_SECONDS", { infer:true });
    const endpoint = config.get("AIVISTA_OSS_ENDPOINT", { infer:true });
    const bucket = config.get("AIVISTA_OSS_BUCKET", { infer:true });
    const accessKeyId = config.get("AIVISTA_OSS_ACCESS_KEY_ID", { infer:true });
    const accessKeySecret = config.get("AIVISTA_OSS_ACCESS_KEY_SECRET", { infer:true });
    if (endpoint && bucket && accessKeyId && accessKeySecret) {
      this.client = new OSS({ endpoint, bucket, accessKeyId, accessKeySecret });
    }
  }

  urls(prefix: string, now = new Date()): {thumbnail:SignedImageUrl;display:SignedImageUrl} {
    if (!this.client) throw new Error("OSS signing configuration is missing");
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    return {
      thumbnail:{url:this.client.signatureUrl(`${prefix}/card.webp`,{expires:this.ttlSeconds}),expiresAt},
      display:{url:this.client.signatureUrl(`${prefix}/display.webp`,{expires:this.ttlSeconds}),expiresAt},
    };
  }

  original(objectKey: string): string {
    if (!this.client) throw new Error("OSS signing configuration is missing");
    return this.client.signatureUrl(objectKey, { expires: this.ttlSeconds });
  }

  signed(objectKey: string, ttlSeconds = this.ttlSeconds, now = new Date()): SignedImageUrl {
    if (!this.client) throw new Error("OSS signing configuration is missing");
    return { url: this.client.signatureUrl(objectKey, { expires: ttlSeconds }),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000) };
  }
}

export interface SignedImageUrl { url:string; expiresAt:Date }
