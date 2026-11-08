import { describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";

// #138 (design Correction 2, 2026-11-08): the only honest undo for a decision that changed nothing is the structured,
// Git-checkable proof, never a reserved phrase. The standalone validator owns the shape; the tree equality is re-checked
// here too, because two different trees cannot be the same non-change, and a `kind` with no proof is malformed.
const line = (undo: Record<string, unknown>) => JSON.stringify({
  ev: "decision", id: "run-1/agent-0", at: "2026-11-08T00:00:00.000Z", run: "run-1",
  question: "should the attempt extend the suite?", chose: "no change was needed",
  alternatives: [{ option: "extend it", why_not: "the suite already covers the behaviour" }],
  because: "the acceptance criteria are met by the existing tests", undo, scope: "task", kind: "criteria",
});
const proof = (over: Record<string, unknown> = {}) => ({
  base: "a".repeat(40), attempt: "b".repeat(40), baseTree: "c".repeat(40), attemptTree: "c".repeat(40),
  contractHash: "d".repeat(64), requiredChecks: ["npm test"], ...over,
});

describe("a structured no-change undo", () => {
  it("accepts a proof whose two trees are the same", () => {
    expect(validateLine(line({ how: "no change; nothing to revert", cost: "none", blast_radius: "none", kind: "no-change", proof: proof() })).verdict).toBe("ok");
  });

  it("rejects the kind without a proof", () => {
    const verdict = validateLine(line({ how: "no change; nothing to revert", cost: "none", blast_radius: "none", kind: "no-change" }));
    expect(verdict.verdict).toBe("rejected");
  });

  it("rejects a proof naming different trees", () => {
    const verdict = validateLine(line({ how: "no change; nothing to revert", cost: "none", blast_radius: "none", kind: "no-change", proof: proof({ attemptTree: "e".repeat(40) }) }));
    expect(verdict.verdict).toBe("rejected");
  });

  it("still downgrades a bare phrase with no structured kind", () => {
    // The existing behavior: prose alone is not an executable undo, so an agent cannot make this decision alone.
    expect(validateLine(line({ how: "No change made; nothing to revert", cost: "none", blast_radius: "none" })).verdict).toBe("downgraded");
  });
});
