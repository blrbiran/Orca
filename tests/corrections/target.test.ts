import { describe, expect, it } from "vitest";
import type { CorrectionRow } from "../../src/corrections/fields.js";
import { CORRECTION_ROW_INVALID } from "../../src/corrections/record.js";
import { correctionSchema } from "../../src/corrections/schema.js";
import { correctionTargetOf } from "../../src/corrections/target.js";

const BASE = { projectKey: "example.invalid/o/r", kind: "wrong", because: "the facts were wrong", at: "2026-10-18T00:00:00.000Z", by: "owner@example.invalid" } as const;
const RUN = "orca-t1-0123abcd";
const decisionRow: CorrectionRow = { ...BASE, decisionId: `${RUN}/agent-0` };
const pendingRow: CorrectionRow = { ...BASE, runId: RUN, pendingId: `pending-${RUN}-0` };
const reconcilePendingRow: CorrectionRow = { ...BASE, runId: RUN, pendingId: `pending-reconcile-${RUN}-0` };

describe("correctionTargetOf (debug task Task 1)", () => {
  it("builds rows the real schema accepts", () => {
    for (const row of [decisionRow, pendingRow, reconcilePendingRow]) {
      expect(correctionSchema.safeParse({ id: "c_0", ...row }).success).toBe(true);
    }
  });

  it("reads a decision target", () => expect(correctionTargetOf(decisionRow)).toEqual({ kind: "decision", decisionId: `${RUN}/agent-0` }));
  it("reads a pending target", () => expect(correctionTargetOf(pendingRow)).toEqual({ kind: "pending", runId: RUN, pendingId: `pending-${RUN}-0` }));
  it("reads a pending target whose ledger run is a reconcile", () =>
    expect(correctionTargetOf(reconcilePendingRow)).toEqual({ kind: "pending", runId: RUN, pendingId: `pending-reconcile-${RUN}-0` }));

  it("refuses a row with both targets and a row with neither", () => {
    const both = { ...pendingRow, decisionId: `${RUN}/agent-0` };
    for (const row of [both, BASE, { ...BASE, runId: RUN }, { ...BASE, pendingId: `pending-${RUN}-0` }] as CorrectionRow[]) {
      expect(() => correctionTargetOf(row)).toThrowError(expect.objectContaining({ name: "CorrectRejection", code: CORRECTION_ROW_INVALID }));
    }
  });
});
