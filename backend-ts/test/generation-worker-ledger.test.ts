import { describe, expect, it, vi } from "vitest";
import { GenerationTaskExecutionStateService } from "../src/generation/generation-task-execution-state.service.js";
import { GenerationImageTransferStateService } from "../src/generation/generation-image-transfer-state.service.js";

const NOW = new Date("2026-09-07T00:00:00Z");

describe("generation worker execution ledger", () => {
  it("turns an interrupted provider call into outcome unknown instead of calling again", async () => {
    const db = fakeDb(task("RUNNING", 1), { state: "CALLING", result_json: null });
    const state = new GenerationTaskExecutionStateService({ db } as never);
    await expect(state.prepare(command(), NOW)).resolves.toEqual({ kind: "OUTCOME_UNKNOWN" });
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it("replays a durable result and only writes the TS-owned ledger", async () => {
    const saved = { contractVersion: 1, resultId: "provider-301-0-failed", phase: "PROVIDER", outcome: "FAILED",
      taskId: "301", taskVersion: 0, providerRequestId: null, providerResultSnapshot: null,
      declaredWidth: null, declaredHeight: null, expectedImageCount: null,
      failureCode: "PROVIDER_CALL_OUTCOME_UNKNOWN", images: [] };
    const db = fakeDb(task("RUNNING", 1), { state: "COMPLETED", result_json: JSON.stringify(saved) });
    const state = new GenerationTaskExecutionStateService({ db } as never);
    await expect(state.prepare(command(), NOW)).resolves.toEqual({ kind: "REPLAY", result: saved });
    await state.saveResult(saved as never, NOW);
    expect(db.updateTable).toHaveBeenCalledWith("generation_worker_executions");
  });

  it("allows a transfer in CALLING state to resume because OSS keys are deterministic", async () => {
    const db = fakeDb({ ...task("TRANSFERRING", 2), provider_result_snapshot: "{}" },
      { state: "CALLING", result_json: null });
    const state = new GenerationImageTransferStateService({ db } as never);
    await expect(state.prepare({ outboxEventId: 12n, taskId: 301n, taskVersion: 2 }, NOW))
      .resolves.toMatchObject({ kind: "EXECUTE", task: { id: 301n } });
  });

  it("normalizes a MySQL JSON snapshot object before transfer", async () => {
    const snapshot = { output: { task_id: "provider-task", results: [{ url: "https://example.test/image.png" }] } };
    const db = fakeDb({ ...task("TRANSFERRING", 2), provider_result_snapshot: snapshot }, null);
    const state = new GenerationImageTransferStateService({ db } as never);
    const plan = await state.prepare({ outboxEventId: 12n, taskId: 301n, taskVersion: 2 }, NOW);
    expect(plan).toMatchObject({ kind: "EXECUTE", task: { provider_result_snapshot: JSON.stringify(snapshot) } });
  });
});

function fakeDb(currentTask: any, execution: any) {
  const selectFrom = vi.fn((table: string) => chain(async () => table === "generation_tasks" ? currentTask : execution));
  const updateTable = vi.fn(() => ({ set: () => chain(async () => ({ numUpdatedRows: 1n })) }));
  return { selectFrom, updateTable, insertInto: vi.fn(() => ({ values: () => ({ execute: vi.fn() }) })) } as any;
}
function chain(result: () => Promise<any>) { const value: any = {};
  for (const name of ["selectAll", "where"]) value[name] = () => value;
  value.executeTakeFirst = result; return value; }
function command() { return { eventId: 11n, taskId: 301n, taskVersion: 0 }; }
function task(status: string, version: number) { return { id: 301n, status, task_version: version }; }
