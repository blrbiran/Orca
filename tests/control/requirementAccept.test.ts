import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { add } from "../../src/control/budget.js";
import { ControlError } from "../../src/control/errors.js";
import { complex1mDefaults } from "../../src/control/estimator.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { applyRequirementDraftAccept } from "../../src/control/requirementCommands.js";
import { renderRequirementDocument } from "../../src/control/requirementDocument.js";
import { readDraft, readRequirementGroup, readRound, readRounds, saveRequirementGroup, writeDraft, writeRound } from "../../src/control/requirementRecords.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { assertKnownConservation, readWebGroup } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { FIXTURE_OTHER_AGENT_ID } from "./fixtures/agents.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// N1 spec §9.1: one transaction freezes the document, imports the stored plan into this same group (clarifying ->
// draft), carries the clarifying spend over, records each work item's traces, and queues the export.
async function reviewed() {
  const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
  await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
  return x;
}
const accept = (x: Awaited<ReturnType<typeof reviewed>>, draftHash = readDraft(x.store, "r", 1).draftHash!) =>
  x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash }));
const bodyOf = (x: Awaited<ReturnType<typeof reviewed>>) => JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body));

describe("requirement-draft-accept (N1 spec §9.1)", () => {
  it("imports the stored plan into the same group, with a proposal, work items carrying their traces, and an estimate", async () => {
    const x = await reviewed();
    try {
      const answer = await accept(x);
      expect(answer).toMatchObject({ result: { kind: "requirement-draft-accepted", draftNo: 1, exportWakeId: "scheduler-wake:r:requirement-export" } });
      expect(readWebGroup(x.store, "r")).toMatchObject({ status: "draft" });
      expect(readArchivedPlan(x.store, "r").plan).toMatchObject({ repoId: "repo", planId: "requirement-draft-1", tasks: [{ taskId: "exporter" }, { taskId: "images" }] });
      const work = (taskId: string) => JSON.parse(String(x.store.db.prepare("SELECT body FROM work_items WHERE group_id='r' AND id=?").get(taskId)!.body));
      expect(work("exporter").traces).toEqual(["AC1"]);
      expect(work("images").traces).toEqual(["AC2"]);
      expect(readDraft(x.store, "r", 1).state).toBe("accepted");
      expect(x.store.db.prepare("SELECT kind,delivered FROM scheduler_wakes WHERE id='scheduler-wake:r:requirement-export'").get()).toEqual({ kind: "requirement-export", delivered: 0 });
      expect(readRequirementGroup(x.store, "r").requirement).toMatchObject({ acceptedDraftNo: 1, export: { state: "pending" } });
    } finally { await x.dispose(); }
  });

  it("carries the clarifying spend into the imported ledger: used unchanged, limit raised by exactly that", async () => {
    const x = await reviewed();
    try {
      const before = readWebGroup(x.store, "r").used;
      await accept(x);
      const group = readWebGroup(x.store, "r"), proposal = readBudgetProposal(x.store, "r");
      expect(group.used).toEqual(before);
      expect(group.limit).toEqual(add(complex1mDefaults(2).limit, before));
      expect(proposal.groupLimit).toEqual(group.limit);
      expect(() => assertKnownConservation(x.store, group, proposal)).not.toThrow();
    } finally { await x.dispose(); }
  });

  it("freezes the document rendered from the records now, and later record changes do not touch it", async () => {
    const x = await reviewed();
    try {
      const expected = renderRequirementDocument({ groupId: "r", requirement: readRequirementGroup(x.store, "r").requirement, rounds: readRounds(x.store, "r"), acceptedSplit: VALID_SPLIT });
      const answer = await accept(x);
      const document = readRequirementGroup(x.store, "r").requirement.document!;
      expect(document.sha256).toBe(createHash("sha256").update(expected, "utf8").digest("hex"));
      expect((answer as { result: { documentSha256: string } }).result.documentSha256).toBe(document.sha256);
      writeRound(x.store, "r", { ...readRound(x.store, "r", 1), closedByConsensus: true });
      expect(JSON.parse(readCanonicalRecord(x.store, document.recordHash)).text).toBe(expected);
    } finally { await x.dispose(); }
  });

  it("refuses a stale draft hash and a draft not under review, changing nothing", async () => {
    const x = await reviewed();
    try {
      expect(await accept(x, "0".repeat(64))).toMatchObject({ error: { code: "plan-version-conflict" } });
      expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 2, draftHash: readDraft(x.store, "r", 1).draftHash! }))).toMatchObject({ error: { code: "work-not-found" } });
      expect(readWebGroup(x.store, "r").status).toBe("clarifying");
    } finally { await x.dispose(); }
  });

  // Task 4 carry: after accept the group is a plan group that still carries its requirement block. The summary and the
  // plan readers treat it as any plan group (plan, proposal, completion), and the requirement line stays beside it. The
  // group view (readControlGroup) is Task 12's: its run schema learns the clarifying calls' single-call runs there (M12.3).
  it("summarises the accepted group as a plan group with its requirement line", async () => {
    const x = await reviewed();
    try {
      await accept(x);
      const group = readWebGroup(x.store, "r");
      expect(readGroupSummary(x.store, "r")).toMatchObject({
        groupId: "r", state: "draft", completion: { done: 0, total: 2 },
        requirement: { draftNo: 1, draftState: "accepted", exportState: "pending", used: group.used, reserved: group.reserved, limit: group.limit },
      });
    } finally { await x.dispose(); }
  });

  // The group's own estimator layer (what requirement-open's `agent` writes) is the layer the import freezes and keeps;
  // the budget version keeps counting from the clarifying phase's usage bookings.
  it("keeps the group's estimator layer and its budget version through the import", async () => {
    const x = await reviewed();
    try {
      const group = readRequirementGroup(x.store, "r");
      saveRequirementGroup(x.store, { ...group, agentOverrides: { estimator: { agent: FIXTURE_OTHER_AGENT_ID } } });
      const budgetVersion = bodyOf(x).budgetVersion as number;
      expect(budgetVersion).toBeGreaterThan(1);
      expect(await accept(x)).toMatchObject({ result: { kind: "requirement-draft-accepted" } });
      expect(bodyOf(x)).toMatchObject({ status: "draft", budgetVersion, agentOverrides: { estimator: { agent: FIXTURE_OTHER_AGENT_ID } }, estimatorSlot: { selection: { agent: FIXTURE_OTHER_AGENT_ID } } });
    } finally { await x.dispose(); }
  });

  it("refuses a draft that was sent back, a call in flight, and a group that is no longer clarifying", async () => {
    const x = await reviewed();
    try {
      const hash = readDraft(x.store, "r", 1).draftHash!;
      // A call in flight: the run's active flag, or a reservation still held (fabricated; settlement clears both at once).
      x.store.db.prepare("UPDATE runs SET active=1 WHERE group_id='r'").run();
      expect(await accept(x)).toMatchObject({ error: { code: "group-state-invalid" } });
      x.store.db.prepare("UPDATE runs SET active=0 WHERE group_id='r'").run();
      x.store.db.prepare("UPDATE groups SET body=json_set(body,'$.reserved.tokens',1) WHERE id='r'").run();
      expect(await accept(x)).toMatchObject({ error: { code: "group-state-invalid" } });
      x.store.db.prepare("UPDATE groups SET body=json_set(body,'$.reserved.tokens',0) WHERE id='r'").run();
      expect(readWebGroup(x.store, "r").status).toBe("clarifying");
      // Accepted once; draft 1 forced back to awaiting-review is still refused, because the group is a plan group now.
      expect(await accept(x)).toMatchObject({ result: { kind: "requirement-draft-accepted" } });
      writeDraft(x.store, "r", { ...readDraft(x.store, "r", 1), state: "awaiting-review" });
      expect(await accept(x, hash)).toMatchObject({ error: { code: "group-state-invalid" } });
    } finally { await x.dispose(); }
  });

  it("refuses a draft the person sent back, though its hash still matches", async () => {
    const x = await reviewed();
    try {
      const hash = readDraft(x.store, "r", 1).draftHash!;
      expect(await x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: "Merge them." }))).toMatchObject({ result: { kind: "requirement-draft-rejected" } });
      expect(await accept(x, hash)).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(readWebGroup(x.store, "r").status).toBe("clarifying");
    } finally { await x.dispose(); }
  });

  it("books a preparation failure under the command, and answers a replay from the ledger without preparing again", async () => {
    const x = await reviewed();
    try {
      let prepared = 0;
      const deps = { store: x.store, profileRouter: x.deps.router, trustedConfig: { resolveTarget: () => { throw new ControlError("control-plan-rejected"); } },
        defaults: () => { prepared += 1; return { estimatorProfileId: "all", estimatorProfileHash: x.profile.profileHash, estimateMode: "soft" as const }; } };
      const failing = { ...deps, defaults: () => { throw new ControlError("control-estimator-unconfigured"); } };
      const refused = x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! });
      expect(await applyRequirementDraftAccept(failing, refused)).toMatchObject({ error: { code: "control-estimator-unconfigured" } });
      expect(x.store.db.prepare("SELECT verb FROM commands WHERE group_id='r' AND id=?").get((refused as { commandId: string }).commandId)).toEqual({ verb: "requirement-draft-accept" });
      const command = x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! });
      const first = await applyRequirementDraftAccept(deps, command);
      expect(first).toMatchObject({ result: { kind: "requirement-draft-accepted" } });
      expect(prepared).toBe(1);
      expect(await applyRequirementDraftAccept(deps, command)).toEqual(first);
      expect(prepared).toBe(1);
    } finally { await x.dispose(); }
  });
});
