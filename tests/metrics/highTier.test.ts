import { describe, expect, it } from "vitest";
import { DECISION_KINDS } from "../../src/ledger/types.js";
import { KIND_TIER, isHighTier } from "../../src/metrics/highTier.js";

describe("high-tier classification (E2 spec §3.6, A' §3.6 as corrected by A' ERRATUM 4)", () => {
  it("sorts reconcile high — the kind A' §3.6's six-name whitelist left at the bottom", () => {
    expect(KIND_TIER.reconcile).toBe("high");
    expect(isHighTier("repo", "reconcile")).toBe(true);
    expect(isHighTier("cross-repo", "reconcile")).toBe(true);
  });

  it("keeps A' §3.6's scope half: a file- or task-scoped decision sinks whatever its kind", () => {
    expect(isHighTier("file", "dependency")).toBe(false);
    expect(isHighTier("task", "reconcile")).toBe(false);
  });

  it("classifies every kind in DECISION_KINDS — no kind may be missing", () => {
    for (const kind of DECISION_KINDS) expect(KIND_TIER[kind]).toMatch(/^(high|low)$/);
    expect(Object.keys(KIND_TIER)).toHaveLength(DECISION_KINDS.length);
  });

  it("keeps the six A' already named high, so this is a widening and not a rewrite", () => {
    for (const kind of ["dependency", "interface", "scheduling", "abandon", "criteria", "boundary"] as const) {
      expect(KIND_TIER[kind]).toBe("high");
    }
  });
});
