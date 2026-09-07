import { describe, expect, it } from "vitest";
import {
  CORRECTION_FIELDS,
  canonicalCorrectionJson,
  deriveCorrectionId,
  deriveFixRunId,
} from "../../src/corrections/fields.js";
import type { CorrectionRow } from "../../src/corrections/fields.js";

const row = (overrides: Partial<CorrectionRow> = {}): CorrectionRow => ({
  projectKey: "github.com/biran/orca",
  decisionId: "orca-dev-1/1",
  kind: "not_my_taste",
  chose_instead: "改用文件租约",
  because: "进程内互斥跨进程无效",
  at: "2026-09-07T00:00:00.000Z",
  by: "amy",
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

  it("serialises the fields in the declared order and omits the absent optional one", () => {
    const withoutAlternative = row({ kind: "wrong", chose_instead: undefined });
    const parsed = Object.keys(JSON.parse(canonicalCorrectionJson(withoutAlternative)));
    expect(parsed).not.toContain("chose_instead");
    expect(parsed).toEqual(CORRECTION_FIELDS.filter((f) => f !== "chose_instead"));
  });
});
