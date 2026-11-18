import { describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { listBaseChecks } from "../../src/control/baseCheckRecord.js";
import { finalRejectionOf, priorFailureOf } from "../../src/control/priorFailures.js";
import { saveTaskResultState } from "../../src/control/taskResultStore.js";
import type { TaskResultCollector } from "../../src/control/taskResultCollector.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #321 C1 (plan 2026-11-18 tester batch D, D2; review-repair-attempt.md C1): ccloop keeps a rejection as Orca's
 * `lastFailure` only when it retries after it. A run whose final attempt was its verification rejection -- a one-attempt
 * run failing its required check -- has none, so the next run was told only `run-failed:required-check-failed` and #341's
 * base check was never asked for. ccloop still stores that attempt's verification; the next run is now told its command
 * and evidence, and the base check runs for that command.
 */

const CHECK = "test -e check-marker";
const LINT = "test -e lint-marker";
const CAUSE = { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null };
const EVIDENCE = ["command output | required check failed: test -e check-marker | exit=1"];
const LINT_EVIDENCE = ["command output | required check failed: test -e lint-marker | exit=1"];

type Harness = Awaited<ReturnType<typeof driverHarness>>;
type Stored = { attempt: number; command: string; evidence: string[]; artifact?: "present" | "missing" };

/**
 * The collector's stored copy of the run's verifications, as it keeps them once it has collected: one rejected
 * verification per attempt given, the page's currentAttempt `current` (ccloop's state.currentAttempt).
 */
async function storeRejections(t: Harness, runId: string, current: number, stored: Stored[]): Promise<void> {
  const observations: unknown[] = [];
  for (const entry of stored) {
    const bytes = Buffer.from(JSON.stringify({ approved: false, rejectCategory: "required-check-failed", primaryTargetPaths: ["a"], failingCommand: entry.command, safeToRetry: false, evidence: entry.evidence, pauseSignals: [], stopSignals: [] }));
    const ref = (entry.artifact ?? "present") === "present" ? await writeArtifact(t.h.store, `verify-${runId}-${entry.attempt}`, bytes)
      : { artifactId: `verify-missing-${runId}-${entry.attempt}`, hash: "0".repeat(64) };
    observations.push({ manifestRef: ref, manifest: { attempt: entry.attempt, stage: "verification", verificationRef: ref }, verification: "failed" });
  }
  t.h.store.transaction(() => saveTaskResultState(t.h.store, runId, "g", {
    schema: "orca-task-result-store-v1", identity: { runId } as never, revision: stored.length, sourceRevision: stored.length, currentAttempt: current, reason: null,
    observations: observations as never, status: "available",
  }));
}
const storeFinalRejection = (t: Harness, runId: string, options: { artifact: "present" | "missing" }): Promise<void> =>
  storeRejections(t, runId, 1, [{ attempt: 1, command: CHECK, evidence: EVIDENCE, artifact: options.artifact }]);

/**
 * A run that ends `required-check-failed` on its final attempt (`attempts`), with `lastFailure` as ccloop leaves it: none for
 * one attempt, an earlier attempt's otherwise (ccloop keeps a rejection only when it retries after it). The collector
 * stand-in stores nothing when flushed -- the real one stores the verifications a while after the collect, which the
 * criterion plays by calling storeRejections itself once the run is blocked. The next run is claimed and prepared as
 * baseCheck.test.ts does it.
 */
async function failedWorld(options: { attempts: number; lastFailure?: { rejectCategory: string; failingCommand: string; primaryTargetPaths: string[] } }) {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", requiredChecks: [LINT, CHECK], workAttempts: () => options.attempts,
    // ccloop's terminal states the attempt the run ended on (terminalSchema currentAttempt); the port maps it through.
    failure: () => ({ failureCause: CAUSE, currentAttempt: options.attempts, ...(options.lastFailure === undefined ? {} : { lastFailure: options.lastFailure }) }) });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const flushed: string[] = [];
  const collector: TaskResultCollector = { schedule: () => undefined, flush: async (runId) => { flushed.push(runId); }, stop: async () => undefined };
  t.deps.taskResults = collector;
  const driver = t.driver();
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo, scheduleTaskResults: () => undefined });
  const run = await t.claim();
  await t.until(driver, () => t.body(run).state === "blocked", 120);
  const next = async (): Promise<string> => {
    expect((await service.systemDebugPass()).redispatched).toEqual(["g:a"]);
    replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
    const delivered = await deliverScheduledStart(t.dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => t.body(delivered.runId).drive?.prepared === true, 120);
    return delivered.runId;
  };
  const priorFailures = (runId: string) => (JSON.parse(readCanonicalRecord(t.h.store, t.body(runId).drive.envelopeHash)) as { work: { priorFailures?: unknown[] } }).work.priorFailures;
  const asked = () => listBaseChecks(t.h.store).map((row) => [row.command, row.runId, row.taskId]);
  return { t, driver, run, flushed, next, priorFailures, asked };
}

/** A one-attempt run (ccloop's row-6 shape: no lastFailure). */
async function oneAttemptWorld(artifact: "present" | "missing") {
  const w = await failedWorld({ attempts: 1 });
  return { ...w, stored: () => storeFinalRejection(w.t, w.run, { artifact }) };
}

describe("the next run is told the check that failed its predecessor's last attempt (#321 C1)", { timeout: 120_000 }, () => {
  it("one attempt, final verification stored after C: the next run is told the command and its evidence, and its A2 asks for the base check", async () => {
    const { t, run, flushed, next, priorFailures, asked, stored } = await oneAttemptWorld("present");
    try {
      expect(t.body(run).drive.lastFailure).toBeUndefined();
      expect(t.body(run).drive.failureCause).toMatchObject({ cause: "required-check-failed", phase: "verify" });
      // Ruling (2026-11-18 tester batch D review): 「这次批准改写所有必要的判据」 -- review I2 removed step C's bounded wait for
      // the collector (it held the serial driver pass for every group); this criterion pinned that C flushed and asked.
      // Now C neither waits nor asks, and the next run's A2 asks where it builds its prior failures.
      // mutation: re-add C's flush-and-read -> flushed contains the run, red here.
      expect.soft(flushed).toEqual([]);
      expect.soft(asked()).toEqual([]);
      await stored();
      // Each fact measured on its own (expect.soft): a mutation shows every one it breaks, not the first.
      expect.soft(await finalRejectionOf(t.h.store, run)).toEqual({ rejectCategory: "required-check-failed", failingCommand: CHECK, evidence: EVIDENCE });
      // mutation: finalRejectionOf answers null -> run-failed:required-check-failed, no command, red here.
      expect.soft(await priorFailureOf(t.h.store, { runId: run, groupId: "g", drive: t.body(run).drive })).toEqual({
        runId: run, rejectCategory: "required-check-failed", failingCommand: CHECK, evidence: EVIDENCE, failureCause: "required-check-failed",
      });
      const second = await next();
      expect.soft(priorFailures(second)).toEqual([expect.objectContaining({ runId: run, rejectCategory: "required-check-failed", failingCommand: CHECK })]);
      // mutation: drop A2's requestPriorBaseCheck -> no row, red here. The asker is the failed run, not the new one.
      expect.soft(asked()).toEqual([[CHECK, run, "a"]]);
    } finally { await t.h.dispose(); }
  });

  it("review I1: attempt 1 rejected on lint (lastFailure), the final attempt 2 on test -- the next run is told test and the base check runs for test", async () => {
    const w = await failedWorld({ attempts: 2, lastFailure: { rejectCategory: "required-check-failed", failingCommand: LINT, primaryTargetPaths: ["a"] } });
    const { t, run } = w;
    try {
      await storeRejections(t, run, 2, [{ attempt: 1, command: LINT, evidence: LINT_EVIDENCE }, { attempt: 2, command: CHECK, evidence: EVIDENCE }]);
      // mutation: priorFailureOf prefers lastFailure again -> LINT, red here.
      expect.soft(await priorFailureOf(t.h.store, { runId: run, groupId: "g", drive: t.body(run).drive })).toEqual({
        runId: run, rejectCategory: "required-check-failed", failingCommand: CHECK, evidence: EVIDENCE, failureCause: "required-check-failed",
      });
      const second = await w.next();
      expect.soft(w.priorFailures(second)).toEqual([expect.objectContaining({ runId: run, failingCommand: CHECK })]);
      // Step C asked with lastFailure (lint, as before this fix); A2 asks for the final attempt's command.
      expect.soft(w.asked()).toContainEqual([CHECK, run, "a"]);
    } finally { await t.h.dispose(); }
  });

  it("review I1: only the final attempt's stored rejection is final -- an earlier attempt's alone answers null", async () => {
    const w = await failedWorld({ attempts: 2, lastFailure: { rejectCategory: "required-check-failed", failingCommand: LINT, primaryTargetPaths: ["a"] } });
    const { t, run } = w;
    try {
      await storeRejections(t, run, 2, [{ attempt: 1, command: LINT, evidence: LINT_EVIDENCE }]);
      expect(t.body(run).drive.finalAttempt).toBe(2);
      // mutation: drop the attempt filter -> attempt 1's rejection, red here.
      expect(await finalRejectionOf(t.h.store, run, t.body(run).drive.finalAttempt)).toBeNull();
      // Ruling (2026-11-18 tester batch D review 3): this pinned a fallback to lastFailure (LINT). lastFailure is attempt 1's
      // rejection; the run ended on attempt 2's, which is not stored, so the run is remembered by its run-failed line.
      // mutation: drop rejectionOf's finalAttempt > 1 rule -> LINT with its evidence, red here.
      expect(await priorFailureOf(t.h.store, { runId: run, groupId: "g", drive: t.body(run).drive })).toEqual({
        runId: run, rejectCategory: "run-failed:required-check-failed", failingCommand: null, evidence: null, failureCause: "required-check-failed",
      });
    } finally { await t.h.dispose(); }
  });

  // Review 3 (I-B): the collector's page lags at attempt 1 (a collect it missed) while ccloop's terminal said the run ended
  // on attempt 2. The page's currentAttempt named attempt 1 as final, so the next run was told attempt 1's command.
  it("review 3: the collector page lags at attempt 1 while ccloop's terminal says 2 -- the next run is not told attempt 1's command", async () => {
    const w = await failedWorld({ attempts: 2, lastFailure: { rejectCategory: "required-check-failed", failingCommand: LINT, primaryTargetPaths: ["a"] } });
    const { t, run } = w;
    try {
      await storeRejections(t, run, 1, [{ attempt: 1, command: LINT, evidence: LINT_EVIDENCE }]);
      // mutation: step C does not keep ccloop's terminal currentAttempt -> undefined, red here.
      expect.soft(t.body(run).drive.finalAttempt).toBe(2);
      // mutation: filter on the page's currentAttempt again -> attempt 1's LINT, red here.
      expect.soft(await finalRejectionOf(t.h.store, run, t.body(run).drive.finalAttempt)).toBeNull();
      const second = await w.next();
      // mutation: filter on the page's currentAttempt again -> told LINT, red here.
      expect.soft(w.priorFailures(second)).toEqual([expect.objectContaining({ runId: run, rejectCategory: "run-failed:required-check-failed", failingCommand: null })]);
    } finally { await t.h.dispose(); }
  });

  it("Review Focus 5: the stored verification cannot be read -- today's run-failed line, no throw, no base check", async () => {
    const { t, run, stored } = await oneAttemptWorld("missing");
    try {
      await stored();
      expect(await finalRejectionOf(t.h.store, run)).toBeNull();
      expect(await priorFailureOf(t.h.store, { runId: run, groupId: "g", drive: t.body(run).drive })).toEqual({
        runId: run, rejectCategory: "run-failed:required-check-failed", failingCommand: null, evidence: null, failureCause: "required-check-failed",
      });
      expect(listBaseChecks(t.h.store)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a run that failed outside verification is not read for a rejection, even when one is stored", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", requiredChecks: [CHECK], failure: () => ({ failureCause: { cause: "rate-limited", phase: "execute", retries: 0, detail: null } }) });
    try {
      const driver = t.driver();
      const run = await t.claim();
      await t.until(driver, () => t.body(run).state === "blocked", 120);
      await storeFinalRejection(t, run, { artifact: "present" });
      expect(await priorFailureOf(t.h.store, { runId: run, groupId: "g", drive: t.body(run).drive })).toEqual({
        runId: run, rejectCategory: "run-failed:rate-limited", failingCommand: null, evidence: null, failureCause: "rate-limited",
      });
    } finally { await t.h.dispose(); }
  });
});
