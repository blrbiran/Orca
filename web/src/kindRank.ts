/**
 * Human ruling (session f8281a60, 2026-09-27). Every decision kind is high-tier
 * (src/metrics/highTier.ts), so this is a finer, UI-only importance: how hard a wrong
 * call is to undo. Keyed by DecisionKind, so a new kind without a rank is a compile
 * error -- the same lever KIND_TIER uses.
 */
import type { DecisionKind } from "./types.js";

export type KindLevel = 1 | 2 | 3;

export const KIND_RANK: Record<DecisionKind, { order: number; level: KindLevel }> = {
  reconcile: { order: 0, level: 1 },
  abandon: { order: 1, level: 1 },
  interface: { order: 2, level: 2 },
  dependency: { order: 3, level: 2 },
  boundary: { order: 4, level: 2 },
  criteria: { order: 5, level: 3 },
  scheduling: { order: 6, level: 3 },
};

// A native <option> ignores CSS colour on macOS, so the level travels as text.
const MARK: Record<KindLevel, string> = { 1: "🔴", 2: "🟠", 3: "🟡" };

const rankOf = (kind: string): { order: number; level: KindLevel } | undefined =>
  Object.prototype.hasOwnProperty.call(KIND_RANK, kind) ? KIND_RANK[kind as DecisionKind] : undefined;

export const kindLevel = (kind: string): KindLevel | undefined => rankOf(kind)?.level;

export const kindLabel = (kind: string): string => {
  const rank = rankOf(kind);
  return rank ? `${MARK[rank.level]} ${kind}` : kind;
};

/** Most important first; a value this file does not know goes last, alphabetically. */
export function sortKinds(kinds: readonly string[]): string[] {
  const key = (k: string): number => rankOf(k)?.order ?? Number.MAX_SAFE_INTEGER;
  return [...kinds].sort((a, b) => key(a) - key(b) || a.localeCompare(b));
}
