/**
 * Reported-decisions spec 2026-10-20 §6 (goal.md §1.3): a decision list shows major decisions by default; the minor
 * ones (naming, local implementation trade-offs) are one click away, and once shown they open and are correctable like
 * any other. An entry without a grade is major -- every ledger line written before the field existed has none.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

type Graded = { importance?: "major" | "minor" };

export const isMinor = (entry: Graded): boolean => entry.importance === "minor";

/** The entries a list shows: all of them once minor ones are asked for, otherwise the major ones. */
export function visibleByImportance<T extends Graded>(entries: readonly T[], showMinor: boolean): T[] {
  return showMinor ? [...entries] : entries.filter((entry) => !isMinor(entry));
}

/**
 * The "show N minor" / "hide minor" control; nothing when the list has no minor entry. `copy` names the namespace
 * whose words it uses (the Decisions page says 决策, a group's run says 决定).
 */
export function MinorToggle(props: { entries: readonly Graded[]; showMinor: boolean; onToggle: (next: boolean) => void; copy: "decisions" | "control.decisions" }): JSX.Element | null {
  const { t } = useTranslation();
  const minor = props.entries.filter(isMinor).length;
  if (minor === 0) return null;
  return (
    <button type="button" className="minor-toggle" aria-expanded={props.showMinor} onClick={() => props.onToggle(!props.showMinor)}>
      {props.showMinor ? t(`${props.copy}.hideMinor`) : t(`${props.copy}.showMinor`, { n: minor })}
    </button>
  );
}
