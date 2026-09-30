import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { readConfirmedTaskExecution, replaceTaskInSnapshot } from "../../src/control/executionSnapshot.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { recordUsage } from "../../src/control/usage.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { executionSnapshotSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { change, errorOf, expectConserved, loop, snapshotOf, workAllocation, workBody } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §5.2 steps 6-8 (criteria 9, 10, 11, 12; R2, R3). After confirmation a change moves the budget with the
 * ledger conserved, keeps proposalVersion (it is inside every task's derived record), copies the snapshot replacing only
 * the changed task's derived contract and two allocations, and must leave every other task -- running or not -- exactly
 * as it was. The driver then runs the new contract, and a claim that won first refuses the change.
 */
async function confirmed() {
  const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
  const service = new WebControlService(h.deps);
  const answer = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in answer) throw new Error(JSON.stringify(answer));
  return { h, service };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const without = (snapshot: any, taskId: string) => ({
  ...snapshot,
  derivedContracts: snapshot.derivedContracts.filter((entry: { taskId: string }) => entry.taskId !== taskId),
  allocations: snapshot.allocations.filter((row: { ownerKind: string; ownerId: string }) => !(row.ownerKind === "task" && row.ownerId === taskId)),
});
const CHANGED = { inputs: { goal: "write a, changed" } };

describe("a change after confirmation (criteria 9, 10)", () => {
  it("raises the budget from the reserve, keeps proposalVersion, and the changed task passes A2 with the new contract", async () => {
    const { h, service } = await confirmed();
    try {
      const before = { group: readWebGroup(h.store, "g"), version: readBudgetProposal(h.store, "g").proposalVersion, work: workAllocation(h, "a").amount };
      expect(service.setTaskLoop(change(h, "a", { ...CHANGED, tokens: before.work.tokens + 500_000 })))
        .toMatchObject({ result: { kind: "task-loop-set", taskId: "a", loopVersion: 1, proposalVersion: before.version } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g");
      expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(before.version);
      expect(after.used).toEqual(before.group.used);
      expect(after.reserved.tokens).toBe(before.group.reserved.tokens + 500_000);
      const raised = { ...before.work, tokens: before.work.tokens + 500_000 };
      expect(workAllocation(h, "a").amount).toEqual(raised);
      expect(workBody(h, "a").grant).toMatchObject({ work: raised });
      const a = readConfirmedTaskExecution(h.store, "g", "a");
      expect(a.contract.objective.goal).toBe("write a, changed");
      expect(a.contract.executionPolicy.tokenBudget).toBe(raised.tokens);
      const item = readControlGroup(h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!;
      expect(item.derivedContractHash).toBe(a.derivedContractHash);
      expect(item.loopPlan).toMatchObject({ amended: true, loopVersion: 1 });
    } finally { await h.dispose(); }
  });

  it("lowers the budget back into the reserve", async () => {
    const { h, service } = await confirmed();
    try {
      const before = { group: readWebGroup(h.store, "g"), work: workAllocation(h, "a").amount };
      expect(service.setTaskLoop(change(h, "a", { tokens: before.work.tokens - 1_000_000, attempts: before.work.attempts - 1 }))).toMatchObject({ result: { kind: "task-loop-set" } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g");
      expect(after.ledger.explicitUnallocatedReserve.tokens).toBe(before.group.ledger.explicitUnallocatedReserve.tokens + 1_000_000);
      expect(after.ledger.explicitUnallocatedReserve.attempts).toBe(before.group.ledger.explicitUnallocatedReserve.attempts + 1);
      expect(after.used).toEqual(before.group.used);
      expect(readConfirmedTaskExecution(h.store, "g", "a").contract.executionPolicy.maxAttempts).toBe(before.work.attempts - 1);
      expect(workAllocation(h, "a").amount.sessions).toBe(before.work.sessions);
    } finally { await h.dispose(); }
  });

  it("leaves every other part of the snapshot byte-identical (spec §5.2 step 7, R2)", async () => {
    const { h, service } = await confirmed();
    try {
      const before = snapshotOf(h), b = readConfirmedTaskExecution(h.store, "g", "b");
      expect(service.setTaskLoop(change(h, "a", { ...CHANGED, tokens: workAllocation(h, "a").amount.tokens + 500_000 }))).toMatchObject({ result: { kind: "task-loop-set" } });
      const after = snapshotOf(h);
      expect(canonicalBytes(without(after, "a")).equals(canonicalBytes(without(before, "a")))).toBe(true);
      expect(after.derivedContracts.find((entry: { taskId: string }) => entry.taskId === "a")).not.toEqual(before.derivedContracts.find((entry: { taskId: string }) => entry.taskId === "a"));
      expect(readConfirmedTaskExecution(h.store, "g", "b").derivedContractHash).toBe(b.derivedContractHash);
    } finally { await h.dispose(); }
  });
});

describe("a change after confirmation leaves a re-amounted task's snapshot entry alone (U8, spec §5.2 step 7, R2)", () => {
  // A task handed off recoverably is held with its allocation re-amounted to its unspent remainder (stopIntent.ts
  // terminaliseRun); resume-from-handoff with no selection clears the stop and leaves it held -- the one realistic
  // state in which set-task-loop is admitted and a full rebuild would re-derive another task's entry differently.
  it("the held task's derived contract entry and allocation rows stay byte-identical when another task's plan changes", async () => {
    const { h, service } = await confirmed();
    try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const claimed = await deliverScheduledStart(h.deps, "g");
      if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
      const runId = claimed.runId;
      const held = String(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).workItemId);
      const other = held === "a" ? "b" : "a";
      const used = { tokens: 10_000, activeMs: 60_000, attempts: 1, sessions: 1 };
      recordUsage(h.store, { runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: used, source: { artifactId: `usage-${runId}`, hash: sha256Canonical({ runId, used }) } });
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(runId)!.id);
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, { requestId, outcome: "settled-recoverable" });
      expect(await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [] }))).toMatchObject({ result: { kind: "resumed-from-handoff" } });
      const entryOf = (snapshot: ReturnType<typeof snapshotOf>, taskId: string) => ({
        derived: snapshot.derivedContracts.filter((entry: { taskId: string }) => entry.taskId === taskId),
        allocations: snapshot.allocations.filter((row: { ownerKind: string; ownerId: string }) => row.ownerKind === "task" && row.ownerId === taskId),
      });
      const before = entryOf(snapshotOf(h), held);
      // The premise: the live allocation was re-amounted away from the frozen one, so a rebuild from it would differ.
      expect(workAllocation(h, held)).toMatchObject({ state: "held" });
      expect(workAllocation(h, held).amount).not.toEqual(before.allocations.find((row: { bucket: string }) => row.bucket === "work").amount);
      // A plan-only change: the budget does not move, so the reserve row cannot be what a rebuild is seen through.
      expect(service.setTaskLoop(change(h, other, { inputs: { goal: `write ${other}, changed` } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: other } });
      const after = entryOf(snapshotOf(h), held);
      expect(after.derived).toHaveLength(1);
      expect(after.allocations).toHaveLength(2);
      expect(canonicalBytes(after).equals(canonicalBytes(before))).toBe(true);
    } finally { await h.dispose(); }
  });
});

describe("the change and the driver (criteria 11, 12)", () => {
  it("a command before the claim: the claim runs the new contract", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }]);
    try {
      expect(t.service.setTaskLoop(change(t.h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set" } });
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.fake.calls.accept.length > 0);
      const accepted = t.fake.calls.accept[0] as unknown as { work: { contract: { objective: { goal: string } } } };
      expect(accepted.work.contract.objective.goal).toBe("write a, changed");
      await t.until(driver, () => t.body(runId).state === "settled");
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("a claim before the command: the command is refused as task-already-started", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }]);
    try {
      await t.claim();
      expect(errorOf(t.service.setTaskLoop(change(t.h, "a", CHANGED)))).toMatchObject({ code: "task-already-started" });
    } finally { await t.h.dispose(); }
  });

  it("changing one task while another runs leaves the running one able to settle (criterion 11)", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const runA = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runA).state === "accepted");
      expect(t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" }, tokens: workAllocation(t.h, "b").amount.tokens + 500_000 })))
        .toMatchObject({ result: { kind: "task-loop-set", taskId: "b" } });
      await t.until(driver, () => t.body(runA).state === "settled");
      expect(t.body(runA).drive.blockedReason ?? null).toBeNull();
      expect(readConfirmedTaskExecution(t.h.store, "g", "b").contract.objective.goal).toBe("write b, changed");
    } finally { await t.h.dispose(); }
  }, 60_000);
});

describe("replaceTaskInSnapshot refuses a snapshot it cannot copy (Rule 9 P3: its two refusal branches)", () => {
  const thrown = (f: () => unknown): unknown => { try { f(); } catch (error) { return error; } return undefined; };
  it("a task the snapshot has no derived contract for, and a task it has no allocation rows for, are recovery-blocked", async () => {
    const { h } = await confirmed();
    try {
      const snapshot = executionSnapshotSchema.parse(snapshotOf(h));
      const rows = (taskId: string) => ({
        work: snapshot.allocations.find((row) => row.ownerKind === "task" && row.ownerId === taskId && row.bucket === "work")!,
        handoff: snapshot.allocations.find((row) => row.ownerKind === "task" && row.ownerId === taskId && row.bucket === "handoff")!,
      });
      // Otherwise a missing entry would be skipped and the copy would silently keep the old contract or allocations.
      expect(thrown(() => replaceTaskInSnapshot(snapshot, "missing", "0".repeat(64), rows("a")))).toMatchObject({ code: "recovery-blocked" });
      const noRows = { ...snapshot, allocations: snapshot.allocations.filter((row) => !(row.ownerKind === "task" && row.ownerId === "a")) };
      expect(thrown(() => replaceTaskInSnapshot(noRows, "a", "0".repeat(64), rows("a")))).toMatchObject({ code: "recovery-blocked" });
    } finally { await h.dispose(); }
  });
});
