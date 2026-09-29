import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readArchivedContract, readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { change, errorOf, expectConserved, inputs, loop, workAllocation, workBody, writeGroup, writeWork, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §5.2 (criteria 8, 9; §9's revision assumption): set-task-loop refuses, by name and before writing
 * anything, every state in which a change could not be honoured; on a draft group it moves the task's budget to or
 * from the reserve with the ledger conserved and advances the proposal version so a stale confirmation is refused.
 */
const draft = () => webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }, { taskId: "c" }]);
const CHANGED = { inputs: { goal: "write a, changed" } };
/** Nothing of a refused command stays: the work item has no amendment and the proposal has not moved. */
const expectUntouched = (h: Fixture, proposalVersion: number) => {
  expect(workBody(h, "a").amendmentHash).toBeUndefined();
  expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(proposalVersion);
};

describe("set-task-loop refusals (criterion 8)", () => {
  it.each(["running", "review", "done", "blocked"])("refuses a group whose status is %s as group-state-invalid", async (status) => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.status = status; });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "group-state-invalid" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a stopped group as group-state-invalid", async () => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.stopped = true; });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "group-state-invalid" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a ledger with unknown usage as recovery-blocked", async () => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.ledger.usageUnknown = true; });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "recovery-blocked" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  // Ruling P3: spec §5.2 step 1 checks the ledger before the group's state, so unknown usage is named even on a group
  // that would also be refused for its state (the step-8 check alone would answer group-state-invalid here).
  it("checks the ledger first: unknown usage on a stopped group is recovery-blocked", async () => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.ledger.usageUnknown = true; body.stopped = true; });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "recovery-blocked" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses while an estimate is running (estimate-in-flight)", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(errorOf(service.setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "estimate-in-flight" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a stale loopVersion, a hand-written task, an unknown plan, a bad path shape and an unknown task by name", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      expect(errorOf(service.setTaskLoop(change(h, "a", { ...CHANGED, base: 1 })))).toMatchObject({ code: "task-loop-version-conflict" });
      expect(errorOf(service.setTaskLoop(change(h, "c", CHANGED)))).toMatchObject({ code: "task-has-no-loop-plan" });
      expect(errorOf(service.setTaskLoop(change(h, "a", { plan: "yolo" })))).toMatchObject({ code: "loop-plan-invalid", message: "loop-plan-invalid:unknown-plan" });
      expect(errorOf(service.setTaskLoop(change(h, "a", { inputs: { targetPaths: ["src/*.ts"] } })))).toMatchObject({ code: "loop-plan-invalid", message: "loop-plan-invalid:path-shape" });
      expect(errorOf(service.setTaskLoop(h.taskCommand("set-task-loop", "zzz", { baseLoopVersion: 0, plan: "standard", inputs: inputs("zzz"), work: { tokens: 1, activeMs: 1, attempts: 1 } }))))
        .toMatchObject({ code: "work-not-found" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  // Ruling P3: the loopVersion counter's overflow guard is a branch of its own; the next version would not be a safe integer.
  it("refuses a loopVersion that cannot advance as numeric-overflow", async () => {
    const h = await draft();
    try {
      writeWork(h, "a", { loopVersion: Number.MAX_SAFE_INTEGER });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", { ...CHANGED, base: Number.MAX_SAFE_INTEGER })))).toMatchObject({ code: "numeric-overflow" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses the same contract and the same budget as no-op-command", async () => {
    const h = await draft();
    try {
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a")))).toMatchObject({ code: "no-op-command" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a raise the reserve cannot cover, naming the dimension and the shortfall", async () => {
    const h = await draft();
    try {
      const reserve = readWebGroup(h.store, "g").ledger.explicitUnallocatedReserve.tokens;
      const tokens = workAllocation(h, "a").amount.tokens + reserve + 1;
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", { tokens }))))
        .toMatchObject({ code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:1" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a stale command revision like every other command (spec §9)", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      const stale = change(h, "a", CHANGED);
      expect(service.setTaskLoop(change(h, "b", { inputs: { goal: "write b, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "b" } });
      expect(errorOf(service.setTaskLoop(stale))).toMatchObject({ code: "revision-conflict" });
    } finally { await h.dispose(); }
  });

  it("refuses a task that is running, and one that has any run at all, as task-already-started", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      await t.claim(); // nextClaimableTask takes the first ready task by id: a
      expect(errorOf(t.service.setTaskLoop(change(t.h, "a", CHANGED)))).toMatchObject({ code: "task-already-started" });
      // Spec §5.2 step 2: a finished run returns its task to ready. A ready task with an inactive run row is that state.
      t.h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-finished','g','b',1,0,?)")
        .run(JSON.stringify({ unknown: { work: false, handoff: false } }));
      expect(errorOf(t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
    } finally { await t.h.dispose(); }
  });
});

describe("a change before confirmation (criterion 9; spec §5.2 steps 5-7)", () => {
  it("raises the budget out of the reserve, changes the contract, and advances the proposal version so a stale confirm is refused", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      const before = { group: readWebGroup(h.store, "g"), work: workAllocation(h, "a") };
      const stalePayload = await h.confirmPayload();
      expect(service.setTaskLoop(change(h, "a", { ...CHANGED, tokens: before.work.amount.tokens + 500_000 })))
        .toMatchObject({ verb: "set-task-loop", result: { kind: "task-loop-set", taskId: "a", loopVersion: 1, proposalVersion: 2 } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g"), work = workAllocation(h, "a");
      expect(after.used).toEqual(before.group.used);
      expect(after.ledger.explicitUnallocatedReserve.tokens).toBe(before.group.ledger.explicitUnallocatedReserve.tokens - 500_000);
      expect(work.amount).toEqual({ ...before.work.amount, tokens: before.work.amount.tokens + 500_000 });
      expect(work.fieldProvenance.tokens).toEqual({ provenance: "human", estimateId: null });
      expect(work.fieldProvenance.sessions).toEqual(before.work.fieldProvenance.sessions);
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ amended: true, loopVersion: 1, inputs: { goal: "write a, changed" } });
      expect(errorOf(await service.confirm(h.command("confirm", stalePayload)))).toMatchObject({ code: "proposal-version-conflict" });
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      const confirmed = readConfirmedTaskExecution(h.store, "g", "a");
      expect(confirmed.contract.objective.goal).toBe("write a, changed");
      expect(confirmed.contract.executionPolicy.tokenBudget).toBe(before.work.amount.tokens + 500_000);
    } finally { await h.dispose(); }
  });

  // Ruling P3: the amended contract is stored under its own hash, as import stores every original contract, so the
  // single-task reader (queries.ts readArchivedContract) answers the amended contract and not a missing record.
  it("stores the amended contract where the single-task reader finds it", async () => {
    const h = await draft();
    try {
      expect(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set" } });
      expect(readArchivedContract(h.store, "g", "a").contract.objective.goal).toBe("write a, changed");
    } finally { await h.dispose(); }
  });

  it("lowers the budget back into the reserve, sessions untouched", async () => {
    const h = await draft();
    try {
      const before = { group: readWebGroup(h.store, "g"), work: workAllocation(h, "a").amount };
      expect(new WebControlService(h.deps).setTaskLoop(change(h, "a", { tokens: before.work.tokens - 1_000_000, attempts: before.work.attempts - 1 })))
        .toMatchObject({ result: { kind: "task-loop-set" } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g");
      expect(after.ledger.explicitUnallocatedReserve.tokens).toBe(before.group.ledger.explicitUnallocatedReserve.tokens + 1_000_000);
      expect(after.ledger.explicitUnallocatedReserve.attempts).toBe(before.group.ledger.explicitUnallocatedReserve.attempts + 1);
      expect(after.used).toEqual(before.group.used);
      expect(workAllocation(h, "a").amount.sessions).toBe(before.work.sessions);
    } finally { await h.dispose(); }
  });
});

describe("the self-check (spec §5.2 step 8)", () => {
  it("rolls a confirmed change back when the changed task would not pass A2", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      // A work item whose frozen selection no longer matches the snapshot: nothing in the command reads it; A2 does.
      writeWork(h, "a", { configHash: "f".repeat(64) });
      const rows = () => [h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body, h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body];
      const before = rows();
      expect(errorOf(service.setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "recovery-blocked" });
      expect(workBody(h, "a").amendmentHash).toBeUndefined();
      expect(rows()).toEqual(before);
    } finally { await h.dispose(); }
  });
});
