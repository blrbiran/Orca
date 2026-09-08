import type { DecisionEvent, OverturnedEvent } from "../ledger/schema.js";
import type { Correction } from "./schema.js";

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
  const { correction, original, choseInstead, undo, at, runId } = input;
  const decisionId = `${runId}/1`;

  const decision: DecisionEvent = {
    ev: "decision",
    id: decisionId,
    at,
    run: runId,
    // The question did not change; the answer did. Copied verbatim on purpose.
    question: original.question,
    chose: choseInstead,
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
      how: undo.how,
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
