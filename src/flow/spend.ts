/**
 * Gaps spec §10 (G9): spend, the tool's numbers only (P7, Rule 14). Computed at read time from the `runs` rows the
 * driver keeps; nothing new is stored but the run ids each call request left on its execution, plan or intake.
 *
 * - A single call's tokens are its run's `cumulative.work.tokens`; a child group's are the sum over its `work` runs
 *   (childPort.ts `childRuns`).
 * - A run whose usage the tool did not report (`unknown.work`), or reported as `0`, is unknown: `null`, never 0.
 * - A sum over a mix shows the known part and "partial: n runs unknown". A sum over no runs at all is unknown too:
 *   nothing the tool gave (a step that ran no model, or a call not yet claimed).
 * - No tool reports a money amount: `usd` is always null with the fixed reason. Allocations, pool draws and budgets are
 *   never spend.
 */
import type { ControlStore } from "../control/store.js";
import { childRuns } from "./childPort.js";
import type { ExecutionRow, PlanRow, IntakeRow } from "./store.js";

export const USD_REASON = "the tool reports no money amount" as const;
export interface SpendRun { runId: string; purpose: string; tokens: number | null }
export interface Spend { tokens: number | null; unknownReason: string | null; usd: null; usdReason: typeof USD_REASON; runs: SpendRun[] }
/** What a call request leaves behind (calls.ts, at claim): the driver run that answers it. */
export interface CallRef { runId: string; purpose: string }

type RunUsage = { cumulative?: { work?: { tokens?: unknown } }; unknown?: { work?: unknown } };

const spend = (tokens: number | null, unknownReason: string | null, runs: SpendRun[]): Spend => ({ tokens, unknownReason, usd: null, usdReason: USD_REASON, runs });

/** One run's tokens as the tool gave them, or why there is no number. */
function usageOf(body: RunUsage | null): { tokens: number | null; reason: string | null } {
  if (body === null) return { tokens: null, reason: "no run record" };
  if (body.unknown?.work === true) return { tokens: null, reason: "the tool reported no usage" };
  const tokens = body.cumulative?.work?.tokens;
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) return { tokens: null, reason: "the tool reported no usage" };
  // goal.md P7: a tool-given 0 means the tool did not count, not that nothing was spent.
  if (tokens <= 0) return { tokens: null, reason: "the tool reported 0 tokens" };
  return { tokens, reason: null };
}

function runSpend(runId: string, purpose: string, body: RunUsage | null): Spend {
  const usage = usageOf(body);
  return spend(usage.tokens, usage.reason, [{ runId, purpose, tokens: usage.tokens }]);
}

/** The known runs added; any unknown run makes the sum partial; all unknown is null with their reason. */
export function sumSpend(parts: readonly Spend[]): Spend {
  const runs = parts.flatMap((p) => p.runs);
  if (runs.length === 0) return spend(null, "no tool runs", []);
  const known = runs.filter((r) => r.tokens !== null);
  const unknown = runs.length - known.length;
  const total = known.reduce((sum, r) => sum + r.tokens!, 0);
  if (unknown === 0) return spend(total, null, runs);
  if (known.length > 0) return spend(total, `partial: ${unknown} runs unknown`, runs);
  const reasons = new Set(parts.filter((p) => p.runs.length > 0).map((p) => p.unknownReason));
  return spend(null, reasons.size === 1 ? [...reasons][0]! : `${unknown} runs unknown`, runs);
}

function runBody(store: ControlStore, runId: string): RunUsage | null {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  return row === undefined ? null : JSON.parse(String(row.body)) as RunUsage;
}

/** The spend of a list of call refs (an execution's, a plan's or an intake's single calls). */
export function callsSpend(store: ControlStore, calls: readonly CallRef[]): Spend {
  return sumSpend(calls.map((c) => runSpend(c.runId, c.purpose, runBody(store, c.runId))));
}

/** A child group's spend: the sum over its driver runs (as childPort.ts sums them for the pool). */
export function childGroupSpend(store: ControlStore, childGroupId: string): Spend {
  return sumSpend(childRuns(store, childGroupId).map((r) => runSpend(r.runId, "work", r as RunUsage)));
}

const refsOf = (calls: unknown): CallRef[] => Array.isArray(calls)
  ? calls.filter((c): c is CallRef => typeof c === "object" && c !== null && typeof (c as CallRef).runId === "string" && typeof (c as CallRef).purpose === "string")
  : [];

export function executionSpend(store: ControlStore, execution: ExecutionRow): Spend {
  const calls = callsSpend(store, refsOf((execution.body as { calls?: unknown }).calls));
  return execution.childGroupId === null ? calls : sumSpend([calls, childGroupSpend(store, execution.childGroupId)]);
}

export const planSpend = (store: ControlStore, plan: PlanRow): Spend => callsSpend(store, refsOf((plan.proposal as { calls?: unknown } | null)?.calls));

export const intakeSpend = (store: ControlStore, intake: IntakeRow): Spend => callsSpend(store, refsOf(intake.body.calls));
