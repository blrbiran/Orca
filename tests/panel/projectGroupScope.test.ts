import { describe, expect, it } from "vitest";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readProjectionState, recordProjectionChange } from "../../src/control/projectionJournal.js";
import { readDraft, readRequirementGroup, saveRequirementGroup } from "../../src/control/requirementRecords.js";
import { groupSummarySchema } from "../../src/control/webProtocol.js";
import { readControlGroup, readControlSummary, readGroupSummary, readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "../control/fixtures/requirementHarness.js";
import { VALID_SPLIT } from "../control/fixtures/requirementOutputs.js";
import { webFixture } from "../control/fixtures/web.js";

// Project filtering spec §4: the server, not the panel, says which repository a group belongs to.
describe("group summary repository identity (project filtering spec §4)", () => {
  it("names the archived plan's repository on a plan group, in the summary list and in the group view", async () => {
    const x = await webFixture();
    try {
      const planRepo = readArchivedPlan(x.store, "g").plan.repoId;
      expect(planRepo).toBe("repo");
      expect(readGroupSummary(x.store, "g").repoId).toBe(planRepo);
      expect(readControlSummary(x.store, "epoch", null).groups.find((g) => g.groupId === "g")?.repoId).toBe(planRepo);
      expect(readControlGroup(x.store, "epoch", "g").summary.repoId).toBe(planRepo);
    } finally { await x.dispose(); }
  });

  it("names the requirement's repository on a clarifying group, in the summary and in the requirement view", async () => {
    const x = await requirementHarness();
    try {
      const requirementRepo = readRequirementGroup(x.store, "r").requirement.repoId;
      expect(requirementRepo).toBe("repo");
      expect(readGroupSummary(x.store, "r")).toMatchObject({ state: "clarifying", repoId: requirementRepo });
      expect(readRequirementView(x.store, "epoch", "r").summary.repoId).toBe(requirementRepo);
    } finally { await x.dispose(); }
  });

  it("gives the same repoId in a sinceChangeSeq (partial) summary as in a complete one", async () => {
    const x = await webFixture();
    try {
      const since = readProjectionState(x.store).changeSeq;
      recordProjectionChange(x.store, ["g"]);
      const partial = readControlSummary(x.store, "epoch", since);
      expect(partial.resetRequired).toBe(false);
      expect(partial.groups.map((g) => g.groupId)).toEqual(["g"]);
      expect(partial.groups[0]!.repoId).toBe(readControlSummary(x.store, "epoch", null).groups[0]!.repoId);
      expect(partial.groups[0]!.repoId).toBe("repo");
    } finally { await x.dispose(); }
  });

  it("refuses to guess when an accepted requirement group's plan and requirement disagree", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const answer = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
      expect(answer).toMatchObject({ result: { kind: "requirement-draft-accepted" } });
      // Agreeing first: an accepted group reports its plan's repository.
      expect(readGroupSummary(x.store, "r")).toMatchObject({ state: "draft", repoId: "repo" });
      const group = readRequirementGroup(x.store, "r");
      saveRequirementGroup(x.store, { ...group, requirement: { ...group.requirement, repoId: "other" } });
      expect(() => readGroupSummary(x.store, "r")).toThrow(/group-summary:repository-mismatch/);
      expect(() => readControlSummary(x.store, "epoch", null)).toThrow(/group-summary:repository-mismatch/);
    } finally { await x.dispose(); }
  });

  it("rejects a summary without repoId and one with an invalid repoId at the protocol boundary", () => {
    const base = { groupId: "a", state: "draft", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 };
    expect(groupSummarySchema.safeParse(base).success).toBe(false);
    expect(groupSummarySchema.safeParse({ ...base, repoId: "" }).success).toBe(false);
    expect(groupSummarySchema.safeParse({ ...base, repoId: "repo" }).success).toBe(true);
  });
});
