import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ImageContent } from "@earendil-works/pi-ai";
import OSS from "ali-oss";
import type { Environment } from "../config/environment.js";
import type { AgentExecutionSnapshot } from "./adapters/java-generation-client.js";

/** 从私有 OSS 读取本轮已授权图片，并转换为 Pi 官方 ImageContent。 */
@Injectable()
export class AgentImageLoaderService {
  private readonly client?: OSS;

  constructor(config: ConfigService<Environment, true>) {
    const endpoint = config.get("AIVISTA_OSS_ENDPOINT", { infer: true });
    const bucket = config.get("AIVISTA_OSS_BUCKET", { infer: true });
    const accessKeyId = config.get("AIVISTA_OSS_ACCESS_KEY_ID", { infer: true });
    const accessKeySecret = config.get("AIVISTA_OSS_ACCESS_KEY_SECRET", { infer: true });
    if (endpoint && bucket && accessKeyId && accessKeySecret) {
      this.client = new OSS({ endpoint, bucket, accessKeyId, accessKeySecret });
    }
  }

  async load(inputs: AgentExecutionSnapshot["inputAssets"]): Promise<ImageContent[]> {
    if (inputs.length === 0) return [];
    if (!this.client) throw new Error("OSS configuration is missing for Agent image input");
    return Promise.all(inputs.map(async (input) => {
      const result = await this.client!.get(input.objectKey);
      const content = result.content;
      if (!Buffer.isBuffer(content) || content.length === 0) {
        throw new Error(`Agent input asset ${input.assetId} has no readable content`);
      }
      return { type: "image", data: content.toString("base64"), mimeType: input.contentType };
    }));
  }
}
