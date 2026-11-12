// Tester follow-up G spec §10.5 / §11 (plan Part B, O7): a group created under the follow-up G marker is an
// expectation-model group with no task token ceiling; a flow run's hidden child keeps the rules it had (plan D5), and a
// group with no marker (created before the release) keeps today's rules. Which model an import uses when its caller names
// none is DEFAULT_MODEL_VERSION: follow-up G (flipped in follow-up H, after the reconcile-funding gap was closed).
import { describe, expect, it } from "vitest";
import { expectationModelApplies } from "../../src/control/expectationModel.js";
import { isFollowupG } from "../../src/control/modelVersion.js";
import { DEFAULT_MODEL_VERSION } from "../../src/control/planImport.js";
import { readBudgetProposal, readGroup } from "../../src/control/queries.js";
import { webFixture } from "./fixtures/web.js";

describe("the follow-up G marker at import (spec §10.5, §11)", { timeout: 60_000 }, () => {
  it("a group imported under the marker is an expectation-model group with no task token ceiling", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g" });
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

  it("an import that names no model is created under the follow-up G marker", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1" });
    try {
      expect(DEFAULT_MODEL_VERSION).toBe("followup-g");
      expect(isFollowupG(readGroup(h.store, "g"))).toBe(true);
      expect(expectationModelApplies(readGroup(h.store, "g"))).toBe(true);
    } finally { await h.dispose(); }
  });
});
