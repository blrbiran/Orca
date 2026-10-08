import { ControlError } from "./errors.js";

/** Issue-fixes spec §6.1: the five display categories, in the table's order. */
export const WORK_ITEM_CATEGORIES = ["idle", "running", "waiting", "blocked", "done"] as const;
export type WorkItemCategory = (typeof WORK_ITEM_CATEGORIES)[number];

/** Stored `running` and the view's `active` are the same state; the rest are the stored claim states. */
const RUNNING = new Set(["running", "active", "continuing", "starting", "start-unknown"]);

/**
 * Issue-fixes spec §6.1, the one mapping from a work item to its display category (the summary counts and the view's
 * `category` both call it, so the web never re-derives it). `done` is decided first: a finished task is finished whatever
 * its last run says. A held item waits for a person to continue it, so it is `blocked` like a blocked run (review I6).
 */
export function workItemCategory(input: { status: string; currentRunBlocked: boolean; dependenciesDone: boolean }): WorkItemCategory {
  const { status } = input;
  if (status === "done" || status === "completed") return "done";
  if (status === "blocked" || status === "held" || input.currentRunBlocked) return "blocked";
  if (RUNNING.has(status)) return "running";
  if (status === "ready") return input.dependenciesDone ? "idle" : "waiting";
  if (status === "draft") return "idle";
  throw new ControlError("recovery-blocked", `work-item-category:${status}`);
}
