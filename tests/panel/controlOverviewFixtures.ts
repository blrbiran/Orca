import {estimateOutput} from "../control/fixtures/estimateHarness.js";
import { expect, vi } from "vitest";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {command,createHarness,get,json,GROUP,revision,view,claudeCodexResolveAgent,settleRun} from "./fixtures/controlPanel.js";
import {insertClarifyingGroup,newRound,writeRound} from "../../src/control/requirementRecords.js";
import {clarifyingInput} from "../control/fixtures/requirement.js";
import {classifyClarifyOutput} from "../../src/control/requirementClarify.js";
import {ROUND_TWO} from "../control/fixtures/requirementOutputs.js";

export function createOverviewFixtures(h: ReturnType<typeof createHarness>) {
  async function panelFixture(twoIndependentTasks = false) {
    const paths = await h.workspace();
    if (twoIndependentTasks) {
      const plan = JSON.parse(readFileSync(paths.planPath, "utf8"));
      const contract = JSON.parse(readFileSync(plan.tasks[0].contract, "utf8"));
      contract.objective.taskId = "b"; contract.context.targetPaths = ["b.ts"];
      const contractPath = join(plan.tasks[0].contract, "..", "b.json");
      writeFileSync(contractPath, JSON.stringify(contract));
      plan.tasks.push({taskId:"b",contract:contractPath,dependsOn:[],targetVersion:1});
      writeFileSync(paths.planPath, JSON.stringify(plan));
    }
    const probe = vi.fn(claudeCodexResolveAgent);
    const panel = await h.boot("overview-epoch", paths, { resolveAgent: probe });
    await command(panel, "/api/control/groups/import-plan", { commandId: "import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
    return { panel, probe };
  }
  async function confirm(panel: Awaited<ReturnType<typeof panelFixture>>["panel"]) {
    const group = await view(panel);
    const config = await json(await get(panel, "/api/control/config"));
    const profile = (config.profiles as {profileHash:string}[])[0]!;
    const response = await command(panel, `/api/control/groups/${GROUP}/confirm`, { commandId: "confirm", expectedRevision: await revision(panel), payload: {
      planHash: group.plan.planHash, proposalVersion: group.proposal.proposalVersion, budgetMode: "soft",
      profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
      profileHashes: { estimator: profile.profileHash, worker: profile.profileHash, handoff: profile.profileHash, goalReview: profile.profileHash },
      contextPolicy: { handoffAtContextTokens: 800_000 }, selectionsHash: await panel.selectionsHash(),
    }});
    expect(response.status).toBe(200);
  }
  async function overview(panel: Awaited<ReturnType<typeof panelFixture>>["panel"]) {
    const response = await get(panel, "/api/control/overview");
    expect(response.status).toBe(200);
    return await json(response) as {schema:string; epoch:string; groups:any[]; steps:any[]; issues:any[]};
  }
  function seedZeroQuestion(panel: Awaited<ReturnType<typeof panelFixture>>["panel"], groupId = "zero-questions") {
    const classified = classifyClarifyOutput({ ...ROUND_TWO, slug: "markdown-export" }, { roundNo: 1, requirementId: "0123456789abcdef0123456789abcdef", earlierQuestionIds: [] });
    if (!classified.ok) throw new Error(classified.reason);
    panel.store.transaction(() => {
      insertClarifyingGroup(panel.store, clarifyingInput(groupId));
      panel.store.db.prepare("UPDATE groups SET revision=1 WHERE id=?").run(groupId);
      writeRound(panel.store, groupId, { ...newRound(1), state: "awaiting-answers", result: classified.result });
    });
  }
  async function finishEstimate(panel: Awaited<ReturnType<typeof panelFixture>>["panel"]) {
    await panel.drainWakes();
    const group = await view(panel);
    const estimate = group.estimates[0]!;
    const run = panel.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=?").get(GROUP,estimate.estimateId)!;
    settleRun(panel.store,String(run.id),"settled-restartable");
    panel.service.completeEstimate(GROUP,estimate.estimateId,estimateOutput(group.plan.planHash));
    expect(panel.store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(GROUP)).toEqual([{state:"ready"}]);
  }
  return {panelFixture,confirm,overview,seedZeroQuestion,finishEstimate};
}
