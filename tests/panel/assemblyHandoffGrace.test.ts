import { describe, expect, it } from "vitest";
import { HANDOFF_EXTRA_GRACE_MS, PARTIAL_FLUSH_MARGIN_MS, handoffGraceMsOf, recoveryWindowOf } from "../../src/control/driverHandoff.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

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
  //
  // Rewritten under ruling R5 (ccloop docs/superpowers/specs/2026-10-01-claude-adapter-consolidation-step1-design.md
  // §6, §7.5, §11): the grace also waits ccloop's execute stop bound, the frozen recovery window + PARTIAL_FLUSH_MARGIN_MS.
  // Every case keeps its value with a window of 0, except killGraceMs 0, which now gets 65_000 (was 60_000): the
  // margin applies even with a window of 0 (spec §11).
  it("is the agent's killGraceMs plus the fixed extra, and the ceiling's grace when killGraceMs is unusable", () => {
    expect(HANDOFF_EXTRA_GRACE_MS).toBe(60_000);
    expect(PARTIAL_FLUSH_MARGIN_MS).toBe(5_000);
    expect(handoffGraceMsOf({ killGraceMs: 5_000 }, 0)).toBe(65_000);
    expect(handoffGraceMsOf({ killGraceMs: 0 }, 0)).toBe(65_000); // max(0, 0 + 5_000) + 60_000; was 60_000 before step 1
    for (const killGraceMs of [-1, 1.5, "5000", null, undefined]) {
      expect(handoffGraceMsOf({ killGraceMs }, 0)).toBe(120_000);
    }
    expect(handoffGraceMsOf({}, 0)).toBe(120_000);
  });

  // ccloop consolidation step 1 (spec §6, §7.4): ccloop does not kill an execute before the recovery window plus
  // the margin, so a grace shorter than that would call a stop unknown while ccloop may still print its partial.
  it("waits the recovery window plus the margin when that is longer than killGraceMs", () => {
    expect(handoffGraceMsOf({ killGraceMs: 5_000 }, 70_000)).toBe(135_000);
    expect(handoffGraceMsOf({ killGraceMs: 30_000 }, 1_000)).toBe(90_000);
  });

  // ccloop consolidation step 1 (spec §6): fail closed, as an unusable killGraceMs does.
  it("an unusable recovery window falls back to the ceiling grace", () => {
    for (const w of [-1, 1.5, "1000", null, undefined]) expect(handoffGraceMsOf({ killGraceMs: 5_000 }, w)).toBe(120_000);
  });

  // ccloop consolidation step 1 (spec §6): the window is the run's frozen contract's; a single call has no execute to stop.
  it("reads the window from a loop envelope's frozen contract; a single call has none", () => {
    expect(recoveryWindowOf({ work: { kind: "loop", contract: { executionPolicy: { partialOutcomeRecoveryWindowMs: 60_000 } } } } as unknown as StartEnvelope)).toBe(60_000);
    expect(recoveryWindowOf({ work: { kind: "single-call" } } as unknown as StartEnvelope)).toBe(0);
    expect(recoveryWindowOf({ work: { kind: "loop", contract: {} } } as unknown as StartEnvelope)).toBeUndefined();
  });
});
