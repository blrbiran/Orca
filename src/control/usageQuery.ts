import { idSchema } from "./schema.js";
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
  if (from !== null && to !== null) { where.push("applied_at>=? AND applied_at<?"); args.push(from, to); }
  const row = store.db.prepare(`SELECT COALESCE(SUM(tokens),0) AS n FROM usage_ledger WHERE ${where.join(" AND ")}`).get(...args);
  return Number(row!.n);
}

interface Entry { model: string | null; input: number; output: number; cacheRead: number; cacheWrite: number; tokens: number }

export function readUsageView(store: ControlStore, query: UsageQuery, now: number): UsageViewV1 {
  const calendar = readUsageCalendar(store);
  const repo = repoOf(query.scope);
  const week = periodBounds("week", now, calendar), month = periodBounds("month", now, calendar);
  const where = ["1=1"], args: Array<string | number> = [];
  if (repo !== null) { where.push("repo_id=?"); args.push(repo); }
  if (query.from !== null) { where.push("applied_at>=?"); args.push(query.from); }
  if (query.to !== null) { where.push("applied_at<?"); args.push(query.to); }
  const rows = store.db.prepare(`SELECT model,input,output,cache_read,cache_write,tokens,quality,repo_id,applied_at FROM usage_ledger WHERE ${where.join(" AND ")}`).all(...args);

  const reported = new Map<string, Entry>();
  const unattributed: Entry = { model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
  const groups = new Map<string, number>();
  let tokens = 0, unattributedRows = 0, breakdownMismatchRows = 0;
  for (const row of rows) {
    if (row.quality === "breakdown-mismatch") { breakdownMismatchRows += 1; continue; }
    const n = Number(row.tokens);
    tokens += n;
    let modelKey: string;
    if (row.quality === "reported") {
      modelKey = String(row.model);
      const entry = reported.get(modelKey) ?? { model: modelKey, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
      entry.input += Number(row.input); entry.output += Number(row.output); entry.cacheRead += Number(row.cache_read); entry.cacheWrite += Number(row.cache_write); entry.tokens += n;
      reported.set(modelKey, entry);
    } else {
      unattributedRows += 1; unattributed.tokens += n;
      modelKey = "unattributed";
    }
    const key = query.groupBy === "model" ? modelKey
      : query.groupBy === "repo" ? (row.repo_id === null ? "unknown" : String(row.repo_id))
        : new Date(periodBounds(query.groupBy, Number(row.applied_at), calendar).from).toISOString();
    groups.set(key, (groups.get(key) ?? 0) + n);
  }
  const byModel = [...reported.values()].sort((a, b) => compareText(a.model!, b.model!));
  if (unattributedRows > 0) byModel.push(unattributed);

  let unknownUsageRuns = 0;
  for (const run of store.db.prepare("SELECT runs.body AS run, groups.body AS grp FROM runs JOIN groups ON groups.id=runs.group_id").all()) {
    if (repo !== null && groupRepoIdOf(JSON.parse(String(run.grp)) as Record<string, unknown>) !== repo) continue;
    const unknown = (JSON.parse(String(run.run)) as { unknown?: { work?: boolean; handoff?: boolean } }).unknown;
    if (unknown?.work || unknown?.handoff) unknownUsageRuns += 1;
  }
  const revision = store.db.prepare("SELECT revision FROM spend_settings WHERE singleton=1").get();
  return {
    schema: "orca-usage-view-v1", scope: query.scope, from: query.from, to: query.to, now, calendar,
    spendRevision: revision ? Number(revision.revision) : 0,
    headline: { total: usedTokens(store, query.scope, null, null), week: usedTokens(store, query.scope, week.from, week.to), month: usedTokens(store, query.scope, month.from, month.to) },
    range: { tokens, byModel, groups: [...groups].map(([key, n]) => ({ key, tokens: n })).sort((a, b) => compareText(a.key, b.key)) },
    counts: { unattributedRows, breakdownMismatchRows, unknownUsageRuns },
    caps: [],
  };
}
