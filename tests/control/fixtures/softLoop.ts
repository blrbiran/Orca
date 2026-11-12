// Spec 2026-11-06 soft-mode loop run settlement: shared shapes for its criteria (session 86352010).
import { expect } from "vitest";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { latestRequestForRun } from "../../../src/control/stopIntent.js";
import { recordSoftLoopSince } from "../../../src/control/softLoopSince.js";
import { softLoopSettlementPass } from "../../../src/control/softLoopSettlement.js";
import { canonicalBytes } from "../../../src/control/canonicalJson.js";
import { driverHarness } from "./driverHarness.js";
import { profileSnapshot } from "./web.js";

export type Harness = Awaited<ReturnType<typeof driverHarness>>;
export const ds = ["tokens", "activeMs", "attempts", "sessions"] as const;

/**
 * A failed work run whose usage the tool did not report: one reported event (baseline B = 10 work tokens) and then a
 * null one, as unknownFailure.ts builds it; `floor` is ccloop's usageLowerBound on the collect (an omp run's shape).
 */
/** `modelVersion` (follow-up H): absent, the import's default; null names a group created before the follow-up G release. */
export async function loopUnknown(options: { tasks?: Array<{ taskId: string; tokenBudget?: number | null }>; tokenPolicy?: "optional-v1"; floor?: number; behaviour?: string; modelVersion?: null } = {}) {
  const tasks = options.tasks ?? [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }];
  const t = await driverHarness(tasks as never, { ...(options.tokenPolicy ? { tokenPolicy: options.tokenPolicy } : {}), ...(options.modelVersion === null ? { modelVersion: null } : {}), behaviour: () => (options.behaviour ?? "failed") as never, stopReason: () => "provider crashed" });
  const collect = t.fake.port.collect;
  t.fake.port.collect = async (envelope, after) => {
    const report = await collect(envelope, after);
    if (report.candidate && report.terminal && report.events.length) {
      report.events.push({ ...report.events[0]!, eventSeq: 3, bucket: "work", cumulative: null });
      report.candidate.usageHighWater = 3;
      if (options.floor !== undefined) report.usageLowerBound = { tokens: options.floor };
    }
    return report;
  };
  t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  return { t, runId, driver };
}

/** A run handoff-stopped while working whose usage was never reported (handoffStopUnknownUsage.test.ts's shape). */
export async function stoppedUnknown(tokenPolicy: "optional-v1" | undefined, tokenBudget: number | null, floor?: number) {
  const t = await driverHarness([{ taskId: "a", tokenBudget }] as never, { ...(tokenPolicy ? { tokenPolicy } : {}), killGraceMs: 0, behaviour: () => "stoppable-usage-unknown" });
  if (floor !== undefined) {
    const collect = t.fake.port.collect;
    t.fake.port.collect = async (envelope, after) => ({ ...(await collect(envelope, after)), usageLowerBound: { tokens: floor } });
    t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  }
  const driver = t.driver();
  const runId = await t.claim();
  await t.until(driver, () => t.body(runId).state === "accepted");
  await t.service.handoffStop(t.h.command("handoff-stop", {}));
  await t.until(driver, () => t.body(runId).state === "settled-unrecoverable");
  return { t, runId, driver };
}

export async function handoff(t: Harness, runId: string, driver: ReturnType<Harness["driver"]>) {
  expect(await t.service.handoffStop(t.h.command("handoff-stop", {}))).not.toHaveProperty("error");
  await t.until(driver, () => latestRequestForRun(t.h.store, "g", runId)?.state.startsWith("settled-") === true);
}

/** The cutoff is written by the panel's assembly; a criterion writes it (0: every run in the store ended after it). */
export const since = (t: Harness, at = 0) => recordSoftLoopSince(t.h.store, at);
export const pass = (t: Harness) => softLoopSettlementPass({ store: t.h.store, admissionGate: t.h.deps.admissionGate });

/**
 * A task's work allocation as the estimator sized it (provenance `model`), so its finite grant is not a person's limit.
 * The edit is not in the frozen execution snapshot (readers that compare the two refuse), so it answers the restore,
 * applied once the pass has read it.
 */
export function estimatorSized(t: Harness, taskId: string): () => void {
  const edit = (patch: (a: any) => void) => {
    const proposal = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body));
    for (const a of proposal.allocations) if (a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work") patch(a);
    t.h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(canonicalBytes(proposal).toString("utf8"));
  };
  let original: unknown;
  edit(a => { original = a.fieldProvenance.tokens; a.fieldProvenance.tokens = { provenance: "model", estimateId: "estimate-fixture" }; });
  return () => edit(a => { a.fieldProvenance.tokens = original; });
}

/** The token limit set to none by the owner (a finite-legacy group keeps its mode, commands.ts setGroupLimit). */
export function unlimit(t: Harness, raiseOthers = 1) {
  const g = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  const limit = { tokens: null, activeMs: g.limit.activeMs * raiseOthers, attempts: g.limit.attempts * raiseOthers, sessions: g.limit.sessions * raiseOthers };
  expect(t.service.setLimit(t.h.command("set-limit", { limit: limit as never }))).not.toHaveProperty("error");
}

export const groupBody = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
export const approximateRows = (t: Harness) => t.h.store.db.prepare("SELECT id,principal,client,verb,original_status,body_json FROM commands WHERE verb='settle-approximate-usage' ORDER BY rowid").all();
export const settledActivity = (t: Harness, runId: string) => t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='usage-settled'").all(runId).map(r => JSON.parse(String(r.body)));
export const workLedger = (t: Harness, runId: string) => t.h.store.db.prepare("SELECT tokens FROM usage_ledger WHERE run_id=? AND source='run-work' ORDER BY id").all(runId).map(r => Number(r.tokens));
