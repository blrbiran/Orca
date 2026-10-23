import type { JSX } from "react";
import type { GroupSummaryV1 } from "./controlTypes.js";

/** Task 10a: past this many characters a goal is cut for a card (the CSS clamp then holds it to two lines). */
export const CARD_SUMMARY_MAX = 120;
const SENTENCE_END = /[。！？]|[.!?](?=\s|$)/gu;

/**
 * Task 10a (human request, session 0e13a9b7), changed after the Task 11 acceptance (session ffec7b28: a 1,175-character
 * goal showed only its 30-character first sentence): what a card shows of a goal -- its non-empty lines joined by a
 * space; past CARD_SUMMARY_MAX characters it ends at the last sentence end within them when that keeps at least half,
 * else it is cut there, and either way an ellipsis says more was cut.
 */
export function goalSummary(goal: string): string {
  const text = goal.split(/\r?\n/).map((part) => part.trim()).filter((part) => part.length > 0).join(" ");
  const chars = Array.from(text);
  if (chars.length <= CARD_SUMMARY_MAX) return text;
  const head = chars.slice(0, CARD_SUMMARY_MAX).join("");
  let end = -1;
  for (const match of head.matchAll(SENTENCE_END)) end = match.index + match[0].length;
  const kept = end !== -1 && Array.from(head.slice(0, end)).length >= CARD_SUMMARY_MAX / 2 ? head.slice(0, end) : head;
  return `${kept}…`;
}

/**
 * Task 10a: the one line a card names its group by on the overview, the board and the task list -- the clarify round's
 * short title when there is one, else a summary of the goal; clamped to two lines by CSS, the whole goal in `title`.
 * Detail pages show the goal itself, never this. With neither, `fallback` is shown, and without one nothing is.
 */
export function CardGoal(props: { group: Pick<GroupSummaryV1, "goal" | "requirement">; as?: "p" | "span"; className?: string; fallback?: string }): JSX.Element | null {
  const { goal, requirement } = props.group;
  const text = requirement?.title ?? (goal === undefined ? "" : goalSummary(goal));
  if (text === "" && props.fallback !== undefined) return <>{props.fallback}</>;
  if (text === "") return null;
  const Tag = props.as ?? "span";
  return <Tag className={["card-goal", props.className].filter(Boolean).join(" ")} title={goal}>{text}</Tag>;
}
