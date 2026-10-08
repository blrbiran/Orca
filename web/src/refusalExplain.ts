/**
 * Spec 2026-10-08 §2.2(a), (b): what a refusal and a blocked run's reason say in the reader's language. A refused plan's
 * detail is a list (one item per line, src/scheduler/planFile.ts); each item becomes a line a person can act on, and an
 * item this panel has no words for is shown verbatim. Pure apart from reading the current language.
 */
import type { ControlRefusal } from "./controlState.js";
import i18n, { errorEntry, fillEntry, refusalDetail, refusalText } from "./i18n.js";

const PLAN_REJECTED = "control-plan-rejected";
const PLAN_ITEMS = ["target-repo-mismatch", "missing-goal", "missing-success-conditions", "duplicate-success-condition"];
const TASK_ITEMS = ["missing-target-version", "duplicate-dependency", "dangling-dependency", "contract-json", "contract-shape", "contract-canonical"];

/** The current language's planItem entry for a key built at run time, with its placeholders filled. */
function itemLine(key: string, values: Record<string, string> = {}): string {
  return String((i18n.t as (k: string, o?: object) => unknown)(`refusal.planItem.${key}`, values));
}

/** One item of a refused plan as a line (spec §2.2(b)'s table); anything else verbatim. */
export function planItemText(item: string): string {
  if (PLAN_ITEMS.includes(item)) return itemLine(item);
  const cut = item.indexOf(":");
  if (cut <= 0) return item;
  const kind = item.slice(0, cut);
  const rest = item.slice(cut + 1);
  if (TASK_ITEMS.includes(kind)) return itemLine(kind, { task: rest });
  const split = rest.indexOf(": ");
  if (kind === "malformed" && split > 0) return itemLine(kind, { path: rest.slice(0, split), msg: rest.slice(split + 2) });
  return item;
}

/** A refusal's explanation, and for a refused plan its problems one per line (empty for every other refusal). */
export function explainRefusal(refusal: ControlRefusal): { text: string; items: string[] } {
  const detail = refusal.code === PLAN_REJECTED ? refusalDetail(refusal) : "";
  if (detail === "") return { text: refusalText(refusal), items: [] };
  return { text: i18n.t("refusal.planRejected"), items: detail.split("\n").map(planItemText) };
}

/** A blocked run's reason explained by its prefix up to the first ':' (the rest is its detail); null when there are no words for it. */
export function explainRunReason(reason: string): string | null {
  const cut = reason.indexOf(":");
  const entry = errorEntry(cut === -1 ? reason : reason.slice(0, cut));
  return entry === undefined ? null : fillEntry(entry, { message: reason, status: "", detail: cut === -1 ? "" : reason.slice(cut + 1) });
}
