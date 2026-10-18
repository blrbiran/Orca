import type { DecisionEvent, OverturnedEvent } from "../ledger/schema.js";
import type { PendingEntry } from "../control/runLedger.js";
import type { Correction } from "./schema.js";

/**
 * Debug-task design §5, §12.5: a closing row's value nobody human wrote says so in its own text, as inherited() marks
 * an inherited one -- DecisionEvent has no author field and the ledger is append-only.
 */
export const AGENT_WRITTEN = "（agent 写，人未填）";
export const ORCA_GENERATED = "（Orca 生成，人未填）";

export interface DeriveInput {
  correction: Correction;
  original: DecisionEvent;
  choseInstead: string;
  undo: { how: string; cost?: string; blastRadius?: string };
  /**
   * 🔴 The real moment this row is being written, injected rather than read
   * from a clock in here — spec §14.5. Two reasons it is a parameter: the two
   * rows must carry the SAME stamp, and a criterion has to be able to pin what
   * that stamp was.
   */
  at: string;
  runId: string;
  /**
   * Debug-task design §12.5 (plan Task 9, ruling C21): who wrote `choseInstead` and `undo.how`. Absent means the
   * human wrote both, as on every `--close`. The suffixes are added here and nowhere else, so callers pass bare values.
   */
  authored?: { choseInstead: "human" | "agent"; undoHow: "human" | "orca" };
}

/** The two authored values as they are written: a non-human one carries its suffix. */
function authoredValues(choseInstead: string, how: string, authored: DeriveInput["authored"]): { chose: string; how: string } {
  return {
    chose: authored?.choseInstead === "agent" ? `${choseInstead}${AGENT_WRITTEN}` : choseInstead,
    how: authored?.undoHow === "orca" ? `${how}${ORCA_GENERATED}` : how,
  };
}

export interface DerivedRows {
  decision: DecisionEvent;
  overturned: OverturnedEvent;
}

/**
 * An inherited undo field says so, in the row itself. The reader of a ledger
 * line has no other way to tell "the person weighed this" from "we copied it
 * off the decision being overturned", and the reverse of a choice does not
 * generally cost what the choice cost (spec §9 item 3).
 */
function inherited(value: string, originalId: string): string {
  return `${value}（继承自 ${originalId}）`;
}

/**
 * spec §5's derivation table, as revised by §14.2 / §14.5 / §14.22.
 *
 * Pure: same inputs, same two rows. Everything non-deterministic (the clock,
 * the run id, which correction row this is) is an argument, which is what lets
 * E13 deep-equal both rows instead of picking at them field by field.
 */
export function deriveRows(input: DeriveInput): DerivedRows {
  const { correction, original, undo, at, runId } = input;
  const decisionId = `${runId}/1`;
  const { chose, how } = authoredValues(input.choseInstead, undo.how, input.authored);

  const decision: DecisionEvent = {
    ev: "decision",
    id: decisionId,
    at,
    run: runId,
    // The question did not change; the answer did. Copied verbatim on purpose.
    question: original.question,
    chose,
    // why_not is not a copy of `because`: it carries the correction's id, so a
    // reader of this alternative can find out who refused the old option and
    // where they said why. An unattributed reason is the shape CLAUDE.md
    // Rule 13 exists to prevent.
    alternatives: [
      {
        option: original.chose,
        why_not: `人在 correction ${correction.id} 里推翻了它：${correction.because}`,
      },
    ],
    because: correction.because,
    undo: {
      // The human's, always (ruling 4): this is the field the Tier 0 gate
      // reads, and a derived one would make that gate unable to ever fire.
      how,
      cost: undo.cost ?? inherited(original.undo.cost, original.id),
      blast_radius: undo.blastRadius ?? inherited(original.undo.blast_radius, original.id),
    },
    scope: original.scope,
    kind: original.kind,
    evidence: [`correction ${correction.id}`, `overturns ${original.id}`],
  };

  const overturned: OverturnedEvent = {
    ev: "overturned",
    id: original.id,
    correctionId: correction.id,
    replacedBy: decisionId,
    at,
    run: runId,
  };

  return { decision, overturned };
}

const textOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const objectOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Debug-task design §12.3: a pending-target correction has no ledger row to overturn, so its closing is one `decision`
 * row and no `overturned`. The question, the refused choice, kind, scope and undo cost come from the agent's raw entry
 * (ruling C17); a field it lacks stays absent, and appendEvents refuses the row rather than this guessing one.
 */
export function derivePendingRows(input: {
  correction: Correction; pending: PendingEntry; choseInstead: string; undo: { how: string }; at: string; runId: string;
  authored: DeriveInput["authored"];
}): { decision: DecisionEvent } {
  const { correction, pending, at, runId } = input;
  const entry = objectOf(pending.entry);
  const entryUndo = objectOf(entry.undo);
  const { chose, how } = authoredValues(input.choseInstead, input.undo.how, input.authored);
  const inheritedOf = (value: unknown): string | undefined => {
    const text = textOf(value);
    return text === undefined ? undefined : inherited(text, pending.pendingId);
  };
  const decision = {
    ev: "decision",
    id: `${runId}/1`,
    at,
    run: runId,
    question: textOf(entry.question),
    chose,
    alternatives: [{ option: textOf(entry.chose), why_not: `人在 correction ${correction.id} 里推翻了它：${correction.because}` }],
    because: correction.because,
    undo: { how, cost: inheritedOf(entryUndo.cost), blast_radius: inheritedOf(entryUndo.blast_radius) },
    scope: entry.scope,
    kind: entry.kind,
    evidence: [`correction ${correction.id}`, `pending ${pending.pendingId}`],
  } as DecisionEvent;
  return { decision };
}
