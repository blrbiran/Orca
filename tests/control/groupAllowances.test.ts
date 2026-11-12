import { describe, expect, it } from "vitest";
import { applyApprovePendingDecision, applyRejectPendingDecision } from "../../src/control/decisionCommands.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { write } from "../../src/control/executionDriver.js";
import { flagDecision, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { applyDecisionAllowances } from "../../src/control/groupAllowances.js";
import { listPendingDecisions, readPendingDecision } from "../../src/control/pendingDecisions.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester follow-up G §6.3 (#189, 「本组里同类请示都自动放行」): "allow this kind in this group" settles the request, the
// open same-kind ones and later ones of this group; "allow this one" settles only that one; a revoke stops later ones.

const entry = (n: number, kind: string, scope: string) => ({
  question: `q${n}`, chose: `c${n}`, alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: "revert it", cost: "c", blast_radius: "r" }, scope, kind,
});
type Harness = Awaited<ReturnType<typeof driverHarness>>;

/** a reports three refused decisions (two interface/task, one interface/repo); b, after a, reports one interface/task. */
async function world() {
  const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }], {
    decisions: (id) => id === "a" ? [entry(0, "interface", "task"), entry(1, "interface", "task"), entry(2, "interface", "repo")] : [entry(3, "interface", "task")],
  });
  const aRun = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => ["landed", "settled"].includes(t.body(aRun).state));
  const p = (n: number) => `pending-${aRun}-${n}`;
  return { t, driver, aRun, p };
}
const state = (t: Harness, pendingId: string) => readPendingDecision(t.h.store, pendingId)!.state;
const allow = (t: Harness, request: Parameters<Harness["service"]["allowRequest"]>[0]["payload"]["request"], scope: "one" | "group") =>
  t.service.allowRequest(t.h.command("allow-request", { request, scope }));
const groupBody = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

async function landB(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
  let bRun: string | null = null;
  for (let i = 0; i < 80; i += 1) {
    await deliverSchedulerWakes(t.h.store, { start });
    await driver.round();
    const row = t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id='b'").get();
    bRun = row === undefined ? null : String(row.id);
    if (bRun !== null && ["landed", "settled"].includes(t.body(bRun).state)) return bRun;
  }
  throw new Error("b never landed");
}

describe("#189: allowances for decision requests", { timeout: 120_000 }, () => {
  it("allow this kind settles the request, the open same-kind ones, and later ones", async () => {
    const { t, driver, p } = await world(); try {
      const answer = await allow(t, { kind: "pending-decision", pendingId: p(0) }, "group");
      expect("error" in answer ? answer.error : answer.result).toMatchObject({ kind: "request-allowed", allowanceId: "allow-1" });
      expect([state(t, p(0)), state(t, p(1)), state(t, p(2))]).toEqual(["allowed", "allowed", "pending"]);
      expect(readPendingDecision(t.h.store, p(1))!.allowed).toMatchObject({ allowanceId: "allow-1", by: "allowance:allow-1" });
      const bRun = await landB(t, driver);
      const later = readPendingDecision(t.h.store, `pending-${bRun}-0`)!;
      expect(later.state).toBe("allowed");
      expect(later.allowed?.allowanceId).toBe("allow-1");
      // The group view lists the allowance with who, how, when and from which request.
      const listed = readControlGroup(t.h.store, "epoch", "g").summary.allowances!;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ allowanceId: "allow-1", from: { pendingId: p(0) }, request: { type: "pending-decision", kind: "interface", scope: "task" } });
      expect(typeof listed[0]!.by).toBe("string");
      expect(typeof listed[0]!.at).toBe("number");
    } finally { await t.h.dispose(); }
  });

  it("allow this one settles only that request", async () => {
    const { t, p } = await world(); try {
      const answer = await allow(t, { kind: "pending-decision", pendingId: p(0) }, "one");
      expect("error" in answer ? answer.error : answer.result).toMatchObject({ kind: "request-allowed", allowanceId: null, settled: [p(0)] });
      expect([state(t, p(0)), state(t, p(1))]).toEqual(["allowed", "pending"]);
      expect(groupBody(t).allowances).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("a revoked allowance settles no later request, and what it let through stays", async () => {
    const { t, driver, p } = await world(); try {
      await allow(t, { kind: "pending-decision", pendingId: p(0) }, "group");
      const revoked = await t.service.revokeAllowance(t.h.command("revoke-allowance", { allowanceId: "allow-1" }));
      expect("error" in revoked ? revoked.error : revoked.result).toEqual({ kind: "allowance-revoked", allowanceId: "allow-1" });
      const bRun = await landB(t, driver);
      expect(state(t, `pending-${bRun}-0`)).toBe("pending");
      expect([state(t, p(0)), state(t, p(1))]).toEqual(["allowed", "allowed"]);
      expect(readControlGroup(t.h.store, "epoch", "g").summary.allowances![0]!.revoked).toBeDefined();
      const again = await t.service.revokeAllowance(t.h.command("revoke-allowance", { allowanceId: "allow-1" }));
      expect("error" in again && again.error.code).toBe("no-op-command");
      const unknown = await t.service.revokeAllowance(t.h.command("revoke-allowance", { allowanceId: "allow-9" }));
      expect("error" in unknown && unknown.error.code).toBe("allowance-not-found");
    } finally { await t.h.dispose(); }
  });

  it("an allowed pending decision cannot be approved or rejected again", async () => {
    const { t, p } = await world(); try {
      const before = readControlGroup(t.h.store, "epoch", "g").summary;
      await allow(t, { kind: "pending-decision", pendingId: p(0) }, "group");
      const approved = applyApprovePendingDecision({ store: t.h.store }, t.h.command("approve-pending-decision", { pendingId: p(0), undoHow: "git revert HEAD" }), { kind: "committed", id: "x", commit: "c".repeat(40) });
      expect("error" in approved && approved.error.code).toBe("pending-decision-settled");
      const rejected = applyRejectPendingDecision({ store: t.h.store }, t.h.command("reject-pending-decision", { pendingId: p(1) }), { kind: "recorded", correctionId: "corr-1" });
      expect("error" in rejected && rejected.error.code).toBe("pending-decision-settled");
      expect(listPendingDecisions(t.h.store, "g").filter((row) => row.state === "pending")).toHaveLength(1);
      const after = readControlGroup(t.h.store, "epoch", "g").summary;
      expect(after.card!.pendingDecisions).toBe(before.card!.pendingDecisions - 2);
    } finally { await t.h.dispose(); }
  });

  it("a flag of the same kind is ratified by the allowance, now and when raised later", async () => {
    const { t } = await world(); try {
      const flag = (decisionId: string) => write(t.deps, () => flagDecision(t.h.store, { decisionId, groupId: "g", runId: null, source: "test-change", reason: "r", evidence: [], by: "orca-auto", at: "2026-11-12T00:00:00Z", kind: "criteria", scope: "task" }));
      flag("run-x/orca-criteria");
      const answer = await allow(t, { kind: "flagged-decision", decisionId: "run-x/orca-criteria" }, "group");
      expect("error" in answer ? answer.error : answer.result).toMatchObject({ kind: "request-allowed", allowanceId: "allow-1" });
      expect(readFlaggedDecision(t.h.store, "run-x/orca-criteria")!.state).toBe("ratified");
      flag("run-y/orca-criteria");
      write(t.deps, () => applyDecisionAllowances(t.h.store, "g"));
      expect(readFlaggedDecision(t.h.store, "run-y/orca-criteria")).toMatchObject({ state: "ratified", ratifiedBy: "allowance:allow-1" });
      // Another source's flag of the same kind and scope is another kind of request.
      write(t.deps, () => flagDecision(t.h.store, { decisionId: "run-z/x", groupId: "g", runId: null, source: "reconcile", reason: "r", evidence: [], by: "orca-auto", at: "2026-11-12T00:00:00Z", kind: "criteria", scope: "task" }));
      write(t.deps, () => applyDecisionAllowances(t.h.store, "g"));
      expect(readFlaggedDecision(t.h.store, "run-z/x")!.state).toBe("flagged");
    } finally { await t.h.dispose(); }
  });

  it("another group's request is untouched", async () => {
    const { t, p } = await world(); try {
      await allow(t, { kind: "pending-decision", pendingId: p(0) }, "group");
      // The same kind of request, recorded for another group, stays pending: nothing reads g's list for it.
      write(t.deps, () => {
        t.h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) SELECT 'h', revision, graph_version, body FROM groups WHERE id='g'").run();
        t.h.store.db.prepare("INSERT INTO pending_decisions(id,group_id,run_id,ledger_run,entry_index,state,body) SELECT 'pending-h-0','h',run_id,ledger_run || '-h',entry_index,'pending',body FROM pending_decisions WHERE id=?").run(p(2));
        const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM pending_decisions WHERE id='pending-h-0'").get()!.body));
        t.h.store.db.prepare("UPDATE pending_decisions SET body=? WHERE id='pending-h-0'").run(JSON.stringify({ ...body, entry: entry(9, "interface", "task") }));
        const hBody = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='h'").get()!.body));
        delete hBody.allowances;
        t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='h'").run(JSON.stringify(hBody));
      });
      write(t.deps, () => { applyDecisionAllowances(t.h.store, "g"); applyDecisionAllowances(t.h.store, "h"); });
      expect(state(t, "pending-h-0")).toBe("pending");
      expect(groupBody(t).allowances).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("refuses a request that is not this group's or not open", async () => {
    const { t, p } = await world(); try {
      const missing = await allow(t, { kind: "pending-decision", pendingId: "pending-nope" }, "group");
      expect("error" in missing && missing.error.code).toBe("pending-decision-not-found");
      await allow(t, { kind: "pending-decision", pendingId: p(2) }, "one");
      const twice = await allow(t, { kind: "pending-decision", pendingId: p(2) }, "one");
      expect("error" in twice && twice.error.code).toBe("no-op-command");
      const notBlocked = await allow(t, { kind: "path", runId: t.h.store.db.prepare("SELECT id FROM runs LIMIT 1").get()!.id as string }, "group");
      expect("error" in notBlocked && notBlocked.error).toMatchObject({ code: "allowance-request-invalid" });
    } finally { await t.h.dispose(); }
  });
});
