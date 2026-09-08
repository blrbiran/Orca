import { describe, expect, it } from "vitest";
import {
  CORRECTION_FIELDS,
  canonicalCorrectionJson,
  deriveCorrectionId,
  deriveFixRunId,
} from "../../src/corrections/fields.js";
import type { CorrectionRow } from "../../src/corrections/fields.js";

// 🔴 The scramble below is load-bearing: this literal's own key order must
// differ from CORRECTION_FIELDS, or the "serialises the fields in the
// declared order" criterion cannot tell canonicalCorrectionJson's declared-
// order serialisation apart from a mutation that just serialises the
// object's own key order (fix round 1, plan defect: the two orders used to
// coincide, so that mutation could not be made to go red).
const row = (overrides: Partial<CorrectionRow> = {}): CorrectionRow => ({
  by: "amy",
  because: "进程内互斥跨进程无效",
  at: "2026-09-07T00:00:00.000Z",
  projectKey: "github.com/biran/orca",
  decisionId: "orca-dev-1/1",
  kind: "not_my_taste",
  chose_instead: "改用文件租约",
  ...overrides,
});

describe("correction id and fix run id (spec §14.11)", () => {
  it("derives the same id from the same row, every time", () => {
    expect(deriveCorrectionId(row())).toBe(deriveCorrectionId(row()));
    expect(deriveCorrectionId(row())).toMatch(/^c_[0-9a-f]{16}$/);
  });

  it("shapes the fix run id the way the scheduler shapes every other run id", () => {
    expect(deriveFixRunId(row(), deriveCorrectionId(row()))).toMatch(/^orca-fix-[0-9a-f]{8}$/);
  });

  // 🔴 THE invariant A' §3.1 rests on, at unit level: two people correcting
  // the same decision must not write the same file. `by` is the field that
  // makes their rows differ, and it reaches the run id by two routes — through
  // the canonical JSON, and through the correction id that is the run id's
  // third input. Both routes are fed by CORRECTION_FIELDS, which is why
  // removing `by` from that one constant is a mutation with a single landing
  // point (E6 in Task 9 is the command-level half of this).
  it("makes both the correction id and the run id depend on who wrote the row", () => {
    const amy = row({ by: "amy" });
    const bob = row({ by: "bob" });
    expect(deriveCorrectionId(bob)).not.toBe(deriveCorrectionId(amy));
    expect(deriveFixRunId(bob, deriveCorrectionId(bob))).not.toBe(
      deriveFixRunId(amy, deriveCorrectionId(amy)),
    );
  });

  // 🔴 Round-4 review, item 4. Every other criterion in this file compares
  // deriveCorrectionId/deriveFixRunId against THEMSELVES (derived twice, or
  // derived from a row varied along one field) -- none of them pin the
  // derivation to a value outside the code under test. Measured: swapping two
  // entries of CORRECTION_FIELDS (e.g. "kind" and "because") left the whole
  // suite green, 209/209, because nothing here checks the code against
  // anything but itself. These two literals were produced by running the
  // CURRENT implementation against the fixture `row()` above (no overrides) —
  // freeze them, because a derivation change is a ledger-duplication bug, not
  // a refactor: a correction recorded by one version and closed by a later
  // one would derive a DIFFERENT run id, so the idempotence check would look
  // in a ledger file that does not exist, conclude "not yet closed", and
  // append a second decision+overturned pair.
  it("pins the correction id and fix run id to fixed literal values (golden, not self-referential)", () => {
    const fixture = row();
    const id = deriveCorrectionId(fixture);
    expect(id).toBe("c_2aaacf515c6bf900");
    expect(deriveFixRunId(fixture, id)).toBe("orca-fix-bab81d76");
  });

  it("serialises the fields in the declared order and omits the absent optional one", () => {
    const withoutAlternative = row({ kind: "wrong", chose_instead: undefined });
    const parsed = Object.keys(JSON.parse(canonicalCorrectionJson(withoutAlternative)));
    expect(parsed).not.toContain("chose_instead");
    expect(parsed).toEqual(CORRECTION_FIELDS.filter((f) => f !== "chose_instead"));
  });
});
