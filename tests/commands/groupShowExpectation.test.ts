// Tester follow-up G spec §2.2-§2.5 (plan Part B, O6): `orca group show` names, for an expectation-model group, a person's
// expectation (no estimate), a hard cap, a task waiting for a decision (with its ratio and the decide-usage command) and a
// task at the group cap (with the set-limit command and the codex overshoot note). A task without a budget state adds no
// line.
import { describe, expect, it } from "vitest";
import { budgetStateLines, expectationLines } from "../../src/commands/domains/verbs.js";

const NONE = { hardCapTokens: null, usagePause: null, usageStopped: null, groupCapStop: null };

describe("group show's budget lines (spec §2.2-§2.5)", () => {
  it("names the expectation, the ratio and the decision command", () => {
    expect(expectationLines({ workItems: [{ taskId: "a", lineageRunIds: ["r"], expected: { tokens: 1_000_000, estimateId: null, stale: false, usedTokens: 3_200_000 } }] }))
      .toEqual(["task a: used 3200000 tokens (×3.2 its estimate); expected 1000000 tokens from the amount a person set"]);
    expect(budgetStateLines("g1", { workItems: [
      { taskId: "a", budgetState: { ...NONE, usagePause: { usedTokens: 10_400_000, expectationTokens: 1_000_000, line: 10_000_000 } } },
      { taskId: "b", budgetState: { ...NONE, groupCapStop: { observedTokens: 2_900_000 } } },
      { taskId: "c", budgetState: { ...NONE, hardCapTokens: 400_000, usageStopped: { principal: "agent:claude" } } },
      { taskId: "d" },
    ] })).toEqual([
      "task a: waiting for a decision: used 10400000, ×10.4 of the expectation (pause line 10000000)",
      "  next: orca task decide-usage g1 a --decision continue [--note '<what to do next>']  or  --decision stop",
      "task b: group cap reached (the group has used its token limit; this run used 2900000)",
      // Ruling: 「这次批准改写所有必要的判据。」(human, tester follow-up K) -- "stops between turns ... by one turn" was wrong:
      // `codex exec` runs one turn per phase, so its ceiling is checked only after the phase ends (#297, a hint only).
      "  next: orca group set-limit g1 --limit '{\"tokens\":<higher>,...}'  (the task continues with its work; a codex task's ceiling is checked only after a whole phase ends, so a single execute can go past the cap)",
      "task c: hard cap 400000 tokens (a person's; no pause line)",
      "task c: stopped over its expectation by agent:claude",
    ]);
  });
});
