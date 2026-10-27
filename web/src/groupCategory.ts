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

/**
 * Spec §6.4 rule 2: a blocked task, a recovery blocker, a blocked claim, a blocked group, or a stop still settling.
 * Kanban spec 2026-10-20 §3.1: also an automatic start refused again and again (needs-you for this group only).
 */
export function needsAttention(summary: GroupSummaryV1): boolean {
  // System debug task spec 2026-10-21 §3.5: a blocked task the escalation ladder is still working on is Orca's, not yours.
  const escalating = (summary.escalation ?? []).filter((entry) => entry.state !== "exhausted").length;
  return (summary.counts?.blocked ?? 0) - escalating > 0 || summary.recoveryBlockerCount > 0 || summary.claimBlocked || summary.state === "blocked"
    || (summary.stopState != null && summary.stopState !== "handoff-complete")
    || summary.orchestration?.refusal?.persistent === true;
}

export function groupCategory(summary: GroupSummaryV1): GroupCategory {
  if (summary.archived === true) return "archived";
  if (needsAttention(summary)) return "attention";
  if (summary.completion !== undefined && summary.completion.total > 0 && summary.completion.done === summary.completion.total) return "done";
  if ((summary.counts?.running ?? 0) + (summary.counts?.waiting ?? 0) > 0 || summary.state === "running" || summary.state === "review") return "running";
  return "not-started";
}

/**
 * Ruling H8 (2026-10-27, session 7753e97d): the status light on a group's card, from its board column. Needs-you is red
 * (failed or blocked), a group with a run going is green, one started or queued with none going is amber (waiting), and
 * anything not yet started or already settled -- clarifying, awaiting confirmation, done, archived -- is dim. The card's
 * text already states the state; the light only lets a person scan a column for the ones moving or stuck.
 */
export type GroupLed = "running" | "failed" | "waiting" | "idle";
export function groupLed(summary: GroupSummaryV1): GroupLed {
  const column = boardColumn(summary);
  if (column === "needs-you") return "failed";
  if (column === "running") return (summary.counts?.running ?? (summary.state === "running" ? 1 : 0)) > 0 ? "running" : "waiting";
  return column === "queued" ? "waiting" : "idle";
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

/**
 * Kanban spec 2026-10-20 §4 (correction §9a: the list's five categories stay; the board extends them to seven columns).
 * A group's column on the board, from the server's summary only. First match wins: archived, then anything that needs a
 * person, then the life cycle. A confirmed group not yet started (held, queued, waiting for a slot or a prerequisite)
 * is `queued`; a ready group with no orchestration record (confirmed before start-on-confirm) is queued until anything ran.
 */
export const BOARD_COLUMNS = ["clarifying", "awaiting-confirmation", "queued", "running", "needs-you", "done", "archived"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export function boardColumn(summary: GroupSummaryV1): BoardColumn {
  if (summary.archived === true) return "archived";
  if (needsAttention(summary)) return "needs-you";
  if (summary.state === "clarifying") return "clarifying";
  if (summary.state === "done" || (summary.completion !== undefined && summary.completion.total > 0 && summary.completion.done === summary.completion.total)) return "done";
  if (summary.state === "draft") return "awaiting-confirmation";
  if (summary.state === "ready" && summary.executionPending !== true) {
    const orchestration = summary.orchestration;
    if (orchestration !== undefined ? orchestration.state !== "started" && orchestration.state !== "stopped"
      : (summary.counts?.running ?? 0) + (summary.counts?.waiting ?? 0) + (summary.counts?.done ?? 0) === 0) return "queued";
  }
  return "running";
}

/**
 * Spec §4: a drag is weak by design -- each allowed drop is exactly one existing command, everything else is refused on
 * the page (the card snaps back with the reason). Builder's call (spec §11): pause is a running card dropped on
 * `queued`; resume is a paused card dropped on `running`; done → archived archives, archived → done unarchives.
 */
export type BoardDrop = { verb: "pause-dispatch" | "resume-dispatch" | "archive-group" | "unarchive-group" } | { refused: "same" | "not-allowed" };
export function boardDrop(summary: GroupSummaryV1, to: BoardColumn): BoardDrop {
  const from = boardColumn(summary);
  if (from === to) return { refused: "same" };
  if (from === "running" && to === "queued" && summary.stopState === null) return { verb: "pause-dispatch" };
  if (summary.stopState === "paused" && to === "running") return { verb: "resume-dispatch" };
  if (from === "done" && to === "archived") return { verb: "archive-group" };
  if (from === "archived" && to === "done") return { verb: "unarchive-group" };
  return { refused: "not-allowed" };
}
