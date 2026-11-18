import { describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { listBaseChecks } from "../../src/control/baseCheckRecord.js";
import { finalRejectionOf, priorFailureOf } from "../../src/control/priorFailures.js";
import { saveTaskResultState } from "../../src/control/taskResultStore.js";
import type { TaskResultCollector } from "../../src/control/taskResultCollector.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #321 C1 (plan 2026-11-18 tester batch D, D2; review-repair-attempt.md C1): ccloop keeps a rejection as Orca's
 * `lastFailure` only when it retries after it. A run whose final attempt was its verification rejection -- a one-attempt
 * run failing its required check -- has none, so the next run was told only `run-failed:required-check-failed` and #341's
 * base check was never asked for. ccloop still stores that attempt's verification; the next run is now told its command
 * and evidence, and the base check runs for that command.
 */

const CHECK = "test -e check-marker";
const CAUSE = { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null };
const EVIDENCE = ["command output | required check failed: test -e check-marker | exit=1"];

/** The collector's stored copy of the run's final attempt's verification, as it keeps it once it has collected. */
async function storeFinalRejection(t: Awaited<ReturnType<typeof driverHarness>>, runId: string, options: { artifact: "present" | "missing" }): Promise<void> {
  const bytes = Buffer.from(JSON.stringify({ approved: false, rejectCategory: "required-check-failed", primaryTargetPaths: ["a"], failingCommand: CHECK, safeToRetry: false, evidence: EVIDENCE, pauseSignals: [], stopSignals: [] }));
  const ref = options.artifact === "present" ? await writeArtifact(t.h.store, `verify-${runId}`, bytes)
    : { artifactId: `verify-missing-${runId}`, hash: "0".repeat(64) };
  t.h.store.transaction(() => saveTaskResultState(t.h.store, runId, "g", {
    schema: "orca-task-result-store-v1", identity: { runId } as never, revision: 1, sourceRevision: 1, currentAttempt: 1, reason: null,
    observations: [{ manifestRef: ref, manifest: { attempt: 1, stage: "verification", verificationRef: ref }, verification: "failed" }] as never, status: "available",
  }));
}

/**
 * A one-attempt run that ends `required-check-failed` with no lastFailure (ccloop's row-6 shape). The collector stand-in
 * stores the final verification only when it is flushed -- what the real one does a moment after the collect.
 */
async function oneAttemptWorld(artifact: "present" | "missing") {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", requiredChecks: [CHECK], failure: () => ({ failureCause: CAUSE }) });
  const flushed: string[] = [];
  const collector: TaskResultCollector = {
    schedule: () => undefined,
    flush: async (runId) => { flushed.push(runId); await storeFinalRejection(t, runId, { artifact }); },
    stop: async () => undefined,
  };
  t.deps.taskResults = collector;
  const driver = t.driver();
  const run = await t.claim();
  await t.until(driver, () => t.body(run).state === "blocked", 120);
  return { t, driver, run, flushed };
}

describe("the next run is told the check that failed its predecessor's last attempt (#321 C1)", { timeout: 120_000 }, () => {
  it("one attempt, final verification failed: the prior failure carries the command and its evidence, and the base check is asked for it", async () => {
    const { t, run, flushed } = await oneAttemptWorld("present");
    try {
      expect(t.body(run).drive.lastFailure).toBeUndefined();
      expect(t.body(run).drive.failureCause).toMatchObject({ cause: "required-check-failed", phase: "verify" });
      expect(await finalRejectionOf(t.h.store, run)).toEqual({ rejectCategory: "required-check-failed", failingCommand: CHECK, evidence: EVIDENCE });
      // mutation: finalRejectionOf answers null -> run-failed:required-check-failed, no command, red here.
      expect(await priorFailureOf(t.h.store, { runId: run, groupId: "g", drive: t.body(run).drive })).toEqual({
        runId: run, rejectCategory: "required-check-failed", failingCommand: CHECK, evidence: EVIDENCE, failureCause: "required-check-failed",
      });
      // Step C flushed the collector before it read, and asked for the base run of that command.
      expect(flushed).toContain(run);
      // mutation: finalRejectionOf answers null (or step C never reads it) -> no row, red here.
      expect(listBaseChecks(t.h.store).map((row) => [row.command, row.runId, row.taskId])).toEqual([[CHECK, run, "a"]]);
    } finally { await t.h.dispose(); }
  });

  it("Review Focus 5: the stored verification cannot be read -- today's run-failed line, no throw, no base check", async () => {
    const { t, run } = await oneAttemptWorld("missing");
    try {
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
