import { expect } from "vitest";
import type { LoopInputs } from "../../../src/control/loopPlans.js";
import { readBudgetProposal } from "../../../src/control/queries.js";
import { readCanonicalRecord } from "../../../src/control/snapshot.js";
import { readWebGroup } from "../../../src/control/webService.js";
import type { webFixture } from "./web.js";

/** Loop plans plan Tasks B2-B7: the loop tasks and set-task-loop helpers every Part B criterion shares. */
export type Fixture = Awaited<ReturnType<typeof webFixture>>;
export const DIMENSIONS = ["tokens", "activeMs", "attempts", "sessions"] as const;
/** A standard-plan loop task writing the one file the synthetic ccloop writes for it (driverPort.ts: `{ [id]: "id\n" }`). */
export const loop = (taskId: string) => ({ plan: "standard", goal: `write ${taskId}`, successCondition: `${taskId} exists`, targetPaths: [taskId], checks: ["true"] });
export const inputs = (taskId: string, over: Partial<LoopInputs> = {}): LoopInputs => ({
  goal: `write ${taskId}`, successCondition: `${taskId} exists`, targetPaths: [taskId], checks: ["true"],
  nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null, ...over,
});
export const workAllocation = (h: Fixture, taskId: string) =>
  readBudgetProposal(h.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!;
export interface Change { base?: number; plan?: string; inputs?: Partial<LoopInputs>; tokens?: number; activeMs?: number; attempts?: number }
/** A set-task-loop under the group's current revision; unspecified budget dimensions keep the task's current amount. */
export const change = (h: Fixture, taskId: string, c: Change = {}) => {
  const work = workAllocation(h, taskId).amount;
  return h.taskCommand("set-task-loop", taskId, {
    baseLoopVersion: c.base ?? 0, plan: c.plan ?? "standard", inputs: inputs(taskId, c.inputs),
    work: { tokens: c.tokens ?? work.tokens, activeMs: c.activeMs ?? work.activeMs, attempts: c.attempts ?? work.attempts },
  });
};
export const errorOf = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error;
export const workBody = (h: Fixture, taskId: string): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
export const writeWork = (h: Fixture, taskId: string, patch: Record<string, unknown>): void => {
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...workBody(h, taskId), ...patch }), taskId);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const writeGroup = (h: Fixture, patch: (body: Record<string, any>) => void): void => {
  const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  patch(body);
  h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const snapshotOf = (h: Fixture): any => JSON.parse(readCanonicalRecord(h.store, readBudgetProposal(h.store, "g").executionSnapshotHash!));
/** Spec §6 criterion 9: per dimension, reserved + reserve = limit - used, and the reserve row is the ledger's reserve. */
export function expectConserved(h: Fixture): void {
  const group = readWebGroup(h.store, "g");
  const reserveRow = readBudgetProposal(h.store, "g").allocations.find((a) => a.ownerKind === "reserve")!.amount;
  for (const d of DIMENSIONS) {
    expect(group.reserved[d] + group.ledger.explicitUnallocatedReserve[d]).toBe(group.limit[d] - group.used[d]);
    expect(reserveRow[d]).toBe(group.ledger.explicitUnallocatedReserve[d]);
  }
}
