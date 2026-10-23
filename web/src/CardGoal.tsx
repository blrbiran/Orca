import type { JSX } from "react";
import type { GroupSummaryV1 } from "./controlTypes.js";

/** Task 10a: past this many characters a goal's first line is cut for a card (the CSS clamp then holds it to two lines). */
export const CARD_SUMMARY_MAX = 120;
const SENTENCE_END = /[。！？]|[.!?](?=\s|$)/u;

/**
 * Task 10a (human request, session 0e13a9b7): what a card shows of a long goal -- its first non-empty line; a line over
 * CARD_SUMMARY_MAX characters ends at its first sentence end within them, else is cut there with an ellipsis.
 */
export function goalSummary(goal: string): string {
  const line = goal.split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  const chars = Array.from(line);
  if (chars.length <= CARD_SUMMARY_MAX) return line;
  const head = chars.slice(0, CARD_SUMMARY_MAX).join("");
  const end = SENTENCE_END.exec(head);
  return end === null ? `${head}…` : head.slice(0, end.index + end[0].length);
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
