/**
 * Issue-fixes spec §6.4: a group's place in the list, from the server's summary only (counts are the server's §6.1
 * categories; nothing here re-derives a task's state). First match wins.
 */
import type { GroupSummaryV1 } from "./controlTypes.js";

export const GROUP_CATEGORIES = ["not-started", "running", "attention", "done", "archived"] as const;
export type GroupCategory = (typeof GROUP_CATEGORIES)[number];
/** The chips, in the order they are shown; All shows every group but the archived ones. */
export const GROUP_FILTERS = ["all", "not-started", "running", "attention", "done", "archived"] as const;
export type GroupFilter = (typeof GROUP_FILTERS)[number];
export const GROUP_FILTER_KEY = "orca.panel.groupFilter";

/** Spec §6.4 rule 2: a blocked task, a recovery blocker, a blocked claim, a blocked group, or a stop still settling. */
export function needsAttention(summary: GroupSummaryV1): boolean {
  return (summary.counts?.blocked ?? 0) > 0 || summary.recoveryBlockerCount > 0 || summary.claimBlocked || summary.state === "blocked"
    || (summary.stopState !== null && summary.stopState !== "handoff-complete");
}

export function groupCategory(summary: GroupSummaryV1): GroupCategory {
  if (summary.archived === true) return "archived";
  if (needsAttention(summary)) return "attention";
  if (summary.completion !== undefined && summary.completion.total > 0 && summary.completion.done === summary.completion.total) return "done";
  if ((summary.counts?.running ?? 0) + (summary.counts?.waiting ?? 0) > 0 || summary.state === "running" || summary.state === "review") return "running";
  return "not-started";
}

export function matchesGroupFilter(summary: GroupSummaryV1, filter: GroupFilter): boolean {
  const category = groupCategory(summary);
  return filter === "all" ? category !== "archived" : category === filter;
}

/** localStorage, or undefined where touching it throws (a private window, blocked site data). */
export function groupFilterStorage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export function readGroupFilter(storage: Pick<Storage, "getItem"> | undefined): GroupFilter {
  try {
    const value = storage?.getItem(GROUP_FILTER_KEY) ?? null;
    return (GROUP_FILTERS as readonly string[]).includes(value ?? "") ? (value as GroupFilter) : "all";
  } catch {
    return "all";
  }
}

export function writeGroupFilter(storage: Pick<Storage, "setItem"> | undefined, filter: GroupFilter): void {
  try {
    storage?.setItem(GROUP_FILTER_KEY, filter);
  } catch {
    // A filter that is not remembered costs one click next time; the list works without it.
  }
}
