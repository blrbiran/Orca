import { createExecutionDriver, DriverCrash, type CrashPoint } from "../../../src/control/executionDriver.js";
import { readBudgetProposal } from "../../../src/control/queries.js";
import type { ControlStore } from "../../../src/control/store.js";
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

/**
 * The same readings over a bare store, for criteria that hold an assembled runtime instead of a harness
 * (handoffE2E.test.ts, Task 9). The harness forms below delegate to these, so there is one query each.
 */
export const storeReadings = {
  requestState: (store: ControlStore, requestId: string): string => readHandoffRequest(store, "g", requestId).request.state,
  work: (store: ControlStore, taskId: string) =>
    JSON.parse(String(store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)),
  allocation: (store: ControlStore, taskId: string) =>
    readBudgetProposal(store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!,
  /** The group's reserved plus used, per dimension: booking usage moves an amount from one to the other, releasing a commitment lowers it. */
  committedAndUsed: (store: ControlStore): number[] => {
    const group = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
    return (["tokens", "activeMs", "attempts", "sessions"] as const).map((d) => group.reserved[d] + group.used[d]);
  },
  active: (store: ControlStore, runId: string): number => Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active),
};

export const requestState = (t: Harness, requestId: string): string => storeReadings.requestState(t.h.store, requestId);

export const requestBody = (t: Harness, requestId: string) => readHandoffRequest(t.h.store, "g", requestId).request;

/** The newest request a run owns. */
export const requestOf = (t: Harness, runId: string): string =>
  String(t.h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=? ORDER BY rowid DESC LIMIT 1").get(runId)!.id);

export const work = (t: Harness, taskId: string) => storeReadings.work(t.h.store, taskId);

export const allocation = (t: Harness, taskId: string) => storeReadings.allocation(t.h.store, taskId);

/** The group's reserved plus used, per dimension: booking usage moves an amount from one to the other, releasing a commitment lowers it. */
export const committedAndUsed = (t: Harness): number[] => storeReadings.committedAndUsed(t.h.store);

export const active = (t: Harness, runId: string): number => storeReadings.active(t.h.store, runId);

/** A driver over the harness's deps that dies (as a process death would) at `point`. */
export const crashingAt = (t: Harness, point: CrashPoint) =>
  createExecutionDriver({ ...t.deps, crash: (at) => { if (at === point) throw new DriverCrash(at); } });
