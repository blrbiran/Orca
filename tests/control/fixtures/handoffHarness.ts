import { createExecutionDriver, DriverCrash, type CrashPoint } from "../../../src/control/executionDriver.js";
import { readBudgetProposal } from "../../../src/control/queries.js";
import { readHandoffRequest } from "../../../src/control/stopIntent.js";
import type { driverHarness } from "./driverHarness.js";

/**
 * Handoff delivery (Task 4, preflight I11): the helpers every step-H criterion needs on top of `driverHarness` --
 * freezing the group with a handoff-stop, reading a request's state, and the ledger readings the held/parked
 * assertions compare. Shared so the continuation (Task 5) and E2E (Task 9) criteria import them, not copy them.
 */
export type Harness = Awaited<ReturnType<typeof driverHarness>>;

/** A `handoff-stop` for group `g`: every active run frozen, one request each; answers the request ids. */
export async function stop(t: Harness): Promise<string[]> {
  const result = await t.service.handoffStop(t.h.command("handoff-stop", {}));
  if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(result)}`);
  return result.result.requestIds;
}

export const requestState = (t: Harness, requestId: string): string => readHandoffRequest(t.h.store, "g", requestId).request.state;

export const requestBody = (t: Harness, requestId: string) => readHandoffRequest(t.h.store, "g", requestId).request;

/** The newest request a run owns. */
export const requestOf = (t: Harness, runId: string): string =>
  String(t.h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=? ORDER BY rowid DESC LIMIT 1").get(runId)!.id);

export const work = (t: Harness, taskId: string) =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));

export const allocation = (t: Harness, taskId: string) =>
  readBudgetProposal(t.h.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!;

/** The group's reserved plus used, per dimension: booking usage moves an amount from one to the other, releasing a commitment lowers it. */
export const committedAndUsed = (t: Harness): number[] => {
  const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  return (["tokens", "activeMs", "attempts", "sessions"] as const).map((d) => group.reserved[d] + group.used[d]);
};

export const active = (t: Harness, runId: string): number =>
  Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);

/** A driver over the harness's deps that dies (as a process death would) at `point`. */
export const crashingAt = (t: Harness, point: CrashPoint) =>
  createExecutionDriver({ ...t.deps, crash: (at) => { if (at === point) throw new DriverCrash(at); } });
