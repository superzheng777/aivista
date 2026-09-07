import { Injectable } from "@nestjs/common";
import type { Selectable } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import type { GenerationTaskTable } from "../database/database.types.js";
import type { GenerationWorkerResult } from "./generation-worker-result.js";

export interface TaskExecuteMessage { eventId: bigint; taskId: bigint; taskVersion: number }
export type ExecutionPlan = { kind: "ACK" } | { kind: "EXECUTE"; task: Selectable<GenerationTaskTable> }
  | { kind: "REPLAY"; result: GenerationWorkerResult } | { kind: "OUTCOME_UNKNOWN" };

@Injectable()
export class GenerationTaskExecutionStateService {
  constructor(private readonly database: DatabaseService) {}

  async prepare(message: TaskExecuteMessage, now: Date): Promise<ExecutionPlan> {
    const task = await this.database.db.selectFrom("generation_tasks").selectAll()
      .where("id", "=", message.taskId).executeTakeFirst();
    if (!task || !(task.status === "QUEUED" && task.task_version === message.taskVersion)
      && !(task.status === "RUNNING" && task.task_version === message.taskVersion + 1)) return { kind: "ACK" };
    const execution = await this.execution(message.taskId, message.taskVersion);
    if (execution?.state === "COMPLETED" && execution.result_json) return { kind: "REPLAY", result: parseResult(execution.result_json) };
    if (execution?.state === "CALLING") return { kind: "OUTCOME_UNKNOWN" };
    if (!execution) {
      try {
        await this.database.db.insertInto("generation_worker_executions").values({ task_id: message.taskId,
          phase: "PROVIDER", task_version: message.taskVersion, state: "READY", result_json: null,
          created_at: now, updated_at: now }).execute();
      } catch (error) {
        const raced = await this.execution(message.taskId, message.taskVersion);
        if (raced?.state === "COMPLETED" && raced.result_json) return { kind: "REPLAY", result: parseResult(raced.result_json) };
        if (raced?.state === "CALLING") return { kind: "OUTCOME_UNKNOWN" };
        if (!raced) throw error;
      }
    }
    return { kind: "EXECUTE", task };
  }

  async markProviderCallStarted(taskId: bigint, taskVersion: number, now: Date): Promise<boolean> {
    const changed = await this.database.db.updateTable("generation_worker_executions")
      .set({ state: "CALLING", updated_at: now }).where("task_id", "=", taskId)
      .where("phase", "=", "PROVIDER").where("task_version", "=", taskVersion)
      .where("state", "=", "READY").executeTakeFirst();
    return changed.numUpdatedRows === 1n;
  }

  async saveResult(result: GenerationWorkerResult, now: Date): Promise<void> {
    const changed = await this.database.db.updateTable("generation_worker_executions")
      .set({ state: "COMPLETED", result_json: JSON.stringify(result), updated_at: now })
      .where("task_id", "=", BigInt(result.taskId)).where("phase", "=", "PROVIDER")
      .where("task_version", "=", result.taskVersion).where("state", "in", ["READY", "CALLING"]).executeTakeFirst();
    if (changed.numUpdatedRows !== 1n) throw new Error(`Cannot save provider result for task ${result.taskId}`);
  }

  private execution(taskId: bigint, taskVersion: number) {
    return this.database.db.selectFrom("generation_worker_executions").selectAll()
      .where("task_id", "=", taskId).where("phase", "=", "PROVIDER")
      .where("task_version", "=", taskVersion).executeTakeFirst();
  }
}

function parseResult(value: unknown): GenerationWorkerResult {
  return (typeof value === "string" ? JSON.parse(value) : value) as GenerationWorkerResult;
}
