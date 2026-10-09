import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { openControlStore } from "../../src/control/store.js";
import { hasValidUsageSettlement } from "../../src/control/usageSettlement.js";
import { hasObservedUsage } from "../../src/control/budget.js";
import { applySettleUnknownUsage } from "../../src/control/settleUnknownUsage.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { writeHandoffRequest } from "../../src/control/stopIntent.js";
import { describe, expect, it } from "vitest";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { readRunActivity } from "../../src/control/activity.js";
import { latestRequestForRun, groupStopState } from "../../src/control/stopIntent.js";
import { recordUsage } from "../../src/control/usage.js";

import { unknownFailure, settle, handoff, ds, sum } from "./fixtures/unknownFailure.js";

describe("D9 owner conservative settlement", () => {
  it("charges both buckets once and preserves frozen allocations", async () => {
    const { t, runId } = await unknownFailure(); try {
      const before = t.body(runId), ledger = readWebGroup(t.h.store, "g").ledger;
      const allocations = readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task");
      const command = t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
      const result = await settle(t, runId, command);
      expect(result).not.toHaveProperty("error");
      expect(result.result).toMatchObject({ kind: "usage-settled", charged: before.remaining, method: "remaining-grant" });
      const after = t.body(runId), booked = readWebGroup(t.h.store, "g").ledger;
      for (const d of ds) {
        expect(booked.used[d]).toBe(ledger.used[d] + sum(before.remaining)[d]);
        expect(booked.committedRemaining[d]).toBe(ledger.committedRemaining[d] - sum(before.remaining)[d]);
        for (const b of ["work", "handoff"]) { expect(after.remaining[b][d]).toBe(0); expect(after.cumulative[b][d]).toBe(before.cumulative[b][d] + before.remaining[b][d]); }
      }
      expect(after).toMatchObject({ state: "blocked", highWater: before.highWater, unknown: { work: false, handoff: false }, usageSettlement: { reservationDisposition: "committed", principal: "user:owner" } });
      expect(readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task")).toEqual(allocations);
      expect(t.h.store.db.prepare("SELECT source,quality,model,tokens FROM usage_ledger WHERE run_id=? ORDER BY id").all(runId)).toEqual([
        { source: "run-work", quality: "unattributed", model: null, tokens: 10 },
        { source: "run-work", quality: "unattributed", model: null, tokens: before.remaining.work.tokens },
        { source: "run-handoff", quality: "unattributed", model: null, tokens: before.remaining.handoff.tokens },
      ]);
      expect(readRunActivity(t.h.store, runId, 50).filter(a => a.kind === "usage-settled")).toHaveLength(1);
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs[0]!.unknownUsageSettlement).toMatchObject({ allowed: false, refusalReason: "run-usage-settled", settlement: after.usageSettlement });
      expect(await settle(t, runId, command)).toEqual(result);
      expect((await settle(t, runId)).error.code).toBe("run-usage-settled");
      const prior = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq=3").get(runId)!.body));
      expect(recordUsage(t.h.store, prior)).toEqual({ applied: false, highWater: 3 });
      expect(() => recordUsage(t.h.store, { ...prior, eventSeq: 4 })).toThrow("run-usage-settled");
    } finally { await t.h.dispose(); }
  });

  it("charges a released failed handoff without consuming another task commitment", async () => {
    const { t, runId, driver } = await unknownFailure([{ taskId: "a" }, { taskId: "b" }]); try {
      await handoff(t, runId, driver);
      const run = t.body(runId), ledger = readWebGroup(t.h.store, "g").ledger;
      const settledRows = readRunActivity(t.h.store, runId, 50).filter(a => a.kind === "run-settled").length;
      expect(run.state).toBe("settled-unrecoverable");
      expect(latestRequestForRun(t.h.store, "g", runId)?.failureCode).toBe("usage-unsettled");
      const allocations = readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task");
      const result = await settle(t, runId);
      expect(result).not.toHaveProperty("error");
      const after = readWebGroup(t.h.store, "g").ledger;
      expect(after.committedRemaining).toEqual(ledger.committedRemaining);
      for (const d of ds) expect(after.used[d]).toBe(ledger.used[d] + sum(run.remaining)[d]);
      expect(readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task")).toEqual(allocations);
      expect(readRunActivity(t.h.store, runId, 50).filter(a => a.kind === "run-settled")).toHaveLength(settledRows);
      expect(t.body(runId)).toMatchObject({ state: "settled-failed", endedAt: run.endedAt, recoverable: false, usageSettlement: { reservationDisposition: "released" } });
      expect(latestRequestForRun(t.h.store, "g", runId)).toMatchObject({ state: "settled-failed", failureCode: "usage-unsettled" });
    } finally { await t.h.dispose(); }
  });

  it("completes only the usage-only stopped failure", async () => {
    const { t, runId, driver } = await unknownFailure(); try {
      await handoff(t, runId, driver);
      expect(groupStopState(t.h.store, "g")).toBe("handoff-partial");
      expect(await settle(t, runId)).not.toHaveProperty("error");
      expect(groupStopState(t.h.store, "g")).toBe("handoff-complete");
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).not.toHaveProperty("error");
      expect(groupStopState(t.h.store, "g")).toBe("none");
    } finally { await t.h.dispose(); }
  });

  it("settlement before handoff counts as complete usage", async () => {
    const { t, runId, driver } = await unknownFailure(undefined, false); try {
      expect(await settle(t, runId)).not.toHaveProperty("error");
      const booked = readWebGroup(t.h.store, "g").ledger.used;
      await handoff(t, runId, driver);
      expect(latestRequestForRun(t.h.store, "g", runId)?.state).toBe("settled-recoverable");
      expect(groupStopState(t.h.store, "g")).toBe("handoff-complete");
      expect(readWebGroup(t.h.store, "g").ledger.used).toEqual(booked);
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).not.toHaveProperty("error");
    } finally { await t.h.dispose(); }
  });
});

const business = (t: any) => ["runs", "work_items", "budget_proposals", "usage_ledger", "activity", "handoff_requests", "stop_intents"].map(table => t.h.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
const poke = (t: any, runId: string, fn: (run: any) => void) => t.h.store.transaction(() => { const run = t.body(runId); fn(run); t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId); });

describe("D9 proof, pending, rollback and replay boundaries", () => {
  it.each(["report", "isolation", "identity", "generation", "noncurrent", "pending", "open-request", "not-failed", "known"])("refuses %s without accounting or activity writes", async mode => {
    const { t, runId } = await unknownFailure(); try {
      if (mode === "report") t.h.store.db.prepare("DELETE FROM outbox WHERE id=?").run(`report:${runId}`);
      if (mode === "isolation") {
        const run = t.body(runId), row = t.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`report:${runId}`)!;
        const report = JSON.parse(readFileSync(join(t.h.store.stateDir, "artifacts", JSON.parse(String(row.body)).source.artifactId, "data"), "utf8"));
        const { writeArtifact } = await import("../../src/control/archive.js");
        report.candidate.stopProof.source = await writeArtifact(t.h.store, "unisolated-proof", Buffer.from(JSON.stringify({ isolated: false, executionId: run.executionId, generation: 1 })));
        const source = await writeArtifact(t.h.store, "unisolated-report", Buffer.from(JSON.stringify(report)));
        t.h.store.db.prepare("UPDATE outbox SET body=? WHERE id=?").run(JSON.stringify({ source }), `report:${runId}`);
      }
      if (mode === "identity") poke(t, runId, r => { r.executionId = "different-execution"; });
      if (mode === "generation") poke(t, runId, r => { r.generation = 2; });
      if (mode === "noncurrent") t.h.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.currentRunId','other') WHERE group_id='g' AND id='a'").run();
      if (mode === "pending") t.h.store.db.prepare("INSERT INTO usage_events VALUES (?,?,?,?)").run(runId, t.body(runId).highWater + 2, "0".repeat(64), "{}");
      if (mode === "open-request") t.h.store.transaction(() => writeHandoffRequest(t.h.store, { requestId: "open", runId, state: "collecting", deadlineAt: "2099-01-01T00:00:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }, "g"));
      if (mode === "not-failed") poke(t, runId, r => { r.drive.outcome = "succeeded"; });
      if (mode === "known") poke(t, runId, r => { r.unknown = { work: false, handoff: false }; });
      const before = business(t), ledger = readWebGroup(t.h.store, "g").ledger;
      const result = await settle(t, runId);
      expect(result).toHaveProperty("error.code", ["report", "isolation", "identity"].includes(mode) ? "run-stop-proof-required" : mode === "pending" ? "run-usage-pending" : mode === "known" ? "run-usage-not-unknown" : "run-usage-not-settleable");
      // Refusal has a command activity row, but no usage-settled or run transition business writes.
      expect(business(t).filter((_, i) => i !== 4)).toEqual(before.filter((_, i) => i !== 4));
      expect(readWebGroup(t.h.store, "g").ledger).toEqual(ledger);
      expect(readRunActivity(t.h.store, runId, 50).filter(a => a.kind === "usage-settled")).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });

  it.each(["snapshot", "artifact", "missing", "unresolved"])("released accounting refuses a %s defect even with the usage-unsettled label", async mode => {
    const { t, runId, driver } = await unknownFailure(); try {
      await handoff(t, runId, driver);
      const run = t.body(runId), row = t.h.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(run.checkpointId)!;
      const c = JSON.parse(String(row.body));
      if (mode === "snapshot") unlinkSync(join(t.h.store.stateDir, "artifacts", c.snapshot.artifactId, "data"));
      if (mode === "artifact") unlinkSync(join(t.h.store.stateDir, "artifacts", c.handoff.artifactId, "data"));
      if (mode === "missing" || mode === "unresolved") {
        c[mode === "missing" ? "missing" : "unresolvedRequestIds"] = ["still-missing"];
        const { createHash } = await import("node:crypto");
        const bytes = Buffer.from(JSON.stringify(c)), hash = createHash("sha256").update(bytes).digest("hex");
        writeFileSync(join(t.h.store.stateDir, "checkpoints", runId, run.checkpointId + ".json"), bytes);
        t.h.store.db.prepare("UPDATE checkpoints SET hash=?,body=? WHERE id=?").run(hash, bytes.toString(), run.checkpointId);
      }
      const ledger = readWebGroup(t.h.store, "g").ledger;
      expect(await settle(t, runId)).toHaveProperty("error.code", "run-stop-proof-required");
      expect(readWebGroup(t.h.store, "g").ledger).toEqual(ledger);
      expect(latestRequestForRun(t.h.store, "g", runId)?.state).toBe("settled-unrecoverable");
    } finally { await t.h.dispose(); }
  });

  it("rolls back every accounting surface and retries after failure", async () => {
    const { t, runId } = await unknownFailure(); try {
      const before = business(t), group = readWebGroup(t.h.store, "g"), c = t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
      await expect(withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => applySettleUnknownUsage({ store: t.h.store, beforeCommit: () => { throw new Error("injected-rollback"); } }, c as never))).rejects.toThrow("injected-rollback");
      expect(business(t)).toEqual(before); expect(readWebGroup(t.h.store, "g")).toEqual(group);
      expect(t.h.store.db.prepare("SELECT id FROM commands WHERE id=?").get(c.commandId)).toBeUndefined();
      expect(await settle(t, runId, c)).not.toHaveProperty("error");
      const result = await settle(t, runId, c), dir = t.h.store.stateDir;
      t.h.store.close(); t.h.store = await openControlStore({ stateDir: dir });
      const { WebControlService } = await import("../../src/control/webService.js");
      t.service = new WebControlService({ ...t.h.deps, store: t.h.store });
      const settled = business(t);
      expect(await settle(t, runId, c)).toEqual(result); expect(business(t)).toEqual(settled);
      t.h.store.close();
    } finally { await t.h.dispose(); }
  });

  it.each(["highWater", "remaining"])("rechecks changed %s after evidence and rejects it transactionally", async mode => {
    const { t, runId } = await unknownFailure(); try {
      const c = t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
      const result = await withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => applySettleUnknownUsage({ store: t.h.store, afterEvidence: async () => { poke(t, runId, r => { if (mode === "highWater") r.highWater += 1; else { r.remaining.work.tokens -= 1; r.cumulative.work.tokens += 1; } }); } }, c as never));
      expect(result).toHaveProperty("error.code", "run-usage-not-settleable");
      expect(t.body(runId).usageSettlement).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it.each(["charged", "receipt", "principal", "unknown", "remaining", "highWater"])("strictly rejects fake %s marker and manually filled request state", async mode => {
    const { t, runId, driver } = await unknownFailure(undefined, false); try {
      await handoff(t, runId, driver); expect(await settle(t, runId)).not.toHaveProperty("error");
      const run = t.body(runId); expect(hasValidUsageSettlement(t.h.store, run)).toBe(true);
      expect(hasObservedUsage(t.h.store, run)).toBe(true);
      poke(t, runId, r => {
        if (mode === "charged") r.usageSettlement.charged.work.tokens += 1;
        if (mode === "receipt") r.usageSettlement.commandId = "fake-receipt";
        if (mode === "principal") r.usageSettlement.principal = "user:someone-else";
        if (mode === "unknown") r.unknown.work = true;
        if (mode === "remaining") r.remaining.work.tokens = 1;
        if (mode === "highWater") r.usageSettlement.highWater += 1;
      });
      expect(hasValidUsageSettlement(t.h.store, t.body(runId))).toBe(false);
      expect(hasObservedUsage(t.h.store, t.body(runId))).toBe(false);
      expect(() => groupStopState(t.h.store, "g")).toThrow("handoff-manual-settlement-invalid");
      expect(() => readControlGroup(t.h.store, "epoch-test", "g")).toThrow("recovery-blocked");
    } finally { await t.h.dispose(); }
  });

  it("books released overspend honestly without taking another commitment", async () => {
    const { t, runId, driver } = await unknownFailure([{ taskId: "a" }, { taskId: "b" }], true, { workTokens: 1_000_000_000_000 }); try {
      await handoff(t, runId, driver);
      const before = readWebGroup(t.h.store, "g").ledger, charged = sum(t.body(runId).remaining);
      expect(await settle(t, runId)).not.toHaveProperty("error");
      const after = readWebGroup(t.h.store, "g").ledger;
      expect(after.committedRemaining).toEqual(before.committedRemaining); expect(after.budgetDeficit.tokens).toBe(before.budgetDeficit.tokens + charged.tokens); expect(after.explicitUnallocatedReserve.tokens).toBe(0);
    } finally { await t.h.dispose(); }
  });
});


describe("D9 does not erase other frozen runs", () => {
  it.each([false, true])("keeps another run's unknown/open request blocker (silent=%s)", async silentOther => {
    const { t, runId, driver, otherRunId } = await unknownFailure([{ taskId: "a" }, { taskId: "b" }], true, { claimOther: true, silentOther }); try {
      await handoff(t, runId, driver);
      const other = latestRequestForRun(t.h.store, "g", otherRunId!)!;
      expect(await settle(t, runId)).not.toHaveProperty("error");
      expect(latestRequestForRun(t.h.store, "g", otherRunId!)).toEqual(other);
      expect(groupStopState(t.h.store, "g")).toBe(silentOther ? "handoff-pending" : "handoff-partial");
      if (!silentOther) expect(readWebGroup(t.h.store, "g").ledger.usageUnknown).toBe(true);
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).toHaveProperty("error");
    } finally { await t.h.dispose(); }
  });
});


describe("D9 accounting time and spend caps", () => {
  it.each(["total", "week", "month"] as const)("books in current %s and gates the next retry claim", async period => {
    const { t, runId } = await unknownFailure(undefined, false, { extraReserve: true }); try {
      const { applySpendCommand } = await import("../../src/control/spendCommands.js");
      const { readUsageView } = await import("../../src/control/usageQuery.js");
      const { deliverScheduledStart } = await import("../../src/control/webDispatch.js");
      const at = Date.parse("2026-10-01T00:00:00.000Z"), next = Date.parse("2026-11-02T00:00:00.000Z");
      t.h.store.db.prepare("UPDATE usage_calendar SET time_zone='UTC',week_start=1").run();
      const cap = { schema: "orca-raw-command-v1", commandId: `cap-${period}`, actorId: "operator", verb: "set-spend-cap", target: { kind: "spend" }, expectedRevision: 0, payload: { scope: "all", period, tokens: 1 } } as const;
      expect(withCommandContext(cap.commandId, { client: "web", principal: "user:owner" }, () => applySpendCommand({ store: t.h.store, now: () => new Date(at), knownRepository: () => true }, cap))).not.toHaveProperty("error");
      const c = t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
      const result = await withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => applySettleUnknownUsage({ store: t.h.store, now: () => new Date(at) }, c as never));
      expect(result).not.toHaveProperty("error");
      const tokens = sum(t.body(runId).grant).tokens;
      const view = readUsageView(t.h.store, { scope: "all", from: at, to: at + 1, groupBy: "model" }, at);
      expect(view.headline).toEqual({ total: tokens, week: tokens, month: tokens });
      expect(view.range.byModel).toEqual([{ model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens }]);
      expect(readUsageView(t.h.store, { scope: "all", from: null, to: null, groupBy: "model" }, next).headline).toEqual({ total: tokens, week: 0, month: 0 });
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      const wake = await t.service.start(t.h.command("start", {}));
      expect(wake).not.toHaveProperty("error");
      const claimed = await deliverScheduledStart({ ...t.dispatch, now: () => new Date(at) }, "g");
      expect(claimed).toMatchObject({ kind: "blocked", reason: "spend-cap-reached" });
      expect(t.h.store.db.prepare("SELECT COUNT(*) n FROM runs WHERE group_id='g'").get()!.n).toBe(1);
    } finally { await t.h.dispose(); }
  });
});


describe("D9 preserves independent stopping conditions", () => {
  it("does not manufacture a recoverable checkpoint for an incomplete failed report", async () => {
    const { t, runId, driver } = await unknownFailure(undefined, false, { missing: true }); try {
      expect(await settle(t, runId)).not.toHaveProperty("error");
      await handoff(t, runId, driver);
      expect(groupStopState(t.h.store, "g")).toBe("handoff-partial");
      expect(latestRequestForRun(t.h.store, "g", runId)).toMatchObject({ state: "settled-unrecoverable", failureCode: "missing:lost-evidence" });
    } finally { await t.h.dispose(); }
  });
  it("writes a settlement marker and activity with no zero-token ledger rows", async () => {
    const { t, runId } = await unknownFailure(undefined, true, { spentAllTokens: true }); try {
      const before = t.h.store.db.prepare("SELECT * FROM usage_ledger ORDER BY id").all();
      expect(await settle(t, runId)).not.toHaveProperty("error");
      expect(t.body(runId).usageSettlement.charged).toMatchObject({ work: { tokens: 0 }, handoff: { tokens: 0 } });
      expect(t.h.store.db.prepare("SELECT * FROM usage_ledger ORDER BY id").all()).toEqual(before);
      expect(readRunActivity(t.h.store, runId, 50).filter(a => a.kind === "usage-settled")).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });
  it("rejects a pause and an unauthenticated direct call", async () => {
    const { t, runId } = await unknownFailure(); try {
      const c = t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
      await expect(applySettleUnknownUsage({ store: t.h.store }, c as never)).rejects.toThrow("control-verb-human-only");
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).not.toHaveProperty("error");
      expect(await settle(t, runId)).toHaveProperty("error.code", "stop-mode-conflict");
    } finally { await t.h.dispose(); }
  });
});


describe("manual request provenance", () => {
  it("rejects a settled-failed request backed only by a committed settlement marker", async () => {
    const { t, runId, driver } = await unknownFailure(undefined, false); try {
      expect(await settle(t, runId)).not.toHaveProperty("error"); await handoff(t, runId, driver);
      const request = latestRequestForRun(t.h.store, "g", runId)!;
      const { saveHandoffRequest } = await import("../../src/control/stopIntent.js");
      t.h.store.transaction(() => saveHandoffRequest(t.h.store, "g", { ...request, state: "settled-failed", failureCode: "usage-unsettled" }));
      expect(hasValidUsageSettlement(t.h.store, t.body(runId))).toBe(true);
      expect(() => groupStopState(t.h.store, "g")).toThrow("handoff-manual-settlement-invalid");
      expect(() => readControlGroup(t.h.store, "epoch-test", "g")).toThrow("handoff-manual-settlement-invalid");
    } finally { await t.h.dispose(); }
  });
});
