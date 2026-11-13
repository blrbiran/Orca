import { idSchema } from "./schema.js";
import { spendRevision } from "./commandLedger.js";
import { capStatuses } from "./spendCaps.js";
import type { ControlStore } from "./store.js";
import { groupRepoIdOf } from "./usageLedger.js";
import { periodBounds, readUsageCalendar } from "./usageCalendar.js";
import { compareText, type UsageViewV1 } from "./webProtocol.js";

export type UsageScope = "all" | `repo:${string}`;
export type UsageGroupBy = "model" | "repo" | "day" | "week" | "month";
export interface UsageQuery { scope: UsageScope; from: number | null; to: number | null; groupBy: UsageGroupBy }

export function parseUsageScope(text: string): UsageScope | null {
  if (text === "all") return "all";
  if (!text.startsWith("repo:")) return null;
  return idSchema.safeParse(text.slice(5)).success ? (text as UsageScope) : null;
}

const repoOf = (scope: UsageScope): string | null => (scope === "all" ? null : scope.slice(5));

/** Spec §5.1: the tokens a total or a cap counts. A `breakdown-mismatch` row repeats its authoritative `unattributed` row, so it never adds. */
export function usedTokens(store: ControlStore, scope: UsageScope, from: number | null, to: number | null): number {
  const repo = repoOf(scope);
  const where = ["quality<>'breakdown-mismatch'"], args: Array<string | number> = [];
  if (repo !== null) { where.push("repo_id=?"); args.push(repo); }
  if (from !== null) { where.push("applied_at>=?"); args.push(from); }
  if (to !== null) { where.push("applied_at<?"); args.push(to); }
  const row = store.db.prepare(`SELECT COALESCE(SUM(tokens),0) AS n FROM usage_ledger WHERE ${where.join(" AND ")}`).get(...args);
  return Number(row!.n);
}

interface Entry { model: string | null; input: number; output: number; cacheRead: number; cacheWrite: number; tokens: number }
/** Raw usage detail spec §3: a sum's sub-parts and largest request; null as soon as one row it covers does not know it. */
export interface DetailSums { reasoning: number | null; cacheWrite5m: number | null; cacheWrite1h: number | null; requests: number | null; maxRequestInput: number | null }
const detailColumns = [["reasoning", "reasoning"], ["cacheWrite5m", "cache_write_5m"], ["cacheWrite1h", "cache_write_1h"], ["requests", "requests"]] as const;
export const noDetail = (): DetailSums => ({ reasoning: null, cacheWrite5m: null, cacheWrite1h: null, requests: null, maxRequestInput: null });
const firstDetail = (row: Record<string, unknown>): DetailSums => ({
  reasoning: nullable(row.reasoning), cacheWrite5m: nullable(row.cache_write_5m), cacheWrite1h: nullable(row.cache_write_1h),
  requests: nullable(row.requests), maxRequestInput: nullable(row.max_request_input),
});
const nullable = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
/** Adds one reported ledger row's detail to a running sum (spec §2 anti-goal: a partial sum is null, never shown as measured). */
export function addDetail(sum: DetailSums | null, row: Record<string, unknown>): DetailSums {
  if (sum === null) return firstDetail(row);
  const next = { ...sum };
  for (const [key, column] of detailColumns) next[key] = sum[key] === null || row[column] === null ? null : sum[key]! + Number(row[column]);
  next.maxRequestInput = sum.maxRequestInput === null || row.max_request_input === null ? null : Math.max(sum.maxRequestInput, Number(row.max_request_input));
  return next;
}

export function readUsageView(store: ControlStore, query: UsageQuery, now: number): UsageViewV1 {
  const calendar = readUsageCalendar(store);
  const repo = repoOf(query.scope);
  const week = periodBounds("week", now, calendar), month = periodBounds("month", now, calendar);
  // Spec §5.1: a pre-ledger row counts in totals and in no period, so it is never part of a range.
  const where = ["source<>'pre-ledger'"], args: Array<string | number> = [];
  if (repo !== null) { where.push("repo_id=?"); args.push(repo); }
  if (query.from !== null) { where.push("applied_at>=?"); args.push(query.from); }
  if (query.to !== null) { where.push("applied_at<?"); args.push(query.to); }
  const rows = store.db.prepare(`SELECT model,input,output,cache_read,cache_write,tokens,quality,repo_id,applied_at,reasoning,cache_write_5m,cache_write_1h,requests,max_request_input,phase FROM usage_ledger WHERE ${where.join(" AND ")} ORDER BY id`).all(...args);

  const reported = new Map<string, Entry & { detail: DetailSums | null }>();
  const unattributed: Entry = { model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
  // Spec §3 `phase`: the same split per model and phase (the unattributed bucket per phase, model null); key = JSON pair.
  const byModelPhase = new Map<string, Entry & { phase: string | null; detail: DetailSums | null; reported: boolean }>();
  // The key is null for the unattributed bucket (groupBy=model), never a string: a model may be named "unattributed".
  const groups = new Map<string | null, number>();
  let tokens = 0, unattributedRows = 0, breakdownMismatchRows = 0;
  for (const row of rows) {
    if (row.quality === "breakdown-mismatch") { breakdownMismatchRows += 1; continue; }
    const n = Number(row.tokens);
    tokens += n;
    let modelKey: string | null;
    const isReported = row.quality === "reported", phase = row.phase === null ? null : String(row.phase);
    const pairKey = JSON.stringify([isReported ? String(row.model) : null, phase]);
    const pair = byModelPhase.get(pairKey) ?? { model: isReported ? String(row.model) : null, phase, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, detail: null, reported: isReported };
    pair.tokens += n;
    if (isReported) {
      modelKey = String(row.model);
      const entry = reported.get(modelKey) ?? { model: modelKey, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, detail: null };
      for (const target of [entry, pair]) {
        target.input += Number(row.input); target.output += Number(row.output); target.cacheRead += Number(row.cache_read); target.cacheWrite += Number(row.cache_write);
        target.detail = addDetail(target.detail, row);
      }
      entry.tokens += n;
      reported.set(modelKey, entry);
    } else {
      unattributedRows += 1; unattributed.tokens += n;
      modelKey = null;
    }
    byModelPhase.set(pairKey, pair);
    const key = query.groupBy === "model" ? modelKey
      : query.groupBy === "repo" ? (row.repo_id === null ? "unknown" : String(row.repo_id))
        : new Date(periodBounds(query.groupBy, Number(row.applied_at), calendar).from).toISOString();
    groups.set(key, (groups.get(key) ?? 0) + n);
  }
  const withDetail = <T extends Entry & { detail: DetailSums | null }>({ detail, ...entry }: T) => ({ ...entry, ...(detail ?? noDetail()) });
  const byModel = [...reported.values()].sort((a, b) => compareText(a.model!, b.model!)).map(withDetail);
  if (unattributedRows > 0) byModel.push({ ...unattributed, ...noDetail() });
  // Reported models by name, then the unattributed bucket; within each, phases by name, the unknown phase last.
  const byPhase = [...byModelPhase.values()].sort((a, b) => (a.reported !== b.reported ? (a.reported ? -1 : 1) : a.model !== b.model ? compareText(a.model!, b.model!)
    : a.phase === b.phase ? 0 : a.phase === null ? 1 : b.phase === null ? -1 : compareText(a.phase, b.phase))).map(({ reported: _reported, ...entry }) => withDetail(entry));

  let unknownUsageRuns = 0;
  for (const run of store.db.prepare("SELECT runs.body AS run, groups.body AS grp FROM runs JOIN groups ON groups.id=runs.group_id").all()) {
    if (repo !== null && groupRepoIdOf(JSON.parse(String(run.grp)) as Record<string, unknown>) !== repo) continue;
    const unknown = (JSON.parse(String(run.run)) as { unknown?: { work?: boolean; handoff?: boolean } }).unknown;
    if (unknown?.work || unknown?.handoff) unknownUsageRuns += 1;
  }
  return {
    schema: "orca-usage-view-v1", scope: query.scope, from: query.from, to: query.to, now, calendar,
    spendRevision: spendRevision(store),
    headline: { total: usedTokens(store, query.scope, null, null), week: usedTokens(store, query.scope, week.from, week.to), month: usedTokens(store, query.scope, month.from, month.to) },
    range: { tokens, byModel, byModelPhase: byPhase, groups: [...groups].map(([key, n]) => ({ key, tokens: n })).sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : compareText(a.key, b.key))) },
    counts: { unattributedRows, breakdownMismatchRows, unknownUsageRuns },
    // Spec §6.2: the caps that apply to this scope -- `all` reads the overall caps, a repository also its own.
    caps: capStatuses(store, repo, now),
  };
}

/** Raw usage detail spec §3: one (model, phase) line of a run's booked usage; model null is the unattributed bucket (parts null). */
export interface UsageDetailLine extends DetailSums {
  model: string | null; phase: string | null; tokens: number;
  input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null;
}

/**
 * Spec §2 "readable": a run's booked usage per model and phase, from its ledger rows as they were booked (so while it is
 * under way too). A `breakdown-mismatch` row repeats its authoritative unattributed row and is left out, as in totals.
 */
export function runUsageDetail(store: ControlStore, runId: string): UsageDetailLine[] {
  const lines = new Map<string, UsageDetailLine & { detail: DetailSums | null }>();
  for (const row of store.db.prepare("SELECT * FROM usage_ledger WHERE run_id=? AND quality<>'breakdown-mismatch' ORDER BY id").all(runId)) {
    const reported = row.quality === "reported", model = reported ? String(row.model) : null, phase = row.phase === null ? null : String(row.phase);
    const key = JSON.stringify([model, phase]);
    const line = lines.get(key) ?? { model, phase, tokens: 0, input: reported ? 0 : null, output: reported ? 0 : null, cacheRead: reported ? 0 : null, cacheWrite: reported ? 0 : null, ...noDetail(), detail: null };
    line.tokens += Number(row.tokens);
    if (reported) {
      line.input! += Number(row.input); line.output! += Number(row.output); line.cacheRead! += Number(row.cache_read); line.cacheWrite! += Number(row.cache_write);
      line.detail = addDetail(line.detail, row);
    }
    lines.set(key, line);
  }
  return [...lines.values()].map(({ detail, ...line }) => ({ ...line, ...(detail ?? noDetail()) }));
}
