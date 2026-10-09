import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { profileSnapshot } from "./fixtures/web.js";
import { randomUUID } from "node:crypto";
import { WebControlService } from "../../src/control/webService.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openControlStore } from "../../src/control/store.js";
import { validateRetryGrantSource } from "../../src/control/retryGrant.js";
import { describe, expect, it } from "vitest";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { deliverScheduledStart, settleProviderAttempt } from "../../src/control/webDispatch.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { readWebGroup } from "../../src/control/webService.js";
import { latestRequestForRun } from "../../src/control/stopIntent.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { work, allocation, active } from "./fixtures/handoffHarness.js";
import { unknownFailure, settle, handoff, ds, sum } from "./fixtures/unknownFailure.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const retry = (t: Harness) => t.service.retryTask(t.h.command("retry-task", { taskId: "a" }));
const view = (t: Harness) => readControlGroup(t.h.store, "epoch-test", "g");
const ledger = (t: Harness) => readWebGroup(t.h.store, "g").ledger;
async function resumeEmpty(t: Harness) {
  expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).not.toHaveProperty("error");
}
async function claim(t: Harness) {
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(JSON.stringify(delivered));
  return delivered.runId;
}
async function reopen(t: Harness) {
  const stateDir = t.h.store.stateDir;
  const template = t.h.command("start", {}), dispose = t.h.dispose;
  t.h.store.close();
  const store = await openControlStore({ stateDir });
  t.h.store = store; t.h.deps.store = store; t.deps.store = store; t.dispatch.store = store;
  t.service = new WebControlService({ ...t.service.deps, store });
  t.h.command = ((verb: string, payload: unknown) => ({ ...template, commandId: `restart-${randomUUID()}`, verb, payload,
    expectedRevision: Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision) })) as typeof t.h.command;
  t.claim = async () => {
    const started = await t.service.start(t.h.command("start", {}));
    if ("error" in started) throw new Error(JSON.stringify(started));
    return claim(t);
  };
  t.h.dispose = async () => { store.close(); await dispose(); };
  view(t);
}
function advanceHead(t: Harness) {
  git(t.repo, "checkout", "-q", "orca/g");
  writeFileSync(join(t.repo, "new-head.txt"), "head after failure\n");
  git(t.repo, "add", "new-head.txt"); git(t.repo, "commit", "-qm", "new head");
  git(t.repo, "checkout", "-q", "main");
}
async function accepted(t: Harness, id: string) {
  expect(stepA1(t.deps, id)).toBe(true);
  expect(await stepA2(t.deps, id)).toBe(true);
  await t.until(t.driver(), () => t.fake.calls.accept.some(e => e.claim.runId === id));
  const sent = t.fake.calls.accept.find(e => e.claim.runId === id)!;
  expect(sent).toBeDefined();
  expect(sent.work.kind).toBe("loop");
  if (sent.work.kind !== "loop") throw new Error("loop required");
  const policy = (sent.work.contract as any).executionPolicy;
  const frozen = readConfirmedTaskExecution(t.h.store, "g", "a");
  const grant = t.body(id).grant.work;
  expect(policy.tokenBudget).toBe(Math.min(frozen.contract.executionPolicy.tokenBudget, grant.tokens));
  expect(policy.maxAttempts).toBe(Math.min(frozen.contract.executionPolicy.maxAttempts, grant.attempts));
  expect(policy.totalRuntimeBudgetMs).toBe(Math.min(frozen.contract.executionPolicy.totalRuntimeBudgetMs, grant.activeMs));
  expect(sent.contractHash).toBe(frozen.derivedContractHash);
  expect(sent.inputCheckpoint).toBeNull();
  expect(t.body(id).drive.base).toBe(git(t.repo, "rev-parse", "refs/heads/orca/g"));
  view(t);
}
async function reduced() {
  let behaviour: FakeBehaviour = "stoppable";
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour, stopReason: () => "provider crashed" });
  const l = ledger(t).groupLimit;
  expect(t.service.setLimit(t.h.command("set-limit", { limit: Object.fromEntries(ds.map(d => [d, l[d] * 5])) } as any))).not.toHaveProperty("error");
  const first = await t.claim(), driver = t.driver();
  await t.until(driver, () => t.body(first).state === "accepted");
  await handoff(t, first, driver);
  expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: first, checkpointId: t.body(first).checkpointId }] }))).not.toHaveProperty("error");
  behaviour = "failed";
  const id = await claim(t);
  await t.until(driver, () => t.body(id).state === "blocked");
  await handoff(t, id, driver);
  await resumeEmpty(t);
  return { t, id, driver, setBehaviour: (value: FakeBehaviour) => { behaviour = value; } };
}

describe("M3 handoff failure retry lifecycle", { timeout: 60_000 }, () => {
  it("retries a handoff-settled failed continuation at its claim grant", async () => {
    const { t, id } = await reduced(); try {
      const failed = t.body(id), before = ledger(t), frozen = readConfirmedTaskExecution(t.h.store, "g", "a");
      expect(failed.grant.work.tokens).toBeLessThan(frozen.grant.work.tokens);
      expect(failed.grant.work.activeMs).toBeLessThan(frozen.grant.work.activeMs);
      expect(failed.grant.work.attempts).toBeLessThan(frozen.grant.work.attempts);
      expect(retry(t)).not.toHaveProperty("error");
      expect(work(t, "a")).toMatchObject({ status: "ready", grant: failed.grant, retryGrantSourceRunId: id });
      expect(work(t, "a").continuation).toBeUndefined();
      expect(allocation(t, "a")).toMatchObject({ state: "retrying", amount: failed.grant.work });
      expect(t.body(id)).toMatchObject({ state: "settled-failed", endedAt: failed.endedAt, drive: { stopReason: failed.drive.stopReason } });
      for (const d of ds) expect(ledger(t).committedRemaining[d]).toBe(before.committedRemaining[d] + sum(failed.grant)[d] - sum(failed.remaining)[d]);
      expect(() => view(t)).not.toThrow();
      advanceHead(t);
      const next = await t.claim();
      await accepted(t, next);
      expect(t.body(next).grant).toEqual(failed.grant);
    } finally { await t.h.dispose(); }
  });
  it("retries released manual settlement without releasing twice", async () => {
    const { t, runId, driver } = await unknownFailure(undefined, true, { extraReserve: true }); try {
      await handoff(t, runId, driver);
      expect(await settle(t, runId)).not.toHaveProperty("error");
      const failed = t.body(runId), before = ledger(t);
      await resumeEmpty(t);
      expect(await t.service.continueTask(t.h.taskCommand("continue-task", "a", { predecessorRunId: runId, checkpointId: failed.checkpointId }))).toHaveProperty("error.code", "continuation-predecessor-unrecoverable");
      const command = t.h.command("retry-task", { taskId: "a" });
      expect(t.service.retryTask(command)).not.toHaveProperty("error");
      expect(t.service.retryTask(command)).not.toHaveProperty("error");
      expect(retry(t)).toHaveProperty("error.code", "task-not-retryable");
      for (const d of ds) expect(ledger(t).committedRemaining[d]).toBe(before.committedRemaining[d] + sum(failed.grant)[d]);
      expect(t.body(runId).endedAt).toBe(failed.endedAt);
      expect(active(t, runId)).toBe(0);
      expect(() => view(t)).not.toThrow();
      advanceHead(t);
      const next = await t.claim(); await accepted(t, next);
    } finally { await t.h.dispose(); }
  });
  it("settles unknown usage before handoff then resumes and retries from head", async () => {
    const { t, runId, driver } = await unknownFailure(undefined, false, { extraReserve: true }); try {
      expect(await settle(t, runId)).not.toHaveProperty("error");
      await handoff(t, runId, driver);
      expect(latestRequestForRun(t.h.store, "g", runId)?.state).toBe("settled-recoverable");
      await resumeEmpty(t);
      expect(retry(t)).not.toHaveProperty("error");
      expect(() => view(t)).not.toThrow();
      advanceHead(t);
      const next = await t.claim(); await accepted(t, next);
    } finally { await t.h.dispose(); }
  });
  it("rearms invalid first proof with the newest currentRunId and no second reservation", async () => {
    const { t, id } = await reduced(); try {
      expect(retry(t)).not.toHaveProperty("error");
      const next = await t.claim(), before = ledger(t);
      expect(settleProviderAttempt(t.dispatch, { runId: next, phase: "work", firstAttemptProof: "invalid" })).toMatchObject({ providerCalls: 0 });
      expect(work(t, "a")).toMatchObject({ currentRunId: next, retryGrantSourceRunId: id });
      expect(() => view(t)).not.toThrow();
      await reopen(t);
      const again = await claim(t);
      expect(ledger(t)).toEqual(before);
      expect(t.body(again).grant).toEqual(t.body(id).grant);
      await accepted(t, again);
    } finally { await t.h.dispose(); }
  });
  it("resumes a pre-provider stopped retry without a second reservation", async () => {
    const { t, id, driver } = await reduced(); try {
      expect(retry(t)).not.toHaveProperty("error");
      const next = await t.claim(), before = ledger(t);
      await handoff(t, next, driver);
      expect(t.body(next).state).toBe("settled-restartable");
      expect(work(t, "a")).toMatchObject({ currentRunId: next, retryGrantSourceRunId: id });
      expect(() => view(t)).not.toThrow();
      await resumeEmpty(t);
      await reopen(t);
      const again = await t.claim();
      expect(ledger(t)).toEqual(before);
      await accepted(t, again);
    } finally { await t.h.dispose(); }
  });
  it("active retry after reduced retry remains valid", async () => {
    const { t, id, driver } = await reduced(); try {
      expect(retry(t)).not.toHaveProperty("error");
      const next = await t.claim();
      await t.until(driver, () => t.body(next).state === "blocked");
      expect(retry(t)).not.toHaveProperty("error");
      expect(work(t, "a").retryGrantSourceRunId).toBe(next);
      expect(() => view(t)).not.toThrow();
      const again = await t.claim(); await accepted(t, again);
    } finally { await t.h.dispose(); }
  });
  it("rejects retry source identity, amount and no-provider drift in both shared readers", async () => {
    const { t, id } = await reduced(); try {
      expect(retry(t)).not.toHaveProperty("error");
      const next = await t.claim();
      settleProviderAttempt(t.dispatch, { runId: next, phase: "work", firstAttemptProof: "invalid" });
      const original = work(t, "a"), originalRun = t.body(next);
      for (const mode of ["missing", "old-source", "grant", "agent", "hash", "lineage", "pending", "cumulative", "execution", "run-grant", "run-agent", "run-hash", "run-graph", "unknown"] as const) {
        const w = structuredClone(original), r = structuredClone(originalRun);
        if (mode === "missing") delete w.retryGrantSourceRunId;
        if (mode === "old-source") w.retryGrantSourceRunId = w.lineageRunIds.find((v: string) => v !== id && v !== next);
        if (mode === "grant") w.grant.work.tokens++;
        if (mode === "agent") w.agent.model = "other";
        if (mode === "hash") w.derivedContractHash = "0".repeat(64);
        if (mode === "lineage") w.lineageRunIds = [next];
        if (mode === "pending") w.pendingRunId = "other-pending";
        if (mode === "cumulative") r.cumulative.work.tokens = 1;
        if (mode === "execution") r.executionId = "provider-did-start";
        if (mode === "run-grant") r.grant.work.attempts++;
        if (mode === "run-agent") r.agent.model = "other";
        if (mode === "run-hash") r.ownerToken = "other-owner";
        if (mode === "run-graph") r.graphVersion++;
        if (mode === "unknown") r.unknown.work = true;
        t.h.store.db.prepare("UPDATE work_items SET body=? WHERE id='a'").run(JSON.stringify(w));
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(r), next);
        expect(() => readConfirmedTaskExecution(t.h.store, "g", "a"), mode).toThrow("recovery-blocked");
        expect(() => view(t), mode).toThrow("recovery-blocked");
        expect(() => validateRetryGrantSource(t.h.store, "g", work(t, "a")), mode).toThrow("recovery-blocked");
        t.h.store.db.prepare("UPDATE work_items SET body=? WHERE id='a'").run(JSON.stringify(original));
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(originalRun), next);
      }
      await reopen(t);
      const again = await claim(t); await accepted(t, again);
    } finally { await t.h.dispose(); }
  });
  it("clears the live source atomically when a provider retry parks held and Continue remains legal", async () => {
    const { t, id, driver } = await reduced(); try {
      expect(retry(t)).not.toHaveProperty("error");
      const next = await t.claim();
      await t.until(driver, () => t.body(next).state === "blocked");
      await handoff(t, next, driver);
      expect(work(t, "a").retryGrantSourceRunId).toBeUndefined();
      expect(allocation(t, "a").state).toBe("held");
      expect(() => view(t)).not.toThrow(); await reopen(t);
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: next, checkpointId: t.body(next).checkpointId }] }))).not.toHaveProperty("error");
      const continued = await claim(t);
      expect(t.body(continued).continuationIntentId).not.toBeNull();
    } finally { await t.h.dispose(); }
  });
  it("clears live retry source on normal terminal success", async () => {
    const { t, driver, setBehaviour } = await reduced(); try {
      expect(retry(t)).not.toHaveProperty("error");
      setBehaviour("succeed");
      const next = await t.claim();
      await t.until(driver, () => t.body(next).state === "settled");
      expect(work(t, "a").retryGrantSourceRunId).toBeUndefined();
      expect(work(t, "a").status).toBe("done");
      expect(allocation(t, "a").state).toBe("terminal");
      expect(() => view(t)).not.toThrow(); await reopen(t);
    } finally { await t.h.dispose(); }
  });
  it("clears live retry source on unrecoverable provider handoff", async () => {
    const { t, driver } = await reduced(); try {
      expect(retry(t)).not.toHaveProperty("error");
      const next = await t.claim(), collect = t.fake.port.collect;
      t.fake.port.collect = async (envelope, after) => {
        const report = await collect(envelope, after);
        if (envelope.claim.runId === next && report.events.length) report.events[0]!.cumulative = null;
        return report;
      };
      t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
      await t.until(driver, () => t.body(next).state === "blocked");
      await handoff(t, next, driver);
      expect(t.body(next).state).toBe("settled-unrecoverable");
      expect(work(t, "a").retryGrantSourceRunId).toBeUndefined();
      expect(allocation(t, "a").state).toBe("terminal");
      expect(() => view(t)).not.toThrow(); await reopen(t);
    } finally { await t.h.dispose(); }
  });
  it("keeps stopped and archived M3 failures inadmissible", async () => {
    const { t, id } = await reduced(); try {
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).not.toHaveProperty("error");
      expect(retry(t)).toHaveProperty("error.code", "stop-mode-conflict");
      expect(work(t, "a").status).toBe("held");
      expect(t.body(id).state).toBe("settled-recoverable");
      expect(t.service.archiveGroup(t.h.command("archive-group", {}))).not.toHaveProperty("error");
      expect(retry(t)).toHaveProperty("error.code", "group-archived");
    } finally { await t.h.dispose(); }
  });
  it.each(["unknown", "pending"] as const)("refuses M3 while another historical run has %s usage", async mode => {
    const { t, id } = await reduced(); try {
      const other = work(t, "a").lineageRunIds.find((v: string) => v !== id), r = t.body(other);
      if (mode === "unknown") {
        r.unknown.work = true;
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(r), other);
      } else t.h.store.db.prepare("INSERT INTO usage_events VALUES (?,?,?,?)").run(other, r.highWater + 1, "0".repeat(64), "{}");
      const before = [work(t, "a"), ledger(t), t.body(id)];
      expect(retry(t)).toHaveProperty("error.message", `task-not-retryable:usage-${mode}`);
      expect([work(t, "a"), ledger(t), t.body(id)]).toEqual(before);
    } finally { await t.h.dispose(); }
  });
  it.each(["taskId", "targetVersion", "continuationIntentId", "grant"] as const)("refuses a failed predecessor with drifted %s before reservation", async field => {
    const { t, id } = await reduced(); try {
      const r = t.body(id);
      if (field === "taskId") r.taskId = "other";
      if (field === "targetVersion") r.targetVersion++;
      if (field === "continuationIntentId") r.continuationIntentId = "other-continuation";
      if (field === "grant") r.grant.work.tokens++;
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(r), id);
      const before = [work(t, "a"), ledger(t), t.body(id)];
      expect(retry(t)).toHaveProperty("error.code", "recovery-blocked");
      expect([work(t, "a"), ledger(t), t.body(id)]).toEqual(before);
    } finally { await t.h.dispose(); }
  });
  it("refuses reduced retry when reserve is insufficient or a continuation registration is foreign", async () => {
    const { t, id } = await reduced(); try {
      const before = ledger(t);
      expect(t.service.setLimit(t.h.command("set-limit", { limit: { ...before.groupLimit, tokens: before.used.tokens + before.committedRemaining.tokens } }))).not.toHaveProperty("error");
      const unchanged = work(t, "a");
      expect(retry(t)).toHaveProperty("error.code", "group-reserve-insufficient");
      expect(work(t, "a")).toEqual(unchanged);
      expect(t.body(id).state).toBe("settled-recoverable");
      expect(t.service.setLimit(t.h.command("set-limit", { limit: before.groupLimit }))).not.toHaveProperty("error");
      t.h.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.continuation',json(?)) WHERE id='a'").run(JSON.stringify({ continuationIntentId: "foreign", pendingRunId: id }));
      expect(retry(t)).toHaveProperty("error.code", "task-not-retryable");
    } finally { await t.h.dispose(); }
  });
});
