import { z } from "zod";
import type { ControlStore } from "./store.js";
import type { ModelUsage, UsageEvent } from "./types.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const modelUsageSchema = z.object({ model: z.string().min(1).max(200), input: count, output: count, cacheRead: count, cacheWrite: count }).strict();
// ccloop's own schema (orca/usage-by-model, B1/B2 rulings): non-empty -- absent is the one way to say "unknown" -- and
// strictly ascending by `model` in JS code-unit order (`<`, never localeCompare), so both sides agree on every name.
export const byModelSchema = z.array(modelUsageSchema).min(1).refine((entries) => entries.every((entry, index) => index === 0 || entries[index - 1]!.model < entry.model), "byModel must be sorted by model, without repeats");

/** D7: one adapter-neutral total -- `input` is non-cached input, so claude's and codex's own normalizations both reconcile. */
export const entryTotal = (e: ModelUsage): number => e.input + e.output + e.cacheRead + e.cacheWrite;
export const reconciles = (byModel: readonly ModelUsage[], tokens: number): boolean => byModel.reduce((sum, e) => sum + entryTotal(e), 0) === tokens;

/** D15: single calls reach the ledger through the same usage events; the run's phase and purpose name the source. */
export function usageSource(run: { phase?: string; purpose?: string }, bucket: "work" | "handoff") {
  if (run.phase === "estimate") return "estimate" as const;
  if (run.phase === "single-call" && (run.purpose === "clarify" || run.purpose === "split")) return run.purpose;
  return bucket === "work" ? "run-work" as const : "run-handoff" as const;
}

/** A group's repository: the first of plan.repoId, requirement.repoId, projectKey that is a non-empty string; schema7To8PreLedger picks the same. */
export function groupRepoIdOf(body: Record<string, unknown>): string | null {
  const pick = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  return pick((body.plan as { repoId?: unknown } | undefined)?.repoId) ?? pick((body.requirement as { repoId?: unknown } | undefined)?.repoId) ?? pick(body.projectKey);
}

/**
 * The breakdown the previous applied event of this run and bucket left: a map when it is known and reconciled, null when
 * not. A prior event without a breakdown leaves the baseline unknown (ccloop: once absent, absent for the rest of the run),
 * unless it had spent nothing yet.
 */
function baseline(store: ControlStore, runId: string, bucket: "work" | "handoff", beforeSeq: number): Map<string, ModelUsage> | null {
  for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<? ORDER BY seq DESC").all(runId, beforeSeq)) {
    const prior = JSON.parse(String(row.body)) as UsageEvent;
    if (prior.bucket !== bucket || prior.cumulative === null) continue;
    if (prior.byModel == null) return prior.cumulative.tokens === 0 ? new Map() : null;
    return reconciles(prior.byModel, prior.cumulative.tokens) ? new Map(prior.byModel.map((entry) => [entry.model, entry])) : null;
  }
  return new Map();
}

type Quality = "reported" | "unattributed" | "breakdown-mismatch";
function insertRow(store: ControlStore, row: { appliedAt: number; groupId: string; repoId: string | null; runId: string; source: ReturnType<typeof usageSource>; model: string | null; entry: Omit<ModelUsage, "model"> | null; tokens: number; quality: Quality }): void {
  const e = row.entry;
  store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(row.appliedAt, row.groupId, row.repoId, row.runId, row.source, row.model, e?.input ?? null, e?.output ?? null, e?.cacheRead ?? null, e?.cacheWrite ?? null, row.tokens, row.quality);
}

/**
 * Task 7 ruling: a reconciliation's `ccloop run` reports no usage events, so its spend reaches group.used outside
 * recordUsage (driverLanding.ts recordReconcileUsage). Spec §5.1 books every delta added to group.used, so it is booked
 * here, in that write's transaction, as the reconciled run's work: one unattributed row; nothing for 0 (D16).
 */
export function bookReconcileUsage(store: ControlStore, input: { runId: string; groupId: string; groupBody: Record<string, unknown>; tokens: number; appliedAt: number }): void {
  if (input.tokens === 0) return;
  insertRow(store, { appliedAt: input.appliedAt, groupId: input.groupId, repoId: groupRepoIdOf(input.groupBody), runId: input.runId, source: "run-work", model: null, entry: null, tokens: input.tokens, quality: "unattributed" });
}

/** Accounts spec §5.1: called inside recordUsage's transaction, once per applied event whose cumulative is known. */
export function bookUsageDelta(store: ControlStore, input: { run: { runId: string; groupId: string; phase?: string; purpose?: string }; groupBody: Record<string, unknown>; event: UsageEvent; deltaTokens: number; appliedAt: number }): void {
  const { run, event, deltaTokens, appliedAt } = input;
  if (deltaTokens === 0 || event.cumulative === null) return; // D16
  const source = usageSource(run, event.bucket), repoId = groupRepoIdOf(input.groupBody);
  const insert = (model: string | null, entry: Omit<ModelUsage, "model"> | null, tokens: number, quality: Quality) =>
    insertRow(store, { appliedAt, groupId: run.groupId, repoId, runId: run.runId, source, model, entry, tokens, quality });
  const byModel = event.byModel ?? null;
  const base = byModel === null ? null : baseline(store, run.runId, event.bucket, event.eventSeq);
  if (byModel === null || base === null) { insert(null, null, deltaTokens, "unattributed"); return; }
  const deltas = byModel.map((e) => {
    const b = base.get(e.model);
    return { model: e.model, input: e.input - (b?.input ?? 0), output: e.output - (b?.output ?? 0), cacheRead: e.cacheRead - (b?.cacheRead ?? 0), cacheWrite: e.cacheWrite - (b?.cacheWrite ?? 0) };
  });
  const nonNegative = (d: ModelUsage) => d.input >= 0 && d.output >= 0 && d.cacheRead >= 0 && d.cacheWrite >= 0;
  const ok = reconciles(byModel, event.cumulative.tokens) && deltas.every(nonNegative) && [...base.keys()].every((model) => byModel.some((e) => e.model === model));
  if (ok) { for (const d of deltas) if (entryTotal(d) > 0) insert(d.model, d, entryTotal(d), "reported"); return; }
  insert(null, null, deltaTokens, "unattributed"); // D18: the authoritative row
  for (const d of deltas) if (nonNegative(d) && entryTotal(d) > 0) insert(d.model, d, entryTotal(d), "breakdown-mismatch");
}
