/**
 * Flow engine spec §6.3 [BC-B2, IR-C2]: the run budget pool. The parent group is confirmed once, at start, with the
 * pool; each child (and each single call on the parent) draws its allocation from it and returns the unspent part when
 * it settles. No estimate call (P4). When the pool cannot fund the next execution only that run parks, with a needs-you
 * item `flow-pool-exhausted` (raise the pool, human-only, or stop). Code decides every number here (Rule 5).
 */
import type { Amount } from "../control/types.js";
import { TASK_WORK } from "../control/estimator.js";
import type { ControlStore } from "../control/store.js";
import type { FlowStep } from "./template/schema.js";

/** §9.6: an effect-classed step runs once; any other work step keeps today's attempts and sessions. */
export function childWorkAmount(step: FlowStep, tokens: number): Amount {
  const effect = step.kind === "work" && step.effect !== undefined;
  return { ...TASK_WORK, tokens, ...(effect ? { attempts: 1, sessions: 1 } : {}) };
}

/** How much the next execution of `step` asks for: its `budget.tokens`, else an even share of what remains, capped by TASK_WORK. */
export function allocationFor(step: FlowStep, remaining: number, stepsLeft: number): number {
  const wanted = step.budget?.tokens ?? Math.floor(remaining / Math.max(1, stepsLeft));
  return Math.min(wanted, TASK_WORK.tokens);
}

export type Draw = { drawn: number } | { exhausted: { remaining: number; wanted: number } };

/**
 * Draw `wanted` tokens from the run's pool in the caller's transaction; idempotent per `drawId` (a restart that draws
 * again for the same child or call gets the same amount and books nothing twice).
 */
export function drawAllocation(store: ControlStore, flowRunId: string, drawId: string, wanted: number): Draw {
  const row = store.db.prepare("SELECT pool_tokens, pool_drawn, body FROM flow_runs WHERE id=?").get(flowRunId);
  if (row === undefined) throw new Error(`orca: flow run ${flowRunId} not found`);
  const body = JSON.parse(String(row.body)) as { draws?: Record<string, { drawn: number; returned: number | null }> };
  const seen = body.draws?.[drawId];
  if (seen !== undefined) return { drawn: seen.drawn };
  const remaining = Number(row.pool_tokens) - Number(row.pool_drawn);
  if (wanted <= 0 || wanted > remaining) return { exhausted: { remaining, wanted } };
  const draws = { ...(body.draws ?? {}), [drawId]: { drawn: wanted, returned: null } };
  store.db.prepare("UPDATE flow_runs SET pool_drawn=pool_drawn+?, body=? WHERE id=?").run(wanted, JSON.stringify({ ...body, draws }), flowRunId);
  return { drawn: wanted };
}

/** The child (or call) settled having spent `spent`: what it did not spend goes back to the pool, once. */
export function returnUnspent(store: ControlStore, flowRunId: string, drawId: string, spent: number): number {
  const row = store.db.prepare("SELECT body FROM flow_runs WHERE id=?").get(flowRunId);
  if (row === undefined) return 0;
  const body = JSON.parse(String(row.body)) as { draws?: Record<string, { drawn: number; returned: number | null }> };
  const draw = body.draws?.[drawId];
  if (draw === undefined || draw.returned !== null) return 0;
  const back = Math.max(0, draw.drawn - Math.max(0, spent));
  const draws = { ...body.draws, [drawId]: { drawn: draw.drawn, returned: back } };
  store.db.prepare("UPDATE flow_runs SET pool_drawn=pool_drawn-?, body=? WHERE id=?").run(back, JSON.stringify({ ...body, draws }), flowRunId);
  return back;
}

export const POOL_EXHAUSTED = "flow-pool-exhausted";
