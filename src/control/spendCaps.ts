import { ControlError } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";
import { periodBounds, readUsageCalendar } from "./usageCalendar.js";
import { groupRepoIdOf } from "./usageLedger.js";
import { usedTokens, type UsageScope } from "./usageQuery.js";
import { compareText } from "./webProtocol.js";

export type SpendPeriod = "total" | "week" | "month";
/** Accounts spec §6.1: one row of spend_caps. */
export interface SpendCap { scope: UsageScope; period: SpendPeriod; tokens: number; updatedAt: number; updatedBy: string }
/** Spec §6.2: a cap at an instant -- what its period used, what active runs still hold, and what is left. */
export interface CapStatus extends SpendCap { used: number; committed: number; headroom: number; from: number | null; to: number | null }

export function readCaps(store: ControlStore): SpendCap[] {
  return store.db.prepare("SELECT scope,period,tokens,updated_at,updated_by FROM spend_caps ORDER BY scope,period").all().map((row) => ({
    scope: String(row.scope) as UsageScope, period: String(row.period) as SpendPeriod, tokens: Number(row.tokens),
    updatedAt: Number(row.updated_at), updatedBy: String(row.updated_by),
  }));
}

/**
 * D4: tokens already promised to claimed runs -- the remaining work and handoff grant of every active run whose group is
 * in scope. `excludeGroupId` leaves one group's own runs out (the agent ceiling judges a group against the others).
 */
export function committedTokens(store: ControlStore, scope: UsageScope, excludeGroupId: string | null): number {
  const repo = scope === "all" ? null : scope.slice(5);
  let total = 0;
  for (const row of store.db.prepare("SELECT r.group_id AS group_id, r.body AS body, g.body AS gbody FROM runs r JOIN groups g ON g.id=r.group_id WHERE r.active=1").all()) {
    if (excludeGroupId !== null && row.group_id === excludeGroupId) continue;
    if (repo !== null && groupRepoIdOf(JSON.parse(String(row.gbody)) as Record<string, unknown>) !== repo) continue;
    const remaining = (JSON.parse(String(row.body)) as { remaining?: { work?: { tokens?: unknown }; handoff?: { tokens?: unknown } } }).remaining;
    const work = remaining?.work?.tokens, handoff = remaining?.handoff?.tokens;
    // A NaN here would open every gate it reaches, so an unreadable run stops the reading instead.
    if (!Number.isSafeInteger(work) || !Number.isSafeInteger(handoff)) throw new ControlError("recovery-blocked", "run-remaining-invalid");
    total += (work as number) + (handoff as number);
  }
  return total;
}

/**
 * Spec §6.2: every cap that applies to a group of `repoId` (the `all` caps and that repository's), at `at`, the binding
 * one (least headroom) first. `repoId` null: the `all` caps only. Headroom is not clamped.
 */
export function capStatuses(store: ControlStore, repoId: string | null, at: number, excludeGroupId: string | null = null): CapStatus[] {
  const calendar = readUsageCalendar(store);
  const committed = new Map<UsageScope, number>();
  return readCaps(store)
    .filter((cap) => cap.scope === "all" || (repoId !== null && cap.scope === `repo:${repoId}`))
    .map((cap) => {
      const bounds = cap.period === "total" ? { from: null, to: null } : periodBounds(cap.period, at, calendar);
      const used = usedTokens(store, cap.scope, bounds.from, bounds.to);
      if (!committed.has(cap.scope)) committed.set(cap.scope, committedTokens(store, cap.scope, excludeGroupId));
      const held = committed.get(cap.scope)!;
      return { ...cap, used, committed: held, headroom: cap.tokens - used - held, from: bounds.from, to: bounds.to };
    })
    .sort((a, b) => a.headroom - b.headroom || compareText(a.scope, b.scope) || compareText(a.period, b.period));
}

/** Spec §6.3: the binding cap a grant of `grantTokens` does not fit into, or null when it fits (or no cap applies). */
export function spendCapBlocking(store: ControlStore, repoId: string | null, grantTokens: number, at: number, excludeGroupId: string | null = null): CapStatus | null {
  const binding = capStatuses(store, repoId, at, excludeGroupId)[0];
  return binding !== undefined && grantTokens > binding.headroom ? binding : null;
}

/**
 * Spec §6.3.1, D9: called inside the claim's own transaction, so the headroom read and the claim cannot be split by
 * another writer. False = do not claim: the caller leaves its wake pending, and a block is a deferred wake, re-checked on
 * every wake (a raised cap or a new period resumes it without a command). The block is written to spend_cap_blocks (the
 * group's and requirement's `spendCapBlock`), and cleared once a claim fits; a projection change only when the row
 * changes. A grant of 0 claims nothing and never blocks. D19: the legacy scheduler's claimWork (budget.ts, `orca
 * scheduler`) does not call this -- a known gap of this round, not a gated path.
 */
export function gateClaim(store: ControlStore, groupId: string, grantTokens: number, at: number): boolean {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const blocking = grantTokens > 0 ? spendCapBlocking(store, groupRepoIdOf(JSON.parse(String(row.body)) as Record<string, unknown>), grantTokens, at) : null;
  const prior = store.db.prepare("SELECT body FROM spend_cap_blocks WHERE group_id=?").get(groupId);
  if (blocking === null) {
    if (prior) { store.db.prepare("DELETE FROM spend_cap_blocks WHERE group_id=?").run(groupId); recordProjectionChange(store, [groupId]); }
    return true;
  }
  const body = JSON.stringify({ code: "spend-cap-reached", scope: blocking.scope, period: blocking.period, capTokens: blocking.tokens, grantTokens });
  if (!prior || String(prior.body) !== body) {
    store.db.prepare("INSERT INTO spend_cap_blocks(group_id,body) VALUES (?,?) ON CONFLICT(group_id) DO UPDATE SET body=excluded.body").run(groupId, body);
    recordProjectionChange(store, [groupId]);
  }
  return false;
}

/** The block gateClaim recorded for a group (its view's `spendCapBlock`), or null. */
export function readSpendCapBlock(store: ControlStore, groupId: string): unknown {
  const row = store.db.prepare("SELECT body FROM spend_cap_blocks WHERE group_id=?").get(groupId);
  return row ? JSON.parse(String(row.body)) : null;
}

/**
 * D10: an agent's import whose group limit exceeds the binding headroom. Deliberately not a ControlError: thrown inside
 * the command transaction it rolls back and books nothing, and the route answers 403 control-limit-over-cap-headroom.
 */
export class AgentCeilingRefusal extends Error {
  constructor(readonly cap: CapStatus, readonly limitTokens: number) {
    super(`The group limit (${limitTokens} tokens) exceeds the ${cap.scope} ${cap.period} spend cap's headroom (${cap.headroom} tokens).`);
    this.name = "AgentCeilingRefusal";
  }
}
