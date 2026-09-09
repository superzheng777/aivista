import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Environment } from "../../config/environment.js";
import { JavaGenerationApiError } from "./java-generation-client.js";

const activitySchema = z.object({
  activityKey: z.string().min(1).max(128),
  type: z.enum(["NARRATION", "SKILL", "TOOL"]),
  state: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
  content: z.string().min(1).max(1_000),
  toolName: z.string().min(1).max(64).nullable(),
  generationTaskId: z.string().regex(/^\d+$/).nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const agentCompletionCommandSchema = z.object({
  contractVersion: z.literal(1),
  completionId: z.string().regex(/^agent-\d+$/),
  creationTaskId: z.string().regex(/^\d+$/),
  revision: z.number().int().nonnegative(),
  outcome: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
  failureCode: z.string().min(1).max(64).nullable(),
  finalMessage: z.string().min(1).max(8_000).nullable(),
  activities: z.array(activitySchema).max(100),
}).superRefine((value, context) => {
  if (value.outcome === "SUCCEEDED" && value.finalMessage === null) {
    context.addIssue({ code: "custom", message: "A successful Agent completion requires finalMessage" });
  }
  if (value.outcome === "FAILED" && value.failureCode === null) {
    context.addIssue({ code: "custom", message: "A failed Agent completion requires failureCode" });
  }
});

const responseSchema = z.object({
  creationTaskId: z.string().regex(/^\d+$/),
  status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
  revision: z.number().int().positive(),
  failureCode: z.string().nullable(),
  finalMessage: z.string().nullable(),
});

export type AgentCompletionCommand = z.infer<typeof agentCompletionCommandSchema>;
export type AgentCompletionResponse = z.infer<typeof responseSchema>;

@Injectable()
export class JavaAgentCompletionClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Environment, true>) {
    this.baseUrl = config.get("AIVISTA_JAVA_BASE_URL", { infer: true }).replace(/\/$/, "");
    this.token = config.get("AIVISTA_GENERATION_WORKER_TOKEN", { infer: true });
    this.timeoutMs = config.get("AIVISTA_JAVA_REQUEST_TIMEOUT_MS", { infer: true });
  }

  async complete(command: AgentCompletionCommand, signal?: AbortSignal): Promise<AgentCompletionResponse> {
    if (!this.token) throw new Error("Generation worker token is not configured");
    const value = agentCompletionCommandSchema.parse(command);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(`${this.baseUrl}/internal/generation-worker/agent-creations/${value.creationTaskId}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AiVista-Worker-Token": this.token },
      body: JSON.stringify(value),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new JavaGenerationApiError(response.status, undefined,
      `Java Agent completion API returned HTTP ${response.status}`);
    return responseSchema.parse(await response.json());
  }
}
