import { Injectable } from "@nestjs/common";
import type { Selectable } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import type { GenerationTaskTable } from "../database/database.types.js";
import type { GenerationCompletion } from "./generation-completion.js";
import type { TaskExecuteMessage } from "./generation-task-message.js";

interface ProviderCheckpoint { providerRequestId: string | null; snapshot: string }
export type PipelinePlan =
  | { kind: "ACK" }
  | { kind: "START"; task: Selectable<GenerationTaskTable> }
  | { kind: "TRANSFER"; task: Selectable<GenerationTaskTable>; provider: ProviderCheckpoint }
  | { kind: "REPLAY"; completion: GenerationCompletion }
  | { kind: "OUTCOME_UNKNOWN"; task: Selectable<GenerationTaskTable> };

@Injectable()
export class GenerationPipelineStateService {
  constructor(private readonly database: DatabaseService) {}

  async prepare(message: TaskExecuteMessage, now: Date): Promise<PipelinePlan> {
    const task = await this.database.db.selectFrom("generation_tasks").selectAll()
      .where("id", "=", message.taskId).executeTakeFirst();
    if (!task || terminal(task.status)) return { kind: "ACK" };
    if (task.status !== "QUEUED" || task.task_version !== message.taskVersion) return { kind: "ACK" };
    let execution = await this.execution(message.taskId, message.taskVersion);
    if (!execution) {
      try {
        await this.database.db.insertInto("generation_worker_executions").values({ task_id: message.taskId,
          phase: "PIPELINE", task_version: message.taskVersion, state: "READY", result_json: null,
          created_at: now, updated_at: now }).execute();
        return { kind: "START", task };
      } catch (error) {
        execution = await this.execution(message.taskId, message.taskVersion);
        if (!execution) throw error;
      }
    }
    if (execution.state === "COMPLETED" && execution.result_json) {
      return { kind: "REPLAY", completion: parse<GenerationCompletion>(execution.result_json) };
    }
    if (execution.state === "STAGED" && execution.result_json) {
      return { kind: "TRANSFER", task, provider: parse<ProviderCheckpoint>(execution.result_json) };
    }
    if (execution.state === "CALLING") return { kind: "OUTCOME_UNKNOWN", task };
    return { kind: "START", task };
  }

  async markProviderCalling(taskId: bigint, taskVersion: number, now: Date): Promise<boolean> {
    const changed = await this.database.db.updateTable("generation_worker_executions")
      .set({ state: "CALLING", updated_at: now }).where("task_id", "=", taskId)
      .where("phase", "=", "PIPELINE").where("task_version", "=", taskVersion)
      .where("state", "=", "READY").executeTakeFirst();
    return changed.numUpdatedRows === 1n;
  }

  async saveProvider(taskId: bigint, taskVersion: number, checkpoint: ProviderCheckpoint, now: Date): Promise<void> {
    const changed = await this.database.db.updateTable("generation_worker_executions")
      .set({ state: "STAGED", result_json: JSON.stringify(checkpoint), updated_at: now })
      .where("task_id", "=", taskId).where("phase", "=", "PIPELINE").where("task_version", "=", taskVersion)
      .where("state", "=", "CALLING").executeTakeFirst();
    if (changed.numUpdatedRows !== 1n) throw new Error(`Cannot save provider checkpoint for task ${taskId}`);
  }

  async saveCompletion(completion: GenerationCompletion, commandVersion: number, now: Date): Promise<void> {
    const changed = await this.database.db.updateTable("generation_worker_executions")
      .set({ state: "COMPLETED", result_json: JSON.stringify(completion), updated_at: now })
      .where("task_id", "=", BigInt(completion.taskId)).where("phase", "=", "PIPELINE")
      .where("task_version", "=", commandVersion)
      .where("state", "in", ["READY", "CALLING", "STAGED"]).executeTakeFirst();
    if (changed.numUpdatedRows !== 1n) throw new Error(`Cannot save pipeline completion for task ${completion.taskId}`);
  }

  private execution(taskId: bigint, taskVersion: number) {
    return this.database.db.selectFrom("generation_worker_executions").selectAll()
      .where("task_id", "=", taskId).where("phase", "=", "PIPELINE")
      .where("task_version", "=", taskVersion).executeTakeFirst();
  }
}

function parse<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }
function terminal(status: string) { return ["SUCCEEDED", "PARTIALLY_SUCCEEDED", "FAILED"].includes(status); }
