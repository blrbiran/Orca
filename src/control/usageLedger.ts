import { z } from "zod";
import type { ControlStore } from "./store.js";
import type { ModelUsage, UsageEvent } from "./types.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Raw usage detail spec 2026-11-13 §3/§8 (tester follow-up J): optional sub-parts and annotations ccloop reports when its
// source does; never addends -- entryTotal and the reconciliation of the four parts are unchanged.
export const modelUsageSchema = z.object({ model: z.string().min(1).max(200), input: count, output: count, cacheRead: count, cacheWrite: count,
  reasoning: count.optional(), cacheWrite5m: count.optional(), cacheWrite1h: count.optional(), requests: count.optional(), maxRequestInput: count.optional() }).strict();
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
/** Raw usage detail spec §8.3: how a non-measured row was booked; measured rows carry none. */
export type UsageBasis = "remaining-grant" | "observed-floor" | "known-zero" | "soft-loop-floor" | "reconcile" | "integration" | "pre-ledger";
/** Spec §3: a reported row's sub-parts (never addends) and the event's per-phase largest request; each null when unknown. */
export interface UsageDetail { reasoning: number | null; cacheWrite5m: number | null; cacheWrite1h: number | null; requests: number | null; maxRequestInput: number | null }
/** Spec §3: where and by whom a row was spent, from Orca's own records. */
export interface UsageAnnotation { phase: string | null; taskId: string | null; agentKind: string | null; installationId: string | null }
type RunFacts = { runId: string; groupId: string; phase?: string; purpose?: string; taskId?: string | null; agent?: { agent?: unknown } };
const noAnnotation: UsageAnnotation = { phase: null, taskId: null, agentKind: null, installationId: null };

/**
 * Spec §3 `phase` and §8.1: a task work event's loop phase as ccloop reports it; a handoff bucket's `handoff`; a single
 * call's purpose (an estimate, clarify, split, or a review); null for anything else (never guessed).
 */
export function ledgerPhase(run: { phase?: string; purpose?: string }, bucket: "work" | "handoff", eventPhase: string | undefined): string | null {
  if (bucket === "handoff") return "handoff";
  if (run.phase === "estimate") return "estimate";
  if (run.phase === "single-call") {
    if (run.purpose === "clarify" || run.purpose === "split") return run.purpose;
    return run.purpose === "requirement-review" || run.purpose === "flow-review" ? "review" : null;
  }
  return eventPhase ?? null;
}

/**
 * Spec §3 annotations from the run's own record: its task and the installation of its frozen selection (`agent.agent`).
 * The frozen selection names no CLI kind, so `agentKind` stays null (spec §3: 有就记录，没有就留空).
 */
function annotationOf(run: RunFacts, bucket: "work" | "handoff", eventPhase?: string): UsageAnnotation {
  const installation = run.agent?.agent;
  return { phase: ledgerPhase(run, bucket, eventPhase), taskId: typeof run.taskId === "string" ? run.taskId : null, agentKind: null,
    installationId: typeof installation === "string" ? installation : null };
}

function insertRow(store: ControlStore, row: { appliedAt: number; groupId: string; repoId: string | null; runId: string | null; source: ReturnType<typeof usageSource>; model: string | null; entry: Omit<ModelUsage, "model"> | null; tokens: number; quality: Quality;
  detail?: UsageDetail | null; annotation: UsageAnnotation; basis: UsageBasis | null }): void {
  const e = row.entry, d = row.detail ?? null, a = row.annotation;
  store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality,reasoning,cache_write_5m,cache_write_1h,requests,max_request_input,phase,task_id,agent_kind,installation_id,basis) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(row.appliedAt, row.groupId, row.repoId, row.runId, row.source, row.model, e?.input ?? null, e?.output ?? null, e?.cacheRead ?? null, e?.cacheWrite ?? null, row.tokens, row.quality,
      d?.reasoning ?? null, d?.cacheWrite5m ?? null, d?.cacheWrite1h ?? null, d?.requests ?? null, d?.maxRequestInput ?? null, a.phase, a.taskId, a.agentKind, a.installationId, row.basis);
}

type SubPart = "reasoning" | "cacheWrite5m" | "cacheWrite1h" | "requests";
const subParts: readonly SubPart[] = ["reasoning", "cacheWrite5m", "cacheWrite1h", "requests"];

/**
 * Spec §8.4: per model, the sub-parts some earlier applied event of this run and bucket left absent -- absent once, absent
 * for the rest of the run, so a later value never yields a partial sum that looks measured.
 */
function absentSubParts(store: ControlStore, runId: string, bucket: "work" | "handoff", beforeSeq: number): Map<string, Set<SubPart>> {
  const absent = new Map<string, Set<SubPart>>();
  for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<?").all(runId, beforeSeq)) {
    const prior = JSON.parse(String(row.body)) as UsageEvent;
    if (prior.bucket !== bucket || prior.cumulative === null || prior.byModel == null) continue;
    for (const entry of prior.byModel) for (const part of subParts) if (entry[part] === undefined) absent.set(entry.model, (absent.get(entry.model) ?? new Set()).add(part));
  }
  return absent;
}

/**
 * Spec §5 / §8.4 / §8.5: one model's detail for a reported delta. A sub-part absent now or before is null; its delta is the
 * cumulative's difference; a value over its bound (reasoning > output, 5m + 1h > cacheWrite, maxRequestInput > input +
 * cacheRead + cacheWrite), in the event or in the delta, is null -- the four parts are never touched. `maxRequestInput`
 * is the event's own per-phase value, never a difference.
 */
function detailOf(now: ModelUsage, before: ModelUsage | undefined, absent: ReadonlySet<SubPart> | undefined, delta: Omit<ModelUsage, "model">): UsageDetail {
  const part = (key: SubPart): number | null => {
    if (now[key] === undefined || absent?.has(key)) return null;
    const value = now[key]! - (before === undefined ? 0 : before[key] ?? Number.NaN);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  let reasoning = part("reasoning"), cacheWrite5m = part("cacheWrite5m"), cacheWrite1h = part("cacheWrite1h");
  if ((now.reasoning ?? 0) > now.output || (reasoning ?? 0) > delta.output) reasoning = null;
  if ((now.cacheWrite5m ?? 0) + (now.cacheWrite1h ?? 0) > now.cacheWrite || (cacheWrite5m ?? 0) + (cacheWrite1h ?? 0) > delta.cacheWrite) { cacheWrite5m = null; cacheWrite1h = null; }
  const maxRequestInput = now.maxRequestInput !== undefined && now.maxRequestInput <= now.input + now.cacheRead + now.cacheWrite ? now.maxRequestInput : null;
  return { reasoning, cacheWrite5m, cacheWrite1h, requests: part("requests"), maxRequestInput };
}

/**
 * Task 7 ruling: a reconciliation's `ccloop run` reports no usage events, so its spend reaches group.used outside
 * recordUsage (driverLanding.ts recordReconcileUsage). Spec §5.1 books every delta added to group.used, so it is booked
 * here, in that write's transaction, as the reconciled run's work: one unattributed row; nothing for 0 (D16).
 * Integration spec §7: an integration conflict's resolution belongs to no run, so its row is booked with `runId` null
 * (the column is nullable).
 */
export function bookReconcileUsage(store: ControlStore, input: { runId: string | null; groupId: string; groupBody: Record<string, unknown>; tokens: number; appliedAt: number; basis: "reconcile" | "integration" }): void {
  if (input.tokens === 0) return;
  insertRow(store, { appliedAt: input.appliedAt, groupId: input.groupId, repoId: groupRepoIdOf(input.groupBody), runId: input.runId, source: "run-work", model: null, entry: null, tokens: input.tokens, quality: "unattributed",
    annotation: noAnnotation, basis: input.basis });
}

/** Accounts spec §5.1: called inside recordUsage's transaction, once per applied event whose cumulative is known. */
export function bookUsageDelta(store: ControlStore, input: { run: RunFacts; groupBody: Record<string, unknown>; event: UsageEvent; deltaTokens: number; appliedAt: number }): void {
  const { run, event, deltaTokens, appliedAt } = input;
  if (deltaTokens === 0 || event.cumulative === null) return; // D16
  const source = usageSource(run, event.bucket), repoId = groupRepoIdOf(input.groupBody), annotation = annotationOf(run, event.bucket, event.phase);
  const insert = (model: string | null, entry: Omit<ModelUsage, "model"> | null, tokens: number, quality: Quality, detail: UsageDetail | null = null) =>
    insertRow(store, { appliedAt, groupId: run.groupId, repoId, runId: run.runId, source, model, entry, tokens, quality, detail, annotation, basis: null });
  const byModel = event.byModel ?? null;
  const base = byModel === null ? null : baseline(store, run.runId, event.bucket, event.eventSeq);
  if (byModel === null || base === null) { insert(null, null, deltaTokens, "unattributed"); return; }
  const deltas = byModel.map((e) => {
    const b = base.get(e.model);
    return { model: e.model, input: e.input - (b?.input ?? 0), output: e.output - (b?.output ?? 0), cacheRead: e.cacheRead - (b?.cacheRead ?? 0), cacheWrite: e.cacheWrite - (b?.cacheWrite ?? 0) };
  });
  const nonNegative = (d: ModelUsage) => d.input >= 0 && d.output >= 0 && d.cacheRead >= 0 && d.cacheWrite >= 0;
  const ok = reconciles(byModel, event.cumulative.tokens) && deltas.every(nonNegative) && [...base.keys()].every((model) => byModel.some((e) => e.model === model));
  if (ok) {
    const absent = absentSubParts(store, run.runId, event.bucket, event.eventSeq);
    deltas.forEach((d, index) => { if (entryTotal(d) > 0) insert(d.model, d, entryTotal(d), "reported", detailOf(byModel[index]!, base.get(d.model), absent.get(d.model), d)); });
    return;
  }
  insert(null, null, deltaTokens, "unattributed"); // D18: the authoritative row
  for (const d of deltas) if (nonNegative(d) && entryTotal(d) > 0) insert(d.model, d, entryTotal(d), "breakdown-mismatch");
}

/** D9: artificial settlement is unattributed usage at the owner's accounting time, never a provider event. */
export function bookSettledUsage(store: ControlStore, input: { run: RunFacts; groupBody: Record<string, unknown>; bucket: "work" | "handoff"; tokens: number; appliedAt: number; basis: UsageBasis }): void {
  if (input.tokens === 0) return;
  insertRow(store, { appliedAt: input.appliedAt, groupId: input.run.groupId, repoId: groupRepoIdOf(input.groupBody), runId: input.run.runId, source: usageSource(input.run, input.bucket), model: null, entry: null, tokens: input.tokens, quality: "unattributed",
    annotation: annotationOf(input.run, input.bucket), basis: input.basis });
}
