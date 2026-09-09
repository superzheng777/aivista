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

export const agentActivityCommandSchema = z.object({
  contractVersion: z.literal(1),
  creationTaskId: z.string().regex(/^\d+$/),
  revision: z.number().int().nonnegative(),
  activities: z.array(activitySchema).min(1).max(20),
});

const responseSchema = z.object({
  creationTaskId: z.string().regex(/^\d+$/),
  revision: z.number().int().nonnegative(),
  activities: z.array(z.object({
    activityKey: z.string(), sequenceNo: z.number().int().positive(),
    state: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
  })),
});

export type AgentActivityCommand = z.infer<typeof agentActivityCommandSchema>;
export type AgentActivityResponse = z.infer<typeof responseSchema>;

@Injectable()
export class JavaAgentActivityClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Environment, true>) {
    this.baseUrl = config.get("AIVISTA_JAVA_BASE_URL", { infer: true }).replace(/\/$/, "");
    this.token = config.get("AIVISTA_GENERATION_WORKER_TOKEN", { infer: true });
    this.timeoutMs = config.get("AIVISTA_JAVA_REQUEST_TIMEOUT_MS", { infer: true });
  }

  async submit(command: AgentActivityCommand, signal?: AbortSignal): Promise<AgentActivityResponse> {
    if (!this.token) throw new Error("Generation worker token is not configured");
    const value = agentActivityCommandSchema.parse(command);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(`${this.baseUrl}/internal/generation-worker/agent-creations/${value.creationTaskId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AiVista-Worker-Token": this.token },
      body: JSON.stringify(value),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new JavaGenerationApiError(response.status, undefined,
      `Java Agent activity API returned HTTP ${response.status}`);
    return responseSchema.parse(await response.json());
  }
}
