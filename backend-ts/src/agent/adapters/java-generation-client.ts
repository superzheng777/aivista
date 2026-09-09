import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Environment } from "../../config/environment.js";
import type { GenerationToolRequest } from "../tools/index.js";

const responseSchema = z.object({
  taskId: z.string().regex(/^\d+$/),
  sessionId: z.string().regex(/^\d+$/),
  status: z.literal("QUEUED"),
  taskVersion: z.number().int().nonnegative(),
  requestedImageCount: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
});

const agentExecutionSchema = z.object({
  contractVersion: z.literal(1),
  creationTaskId: z.string().regex(/^\d+$/),
  revision: z.number().int().nonnegative(),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
  sessionId: z.string().regex(/^\d+$/),
  prompt: z.string().min(1),
  history: z.array(z.object({ role: z.enum(["USER", "ASSISTANT"]), content: z.string().min(1) })).max(12),
  inputAssets: z.array(z.object({
    assetId: z.string().regex(/^\d+$/),
    objectKey: z.string().min(1),
    contentType: z.enum(["image/webp", "image/png", "image/jpeg"]),
    fileSize: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })).max(3),
});

const errorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
}).passthrough();

export type AgentGenerationTaskResponse = z.infer<typeof responseSchema>;
export type AgentExecutionSnapshot = z.infer<typeof agentExecutionSchema>;

export class JavaGenerationApiError extends Error {
  constructor(readonly status: number, readonly code: number | undefined, message: string) {
    super(message);
    this.name = "JavaGenerationApiError";
  }
}

@Injectable()
export class JavaGenerationClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Environment, true>) {
    this.baseUrl = config.get("AIVISTA_JAVA_BASE_URL", { infer: true }).replace(/\/$/, "");
    this.token = config.get("AIVISTA_GENERATION_WORKER_TOKEN", { infer: true });
    this.timeoutMs = config.get("AIVISTA_JAVA_REQUEST_TIMEOUT_MS", { infer: true });
  }

  async createTask(creationTaskId: string, idempotencyKey: string,
      request: GenerationToolRequest, signal?: AbortSignal): Promise<AgentGenerationTaskResponse> {
    this.requireReady(creationTaskId);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(
      `${this.baseUrl}/internal/generation-worker/agent-creations/${creationTaskId}/generation-tasks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AiVista-Worker-Token": this.token,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(request),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (!response.ok) throw await apiError(response);
    return responseSchema.parse(await response.json());
  }

  async getAgentExecution(creationTaskId: string, signal?: AbortSignal): Promise<AgentExecutionSnapshot> {
    this.requireReady(creationTaskId);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(
      `${this.baseUrl}/internal/generation-worker/agent-creations/${creationTaskId}/execution`,
      {
        headers: { "X-AiVista-Worker-Token": this.token! },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (!response.ok) throw await apiError(response);
    return agentExecutionSchema.parse(await response.json());
  }

  private requireReady(creationTaskId: string): void {
    if (!this.token) throw new Error("Generation worker token is not configured");
    if (!/^\d+$/.test(creationTaskId) || creationTaskId === "0") {
      throw new TypeError("creationTaskId must be a positive integer ID");
    }
  }
}

async function apiError(response: Response): Promise<JavaGenerationApiError> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    if (parsed.success) {
      return new JavaGenerationApiError(response.status, parsed.data.code, parsed.data.message);
    }
  } catch {
    // Normalize non-JSON infrastructure responses without exposing their body.
  }
  return new JavaGenerationApiError(response.status, undefined,
    `Java generation worker API returned HTTP ${response.status}`);
}
