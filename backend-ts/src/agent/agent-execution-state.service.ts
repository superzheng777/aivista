import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type { AgentExecuteMessage } from "./agent-execute-message.js";
import type { AgentCompletionCommand } from "./adapters/java-agent-completion-client.js";

export type AgentExecutionPlan =
  | { kind: "START" }
  | { kind: "ACK" }
  | { kind: "REPLAY"; completion: AgentCompletionCommand }
  | { kind: "INTERRUPTED" };

/** 单实例 Agent 执行账本；不使用租约或周期扫描。 */
@Injectable()
export class AgentExecutionStateService {
  constructor(private readonly database: DatabaseService) {}

  async prepare(command: AgentExecuteMessage, activeInThisProcess: boolean, now: Date): Promise<AgentExecutionPlan> {
    let execution = await this.find(command.creationTaskId);
    if (!execution) {
      try {
        await this.database.db.insertInto("agent_worker_executions").values({
          creation_task_id: command.creationTaskId,
          state: "RUNNING",
          result_json: null,
          started_at: now,
          completed_at: null,
          updated_at: now,
        }).execute();
        return { kind: "START" };
      } catch (error) {
        execution = await this.find(command.creationTaskId);
        if (!execution) throw error;
      }
    }
    if (execution.state === "COMPLETED" && execution.result_json) {
      return { kind: "REPLAY", completion: parse(execution.result_json) };
    }
    if (execution.state === "RUNNING" && activeInThisProcess) return { kind: "ACK" };
    if (execution.state === "RUNNING") {
      const changed = await this.database.db.updateTable("agent_worker_executions")
        .set({ state: "INTERRUPTED", completed_at: now, updated_at: now })
        .where("creation_task_id", "=", command.creationTaskId)
        .where("state", "=", "RUNNING")
        .executeTakeFirst();
      if (changed.numUpdatedRows === 1n) return { kind: "INTERRUPTED" };
      return this.prepare(command, activeInThisProcess, now);
    }
    return { kind: "ACK" };
  }

  async saveCompletion(creationTaskId: bigint, completion: AgentCompletionCommand, now: Date): Promise<void> {
    const changed = await this.database.db.updateTable("agent_worker_executions")
      .set({ state: "COMPLETED", result_json: JSON.stringify(completion), completed_at: now, updated_at: now })
      .where("creation_task_id", "=", creationTaskId)
      .where("state", "=", "RUNNING")
      .executeTakeFirst();
    if (changed.numUpdatedRows !== 1n) {
      throw new Error(`Cannot save Agent completion for creation ${creationTaskId}`);
    }
  }

  private find(creationTaskId: bigint) {
    return this.database.db.selectFrom("agent_worker_executions").selectAll()
      .where("creation_task_id", "=", creationTaskId).executeTakeFirst();
  }
}

function parse(value: unknown): AgentCompletionCommand {
  return (typeof value === "string" ? JSON.parse(value) : value) as AgentCompletionCommand;
}
