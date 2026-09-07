import { Injectable } from "@nestjs/common";
import type { Selectable } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import type { GenerationTaskTable } from "../database/database.types.js";
import type { GenerationWorkerResult } from "./generation-worker-result.js";

export interface ImageTransferMessage { outboxEventId: bigint; taskId: bigint; taskVersion: number }
export type TransferPlan = { kind: "ACK" } | { kind: "EXECUTE"; task: Selectable<GenerationTaskTable> }
  | { kind: "REPLAY"; result: GenerationWorkerResult };

@Injectable()
export class GenerationImageTransferStateService {
  constructor(private readonly database: DatabaseService) {}

  async prepare(message: ImageTransferMessage, now: Date): Promise<TransferPlan> {
    const task = await this.database.db.selectFrom("generation_tasks").selectAll()
      .where("id", "=", message.taskId).executeTakeFirst();
    if (!task || task.status !== "TRANSFERRING" || task.task_version !== message.taskVersion) return { kind: "ACK" };
    const snapshot = normalizeSnapshot(task.provider_result_snapshot);
    if (!snapshot) return { kind: "ACK" };
    const execution = await this.execution(message.taskId, message.taskVersion);
    if (execution?.state === "COMPLETED" && execution.result_json) return { kind: "REPLAY", result: parseResult(execution.result_json) };
    if (!execution) {
      try {
        await this.database.db.insertInto("generation_worker_executions").values({ task_id: message.taskId,
          phase: "TRANSFER", task_version: message.taskVersion, state: "READY", result_json: null,
          created_at: now, updated_at: now }).execute();
      } catch (error) {
        const raced = await this.execution(message.taskId, message.taskVersion);
        if (raced?.state === "COMPLETED" && raced.result_json) return { kind: "REPLAY", result: parseResult(raced.result_json) };
        if (!raced) throw error;
      }
    }
    return { kind: "EXECUTE", task: { ...task, provider_result_snapshot: snapshot } };
  }

  async markStarted(taskId: bigint, taskVersion: number, now: Date): Promise<void> {
    await this.database.db.updateTable("generation_worker_executions").set({ state: "CALLING", updated_at: now })
      .where("task_id", "=", taskId).where("phase", "=", "TRANSFER")
      .where("task_version", "=", taskVersion).where("state", "=", "READY").execute();
  }

  async saveResult(result: GenerationWorkerResult, now: Date): Promise<void> {
    const changed = await this.database.db.updateTable("generation_worker_executions")
      .set({ state: "COMPLETED", result_json: JSON.stringify(result), updated_at: now })
      .where("task_id", "=", BigInt(result.taskId)).where("phase", "=", "TRANSFER")
      .where("task_version", "=", result.taskVersion).where("state", "in", ["READY", "CALLING"]).executeTakeFirst();
    if (changed.numUpdatedRows !== 1n) throw new Error(`Cannot save transfer result for task ${result.taskId}`);
  }

  private execution(taskId: bigint, taskVersion: number) {
    return this.database.db.selectFrom("generation_worker_executions").selectAll()
      .where("task_id", "=", taskId).where("phase", "=", "TRANSFER")
      .where("task_version", "=", taskVersion).executeTakeFirst();
  }
}

function parseResult(value: unknown): GenerationWorkerResult {
  return (typeof value === "string" ? JSON.parse(value) : value) as GenerationWorkerResult;
}

function normalizeSnapshot(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (value && typeof value === "object") return JSON.stringify(value);
  return undefined;
}
