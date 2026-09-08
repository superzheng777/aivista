import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Environment } from "../config/environment.js";
import type { GenerationCompletion } from "./generation-completion.js";

const responseSchema = z.object({
  taskId: z.string().regex(/^\d+$/),
  status: z.enum(["QUEUED", "SUCCEEDED", "PARTIALLY_SUCCEEDED", "FAILED"]),
  taskVersion: z.number().int().nonnegative(),
  assets: z.array(z.object({ assetId: z.string().regex(/^\d+$/), sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(), height: z.number().int().positive() })),
});

export type GenerationCompletionResponse = z.infer<typeof responseSchema>;

@Injectable()
export class GenerationCompletionClientService {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Environment, true>) {
    this.baseUrl = config.get("AIVISTA_JAVA_BASE_URL", { infer: true }).replace(/\/$/, "");
    this.token = config.get("AIVISTA_GENERATION_WORKER_TOKEN", { infer: true });
    this.timeoutMs = config.get("AIVISTA_JAVA_REQUEST_TIMEOUT_MS", { infer: true });
  }

  complete(completion: GenerationCompletion): Promise<GenerationCompletionResponse> {
    return this.post("completion", completion);
  }

  private async post(path: string, body: unknown): Promise<GenerationCompletionResponse> {
    if (!this.token) throw new Error("Generation worker token is not configured");
    const response = await fetch(`${this.baseUrl}/internal/generation-worker/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AiVista-Worker-Token": this.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Java generation worker API returned HTTP ${response.status}`);
    return responseSchema.parse(await response.json());
  }
}
