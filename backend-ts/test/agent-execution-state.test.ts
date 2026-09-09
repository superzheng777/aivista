import { describe, expect, it, vi } from "vitest";
import { AgentExecutionStateService } from "../src/agent/agent-execution-state.service.js";

describe("AgentExecutionStateService", () => {
  it("creates the minimal RUNNING ledger before starting a new Pi loop", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const database = fakeDatabase([undefined], insert);
    const service = new AgentExecutionStateService(database as never);

    await expect(service.prepare(command(), false, now())).resolves.toEqual({ kind: "START" });
    expect(insert).toHaveBeenCalledOnce();
    expect(database.db.insertInto).toHaveBeenCalledWith("agent_worker_executions");
  });

  it("marks an orphan RUNNING loop interrupted instead of rerunning side effects", async () => {
    const updateResult = vi.fn().mockResolvedValue({ numUpdatedRows: 1n });
    const database = fakeDatabase([{ state: "RUNNING", result_json: null }], vi.fn(), updateResult);
    const service = new AgentExecutionStateService(database as never);

    await expect(service.prepare(command(), false, now())).resolves.toEqual({ kind: "INTERRUPTED" });
    expect(updateResult).toHaveBeenCalledOnce();
  });

  it("replays a completed submission without starting Pi again", async () => {
    const completion = { contractVersion: 1, completionId: "agent-151" };
    const database = fakeDatabase([{ state: "COMPLETED", result_json: JSON.stringify(completion) }]);
    const service = new AgentExecutionStateService(database as never);

    await expect(service.prepare(command(), false, now())).resolves.toEqual({ kind: "REPLAY", completion });
  });
});

function command() { return { eventId: 11n, creationTaskId: 151n, revision: 0 }; }
function now() { return new Date("2026-09-09T02:00:00Z"); }

function fakeDatabase(selectResults: unknown[], insertExecute = vi.fn(), updateExecute = vi.fn()) {
  const selectExecute = vi.fn(async () => selectResults.shift());
  const selectChain: any = { selectAll: vi.fn(() => selectChain), where: vi.fn(() => selectChain),
    executeTakeFirst: selectExecute };
  const insertChain: any = { values: vi.fn(() => insertChain), execute: insertExecute };
  const updateChain: any = { set: vi.fn(() => updateChain), where: vi.fn(() => updateChain),
    executeTakeFirst: updateExecute };
  return { db: { selectFrom: vi.fn(() => selectChain), insertInto: vi.fn(() => insertChain),
    updateTable: vi.fn(() => updateChain) } };
}
