// Tester follow-up G spec §10.5 / §11 (plan Part B, O7): every group created from now on carries the follow-up G marker, so
// its tasks' token amounts are expectations and the group limit is its one hard line; a flow run's hidden child keeps the
// rules it had (plan D5), and a group created before the release (no marker) keeps today's rules.
import { describe, expect, it } from "vitest";
import { expectationModelApplies } from "../../src/control/expectationModel.js";
import { isFollowupG } from "../../src/control/modelVersion.js";
import { readBudgetProposal, readGroup } from "../../src/control/queries.js";
import { webFixture } from "./fixtures/web.js";

describe("the expectation model is the default for new groups (spec §10.5, §11)", { timeout: 60_000 }, () => {
  it("a group imported after this release is an expectation-model group with no task token ceiling", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1" });
    try {
      const group = readGroup(h.store, "g");
      expect(isFollowupG(group)).toBe(true);
      expect(expectationModelApplies(group)).toBe(true);
      expect(readBudgetProposal(h.store, "g").allocations.find(a => a.ownerKind === "task" && a.bucket === "work")!.amount.tokens).toBeNull();
    } finally { await h.dispose(); }
  });

  it("a flow child and a group created before the release keep today's rules", async () => {
    expect(expectationModelApplies({ modelVersion: "followup-g", flow: { role: "child", flowRunId: "f", parentGroupId: "p", stepKey: "s", seq: 1, baseCommit: "c" } })).toBe(false);
    const h = await webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: null });
    try {
      expect(isFollowupG(readGroup(h.store, "g"))).toBe(false);
      expect(readBudgetProposal(h.store, "g").allocations.find(a => a.ownerKind === "task" && a.bucket === "work")!.amount.tokens).toBe(99_000);
    } finally { await h.dispose(); }
  });
});
