import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Human ruling H3 (2026-10-01): "execute阶段明显可以更长" -- longer than v1's one hour. Rewritten under the human's later
 * 2026-10-01 ruling: a v2 phase gets three hours, still clamped to the task's active time (deriveContract), so a task
 * granted four hours has three-hour phases inside a four-hour total.
 */
const LOOP = { goal: "write a", successCondition: "a exists", targetPaths: ["a"], checks: ["true"] };

describe("a v2 loop task's derived Web contract", () => {
  it("gives each phase three hours of the task's active time", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: LOOP }]);
    try {
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed || confirmed.result.kind !== "confirmed") throw new Error(JSON.stringify(confirmed));
      const snapshot = JSON.parse(readCanonicalRecord(h.store, confirmed.result.executionSnapshotHash));
      const work = snapshot.allocations.find((row: { ownerKind: string; ownerId: string; bucket: string }) => row.ownerKind === "task" && row.ownerId === "a" && row.bucket === "work");
      const derived = JSON.parse(readCanonicalRecord(h.store, snapshot.derivedContracts[0].derivedContractHash));
      const policy = JSON.parse(derived.contractCanonicalJson).executionPolicy;
      expect(work.amount.activeMs).toBe(14_400_000);
      expect([policy.perAttemptTimeoutMs, policy.totalRuntimeBudgetMs]).toEqual([10_800_000, 14_400_000]);
    } finally { await h.dispose(); }
  });
});
