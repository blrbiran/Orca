import { describe, expect, it } from "vitest";
import { HANDOFF_EXTRA_GRACE_MS, handoffGraceMsOf } from "../../src/control/driverHandoff.js";

// Handoff delivery spec §3 (controller decision) and §10: a delivered request that yields nothing turns
// outcome-unknown only past deadline + the agent's killGraceMs + 60 s. ccloop itself waits killGraceMs
// before it kills a phase, so a grace shorter than that would call a stop "unknown" while ccloop is still
// legitimately finishing it. The wiring into the running driver is measured by handoffE2E.test.ts (G).
//
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): spec §6.6 (§12 I5) -- the
// killGraceMs is the run's frozen one (ccloop's capabilities-v3 answer at confirmation), read off the run with no
// port call; the same rule and the same floor hold: never shorter than the fixed part, whatever the value.
describe("the handoff grace the driver waits (spec §3)", () => {
  // Orca backlog #13(b), rewritten under the human's 2026-09-29 authorization (session 2f65a729, "#13(a)/(b) 改测试部分
  // 同意"): an unusable frozen killGraceMs now counts as the ceiling the frozen slot allows (60 s, webProtocol.ts
  // frozenSlotSchema), not 0 -- fail closed: too long a grace only delays an outcome-unknown, too short a grace calls a
  // stop unknown while ccloop may still be finishing it.
  it("is the agent's killGraceMs plus the fixed extra, and the ceiling's grace when killGraceMs is unusable", () => {
    expect(HANDOFF_EXTRA_GRACE_MS).toBe(60_000);
    expect(handoffGraceMsOf({ killGraceMs: 5_000 })).toBe(65_000);
    expect(handoffGraceMsOf({ killGraceMs: 0 })).toBe(60_000);
    for (const killGraceMs of [-1, 1.5, "5000", null, undefined]) {
      expect(handoffGraceMsOf({ killGraceMs })).toBe(120_000);
    }
    expect(handoffGraceMsOf({})).toBe(120_000);
  });
});
