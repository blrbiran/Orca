import { describe, expect, it } from "vitest";
import { frozenWorkAgent } from "../../src/control/agentFreeze.js";
import { boundedGroupGrant, claimGroupSingleCallInTransaction, interruptGroupSingleCall } from "../../src/control/groupSingleCall.js";
import { readGroup, readWork, saveGroup } from "../../src/control/queries.js";
import type { StoppedSingleCallRun } from "../../src/control/singleCallLedger.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester follow-up G plan Task 2: a group's own single call (the goal judge, the requirement review) is funded by the
 * group it serves -- never past a finite group's remainder -- and gives back what it did not use when it stops.
 */
const ASK = { tokens: 200_000, activeMs: 600_000, attempts: 1, sessions: 1 };

function setLedger(t: Awaited<ReturnType<typeof driverHarness>>, limitTokens: number | null, usedTokens: number) {
  const group = readGroup(t.h.store, "g") as unknown as { limit: Record<string, number | null>; used: Record<string, number>; reserved: Record<string, number> };
  group.limit = { ...group.limit, tokens: limitTokens };
  group.used = { ...group.used, tokens: usedTokens };
  group.reserved = { ...group.reserved, tokens: 0 };
  saveGroup(t.h.store, group as never);
}

describe("a group's own single call (tester follow-up G, spec §10.1, §3)", () => {
  it("boundedGroupGrant caps tokens at the finite remainder and names the dimension that does not fit", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      setLedger(t, 1_000_000, 900_000);
      // mutation: drop the min against the remainder -> 200 000, red
      expect(boundedGroupGrant(t.h.store, "g", ASK, 20_000, Date.now())).toEqual({ grant: { ...ASK, tokens: 100_000 } });
      setLedger(t, 1_000_000, 990_000);
      expect(boundedGroupGrant(t.h.store, "g", ASK, 20_000, Date.now())).toEqual({ unfunded: "tokens" });
      setLedger(t, null, 990_000);
      expect(boundedGroupGrant(t.h.store, "g", ASK, 20_000, Date.now())).toEqual({ grant: ASK });
    } finally { await t.h.dispose(); }
  });

  it("a claim reserves its grant on the group and an interrupt gives the unused part back", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const before = readGroup(t.h.store, "g").reserved.tokens;
      const agent = frozenWorkAgent(readWork(t.h.store, "g", "a"));
      const slot = { selection: agent.agent, configHash: agent.configHash, timeoutMs: agent.timeoutMs, killGraceMs: agent.killGraceMs, capabilities: agent.agentCapabilities, partial: {}, provenance: agent.agentProvenance };
      // The purposes are registered with their handlers (Tasks 5, 8); the plumbing is purpose-agnostic, so a registered one stands in.
      const { runId } = t.h.store.transaction(() => claimGroupSingleCallInTransaction(t.h.store, {
        groupId: "g", workItemId: "no-change-judge-run-x", purpose: "quota-probe" as never, identity: { noChangeJudge: { taskId: "a" } },
        slot: slot as never, profile: { profileId: "all", profileHash: "a".repeat(64) }, grant: ASK, contract: { schema: "test-contract" },
      }));
      expect(readGroup(t.h.store, "g").reserved.tokens).toBe(before + ASK.tokens);
      const run = t.body(runId) as StoppedSingleCallRun;
      expect(run).toMatchObject({ phase: "single-call", state: "starting", noChangeJudge: { taskId: "a" } });
      // Stopped before the provider: nothing used, the whole grant remains.
      t.h.store.transaction(() => interruptGroupSingleCall(t.h.store, { ...run, state: "settled-failed" }));
      // mutation: skip the subtraction in interrupt -> still before + grant, red
      expect(readGroup(t.h.store, "g").reserved.tokens).toBe(before);
    } finally { await t.h.dispose(); }
  });
});
