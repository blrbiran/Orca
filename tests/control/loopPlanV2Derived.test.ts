import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Human ruling H3 (2026-10-01): "execute阶段明显可以更长" -- a v2 loop plan sets no phase timeout of its own, so on the
 * Web path the derived contract's phase timeout is the task's whole active-time budget (deriveContract clamps the plan's
 * MAX_TIMER_MS to work.activeMs), not v1's one hour.
 */
const LOOP = { goal: "write a", successCondition: "a exists", targetPaths: ["a"], checks: ["true"] };

describe("a v2 loop task's derived Web contract", () => {
  it("gives each phase the task's whole active time", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: LOOP }]);
    try {
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed || confirmed.result.kind !== "confirmed") throw new Error(JSON.stringify(confirmed));
      const snapshot = JSON.parse(readCanonicalRecord(h.store, confirmed.result.executionSnapshotHash));
      const work = snapshot.allocations.find((row: { ownerKind: string; ownerId: string; bucket: string }) => row.ownerKind === "task" && row.ownerId === "a" && row.bucket === "work");
      const derived = JSON.parse(readCanonicalRecord(h.store, snapshot.derivedContracts[0].derivedContractHash));
      const policy = JSON.parse(derived.contractCanonicalJson).executionPolicy;
      expect([policy.perAttemptTimeoutMs, policy.totalRuntimeBudgetMs]).toEqual([work.amount.activeMs, work.amount.activeMs]);
    } finally { await h.dispose(); }
  });
});
