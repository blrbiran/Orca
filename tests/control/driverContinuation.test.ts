import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stepA1, stepA2, withinGrant } from "../../src/control/executionDriver.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { allocation, committedAndUsed, crashingAt, requestState, stop, work, type Harness } from "./fixtures/handoffHarness.js";

// Handoff delivery spec §4 (human ruling plan X), §11 I5, I6, M4, §13.2 C-6, I-5: the driver runs the continuation
// `resume-from-handoff` registered. It starts from its predecessor's base (never the current tip), carries the
// predecessor's checkpoint to ccloop, spends at most the task's remaining grant, and a continuation stopped before
// it started hands the task back to that predecessor.

/** A task stopped mid-run and parked held: its run is the predecessor to continue. */
async function parked(behaviour: { value: FakeBehaviour }) {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour.value });
  const predecessor = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(predecessor).state === "accepted");
  const [requestId] = await stop(t);
  await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
  return { t, predecessor, driver, checkpointId: t.body(predecessor).checkpointId as string };
}

/** resume-from-handoff choosing the predecessor (no claim yet). */
async function register(t: Harness, predecessor: string, checkpointId: string): Promise<void> {
  const result = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: predecessor, checkpointId }] } as never));
  if ("error" in result) throw new Error(`resume-from-handoff refused: ${JSON.stringify(result.error)}`);
}

/** The pump's delivery of the resume wake: the continuation run. */
async function claimResume(t: Harness): Promise<string> {
  const claimed = await deliverScheduledStart(t.dispatch, "g");
  if (claimed.kind !== "claimed") throw new Error(`resume claim refused: ${JSON.stringify(claimed)}`);
  return claimed.runId;
}

async function resume(t: Harness, predecessor: string, checkpointId: string): Promise<string> {
  await register(t, predecessor, checkpointId);
  return claimResume(t);
}

describe("a continuation run (spec §4)", { timeout: 60_000 }, () => {
  it("keeps its predecessor's base though the tip moved, carries the checkpoint, is cut to the remaining grant, and lands", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, driver, checkpointId } = await parked(behaviour); try {
      const base = t.body(predecessor).drive.base as string;
      const predecessorWorkspace = t.body(predecessor).drive.workspacePath as string;
      // Someone else moves orca/g meanwhile: plan X must not follow it.
      git(t.repo, "checkout", "-q", "orca/g");
      writeFileSync(join(t.repo, "other.txt"), "other\n");
      git(t.repo, "add", "other.txt");
      git(t.repo, "commit", "-qm", "moved tip");
      git(t.repo, "checkout", "-q", "main");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).not.toBe(base);
      behaviour.value = "succeed";
      const continuation = await resume(t, predecessor, checkpointId);
      await t.until(driver, () => t.body(continuation).state === "settled" && t.body(continuation).drive.cleanedUp === true);
      const run = t.body(continuation);
      expect(run.drive.base).toBe(base);
      const envelope = t.fake.calls.accept.find((sent) => sent.claim.runId === continuation)!;
      expect(envelope.inputCheckpoint).toMatchObject({ predecessorRunId: predecessor, checkpointId });
      expect(envelope.inputCheckpoint!.bundlePath).toBe(join(run.drive.sourceDir, "input", checkpointId));
      expect(envelope.inputCheckpoint!.checkpointHash).toBe(String(t.h.store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(checkpointId)!.hash));
      const policy = (envelope.work.contract as { executionPolicy: { maxAttempts: number; tokenBudget: number; totalRuntimeBudgetMs: number } }).executionPolicy;
      const confirmed = readConfirmedTaskExecution(t.h.store, "g", "a").contract.executionPolicy;
      expect(policy).toEqual(withinGrant(confirmed, run.grant.work));
      // Not vacuous: the predecessor spent part of the task's grant, so the cut is visible.
      expect(policy.tokenBudget).toBeLessThan(confirmed.tokenBudget);
      expect(work(t, "a").status).toBe("done");
      expect(git(t.repo, "rev-parse", `${run.drive.landedCommit}^1`)).not.toBe(base);
      // spec §4: the predecessor's workspace goes once the bundle exists; its checkpoint stays.
      expect(existsSync(predecessorWorkspace)).toBe(false);
      expect(t.body(predecessor).drive.cleanedUp).toBe(true);
      // The task's lineage reads back whole: the parked predecessor, then its continuation (deviations D-SNAP, D-VIEW).
      const views = readControlGroup(t.h.store, "epoch-test", "g").runs;
      expect(Object.fromEntries(views.map((view) => [view.runId, view.state]))).toEqual({ [predecessor]: "settled-recoverable", [continuation]: "settled-recoverable" });
    } finally { await t.h.dispose(); }
  });

  it("keeps the first base down a chain: a continuation stopped again is continued from the same base", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, driver, checkpointId } = await parked(behaviour); try {
      const base = t.body(predecessor).drive.base as string;
      const second = await resume(t, predecessor, checkpointId);
      await t.until(driver, () => t.body(second).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      behaviour.value = "succeed";
      const third = await resume(t, second, t.body(second).checkpointId as string);
      await t.until(driver, () => t.body(third).state === "settled");
      expect([t.body(second).drive.base, t.body(third).drive.base]).toEqual([base, base]);
    } finally { await t.h.dispose(); }
  });

  // Cross-task question (controller, 2026-09-25): the held commitment H-settle leaves is the one the continuation's
  // grant draws on. Resuming, claiming and reserving A1's attempt must neither reserve it a second time nor drop it.
  it("draws its grant from the held commitment: the group's reserved plus used, and every ledger mirror, are conserved from park to A1", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, checkpointId } = await parked(behaviour); try {
      const ledger = () => {
        const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
        const proposal = readBudgetProposal(t.h.store, "g");
        return {
          committedAndUsed: committedAndUsed(t),
          mirror: { used: group.ledger.used, committedRemaining: group.ledger.committedRemaining },
          reserve: [proposal.explicitUnallocatedReserve, proposal.allocations.find((a) => a.ownerKind === "reserve")!.amount],
        };
      };
      const held = ledger();
      // The mirror is the group itself, not a stale copy.
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      expect(held.mirror).toEqual({ used: group.used, committedRemaining: group.reserved });
      await register(t, predecessor, checkpointId);
      expect(ledger()).toEqual(held);
      const continuation = await claimResume(t);
      expect(ledger()).toEqual(held);
      expect(stepA1(t.deps, continuation)).toBe(true);
      expect(t.body(continuation).state).toBe("start-pending");
      expect(ledger()).toEqual(held);
    } finally { await t.h.dispose(); }
  });
});

describe("a continuation whose registration is not its own (spec §4)", { timeout: 60_000 }, () => {
  it("is blocked by name at A2, before any bundle or provider attempt, when the task registers a different continuation", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, checkpointId } = await parked(behaviour); try {
      const continuation = await resume(t, predecessor, checkpointId);
      const body = t.body(continuation);
      body.continuationIntentId = "continuation-other";
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), continuation);
      expect(work(t, "a").continuation).toMatchObject({ predecessorRunId: predecessor });
      expect(stepA1(t.deps, continuation)).toBe(true);
      expect(await stepA2(t.deps, continuation)).toBe(true);
      expect(t.body(continuation)).toMatchObject({ state: "blocked", drive: { blockedAt: "A2", blockedReason: "continuation-registration" } });
      expect(existsSync(join(t.body(continuation).drive.sourceDir, "input"))).toBe(false);
      expect(t.fake.calls.accept.filter((sent) => sent.claim.runId === continuation)).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });

  it("is blocked by name at A2 when its predecessor has no base the driver recorded", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, checkpointId } = await parked(behaviour); try {
      const continuation = await resume(t, predecessor, checkpointId);
      // A predecessor the driver never prepared (a run of an earlier slice): there is no base to keep (plan X).
      const old = t.body(predecessor);
      delete old.drive;
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(old), predecessor);
      expect(stepA1(t.deps, continuation)).toBe(true);
      expect(await stepA2(t.deps, continuation)).toBe(true);
      expect(t.body(continuation)).toMatchObject({ state: "blocked", drive: { blockedAt: "A2", blockedReason: "continuation-registration" } });
      expect(t.fake.calls.accept.filter((sent) => sent.claim.runId === continuation)).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });
});

describe("withinGrant (spec §13.2 I-5)", () => {
  // Each dimension on its own: the end-to-end criterion compares against withinGrant itself, so only this one sees a
  // dimension the cut forgets.
  it("cuts each of the three limits to the grant's matching dimension, and only where the grant is smaller", () => {
    const policy = { maxAttempts: 5, tokenBudget: 1_000, totalRuntimeBudgetMs: 9_000, mode: "kept" };
    expect(withinGrant(policy, { attempts: 2, tokens: 400, activeMs: 3_000 })).toEqual({ maxAttempts: 2, tokenBudget: 400, totalRuntimeBudgetMs: 3_000, mode: "kept" });
    expect(withinGrant(policy, { attempts: 7, tokens: 4_000, activeMs: 30_000 })).toEqual(policy);
  });
});

describe("a continuation stopped before it started (spec §13.2 C-6)", { timeout: 60_000 }, () => {
  it("hands the task back to its predecessor, which can be chosen again and continued with its checkpoint", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, driver, checkpointId } = await parked(behaviour); try {
      const amountBefore = allocation(t, "a").amount;
      const continuation = await resume(t, predecessor, checkpointId);
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-restartable");
      expect(t.fake.calls.accept.filter((sent) => sent.claim.runId === continuation)).toHaveLength(0);
      expect(work(t, "a")).toMatchObject({ status: "held", currentRunId: predecessor, pendingRunId: null, continuation: null });
      expect(allocation(t, "a")).toMatchObject({ state: "held", amount: amountBefore });
      behaviour.value = "succeed";
      const again = await resume(t, predecessor, checkpointId);
      await t.until(driver, () => t.body(again).state === "settled");
      expect(t.fake.calls.accept.find((sent) => sent.claim.runId === again)!.inputCheckpoint).toMatchObject({ predecessorRunId: predecessor, checkpointId });
    } finally { await t.h.dispose(); }
  });
});

describe("A2 of a continuation after a death (spec §11 I5; R-H A2-after-bundle)", { timeout: 60_000 }, () => {
  it("reuses the bundle it already published instead of failing on resume-bundle-exists", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, checkpointId } = await parked(behaviour); try {
      behaviour.value = "succeed";
      const continuation = await resume(t, predecessor, checkpointId);
      const crashing = crashingAt(t, "A2-after-bundle");
      await t.until(crashing, () => crashing.crashed !== null);
      const sourceDir = t.body(continuation).drive.sourceDir as string;
      expect(readdirSync(join(sourceDir, "input"))).toEqual([checkpointId]);
      await t.until(t.driver(), () => t.body(continuation).state === "settled");
      expect(t.fake.calls.accept.find((sent) => sent.claim.runId === continuation)!.inputCheckpoint!.bundlePath).toBe(join(sourceDir, "input", checkpointId));
      expect(readdirSync(join(sourceDir, "input"))).toEqual([checkpointId]);
    } finally { await t.h.dispose(); }
  });

  it("refuses a published bundle whose manifest no longer names the committed checkpoint", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, checkpointId } = await parked(behaviour); try {
      behaviour.value = "succeed";
      const continuation = await resume(t, predecessor, checkpointId);
      const crashing = crashingAt(t, "A2-after-bundle");
      await t.until(crashing, () => crashing.crashed !== null);
      const manifestPath = join(t.body(continuation).drive.sourceDir, "input", checkpointId, "resume-bundle.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, checkpointHash: "0".repeat(64) }));
      await t.until(t.driver(), () => t.body(continuation).state === "blocked");
      expect(t.body(continuation).drive).toMatchObject({ blockedAt: "A2", blockedReason: "resume-bundle-hash-mismatch" });
      expect(t.fake.calls.accept.filter((sent) => sent.claim.runId === continuation)).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });
});
