import { describe, expect, it } from "vitest";
import { HANDOFF_EXTRA_GRACE_MS, handoffGraceMsOf } from "../../src/control/driverHandoff.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import type { PartialSelection } from "../../src/control/agentSelection.js";

// Handoff delivery spec §3 (controller decision) and §10: a delivered request that yields nothing turns
// outcome-unknown only past deadline + the agent's killGraceMs + 60 s. ccloop itself waits killGraceMs
// before it kills a phase, so a grace shorter than that would call a stop "unknown" while ccloop is still
// legitimately finishing it. The wiring into the running driver is measured by handoffE2E.test.ts (G).
//
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the killGraceMs is the one
// ccloop answers for the run's frozen selection (capabilities protocol 3, spec §6.6) -- Orca no longer reads a
// config file for it -- and the same floor holds: never shorter than the fixed part, whatever the answer.
const answering = (killGraceMs: unknown, asked: PartialSelection[] = []): Pick<ExecutionPort, "resolveAgent"> => ({
  resolveAgent: async (partial) => {
    asked.push(partial);
    return { selection: { agent: "codex", model: "m", contextWindow: "agent-default" }, configHash: "c".repeat(64), timeoutMs: 1, killGraceMs: killGraceMs as number, capabilities: {} as never };
  },
});

describe("the handoff grace the driver waits (spec §3)", () => {
  it("is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable", async () => {
    expect(HANDOFF_EXTRA_GRACE_MS).toBe(60_000);
    const asked: PartialSelection[] = [];
    expect(await handoffGraceMsOf(answering(5_000, asked), { agent: "claude", model: "claude-opus-5-5" })).toBe(65_000);
    expect(asked).toEqual([{ agent: "claude", model: "claude-opus-5-5" }]);
    expect(await handoffGraceMsOf(answering(0), { agent: "codex" })).toBe(60_000);
    // Never shorter than the fixed part, whatever the peer says or fails to say.
    for (const value of [-1, 1.5, "5000", null, undefined]) {
      expect(await handoffGraceMsOf(answering(value), { agent: "codex" })).toBe(60_000);
    }
    expect(await handoffGraceMsOf({ resolveAgent: async () => { throw new Error("offline"); } }, { agent: "codex" })).toBe(60_000);
  });
});
