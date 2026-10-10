import { login, seedUser } from "./fixtures/auth.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { command, createHarness, get, json, GROUP, revision, view, claudeCodexResolveAgent, settleRun } from "./fixtures/controlPanel.js";
import { insertClarifyingGroup, newRound, newDraft, writeRound, writeDraft } from "../../src/control/requirementRecords.js";
import { clarifyingInput } from "../control/fixtures/requirement.js";
import { classifyClarifyOutput } from "../../src/control/requirementClarify.js";
import { ROUND_TWO } from "../control/fixtures/requirementOutputs.js";

const h = createHarness();
afterAll(() => h.dispose());
export async function panelFixture(twoIndependentTasks = false) {
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
export async function confirm(panel: Awaited<ReturnType<typeof panelFixture>>["panel"]) {
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
export async function overview(panel: Awaited<ReturnType<typeof panelFixture>>["panel"]) {
  const response = await get(panel, "/api/control/overview");
  expect(response.status).toBe(200);
  return await json(response) as {schema:string; epoch:string; groups:any[]; steps:any[]; issues:any[]};
}
export function seedZeroQuestion(panel: Awaited<ReturnType<typeof panelFixture>>["panel"], groupId = "zero-questions") {
  const classified = classifyClarifyOutput({ ...ROUND_TWO, slug: "markdown-export" }, { roundNo: 1, requirementId: "0123456789abcdef0123456789abcdef", earlierQuestionIds: [] });
  if (!classified.ok) throw new Error(classified.reason);
  panel.store.transaction(() => {
    insertClarifyingGroup(panel.store, clarifyingInput(groupId));
    panel.store.db.prepare("UPDATE groups SET revision=1 WHERE id=?").run(groupId);
    writeRound(panel.store, groupId, { ...newRound(1), state: "awaiting-answers", result: classified.result });
  });
}
describe("authenticated overview read", () => {
  it("serves stored facts without changing any database bytes or probing a model", async () => {
    const { panel, probe } = await panelFixture(); probe.mockClear();
    const dbBefore = readFileSync(join(panel.store.stateDir, "control.sqlite"));
    const body = await overview(panel);
    const dbAfter = readFileSync(join(panel.store.stateDir, "control.sqlite"));
    expect(body).toMatchObject({ schema: "orca-control-overview-v1", epoch: "overview-epoch", issues: [] });
    expect(dbAfter).toEqual(dbBefore);
    expect(probe).not.toHaveBeenCalled();
    expect((await get(panel, "/api/control/overview", "none")).status).toBe(401);
  });
  it("does not owe start when a ready group already has a pending or active start", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    expect((await overview(panel)).steps.some(s => s.kind === "start-review" && s.groupId === GROUP)).toBe(true);
    expect((await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "start", expectedRevision: await revision(panel), payload: {} })).status).toBe(202);
    const pending = await overview(panel);
    expect(pending.steps.some(s => s.kind === "start-review" && s.groupId === GROUP)).toBe(false);
    await panel.drainWakes();
    const body = await overview(panel), activeReadyId = GROUP;
    expect(body.groups.find(g => g.groupId === GROUP)?.state).toBe("ready");
    expect(body.steps.some(s => s.kind === 'start-review' && s.groupId === activeReadyId)).toBe(false);
  });
  it("owes the current awaiting-answers round even when there are zero questions", async () => {
    const { panel } = await panelFixture(); const zeroQuestionId = "zero-questions"; seedZeroQuestion(panel, zeroQuestionId);
    const body = await overview(panel);
    expect(body.steps.some(s => s.kind === 'requirement-answer' && s.groupId === zeroQuestionId)).toBe(true);
    expect(body.steps.find(s => s.groupId === zeroQuestionId)).toMatchObject({ destination: { kind: "requirement", groupId: zeroQuestionId, region: "answers" } });
  });
  it("isolates a corrupt group and omits archived work without fabricating completion", async () => {
    const { panel } = await panelFixture(); seedZeroQuestion(panel, "healthy");
    panel.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('bad',1,1,'broken')").run();
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.archived',json(?)) WHERE id=?").run(JSON.stringify({ at: 100, actor: "human" }), GROUP);
    const body = await overview(panel);
    expect(body.groups.some(g => g.groupId === "healthy")).toBe(true);
    expect(body.groups.some(g => g.groupId === GROUP)).toBe(false);
    expect(body.steps.some(s => s.groupId === GROUP)).toBe(false);
    expect(body.groups.some(g => g.groupId === "bad")).toBe(false);
    expect(body.issues.some(i => i.groupId === "bad" && i.reason.length > 0)).toBe(true);
  });
  it("shows owner-required work to members while keeping mutation permissions unchanged", async () => {
    const { panel } = await panelFixture();
    seedZeroQuestion(panel);
    panel.store.transaction(() => writeRound(panel.store, "zero-questions", { ...newRound(1), waiting:"requirement-budget-exhausted" }));
    seedUser(join(panel.root,"accounts"), "member", "member");
    const member = await login(panel.url,"member");
    const response = await member.fetch("/api/control/overview"); expect(response.status).toBe(200);
    const body = await json(response);
    expect((body.steps as any[]).find(s => s.groupId === "zero-questions")).toMatchObject({ kind:"requirement-attention", reason:"requirement-budget-exhausted", ownerRequired:true });
    const denied = await member.fetch("/api/control/groups/zero-questions/set-limit", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({commandId:"member-limit",expectedRevision:1,payload:{limit:{tokens:20_000_000,activeMs:14_400_000,attempts:40,sessions:40}}})});
    expect(denied.status).toBe(403);
  });

  it("omits an actually archived group before decoding corrupt historical work and runs", async () => {
    const {panel} = await panelFixture(); seedZeroQuestion(panel,"healthy");
    const archived = await command(panel,`/api/control/groups/${GROUP}/archive`, {commandId:"archive",expectedRevision:await revision(panel),payload:{}});
    expect(archived.status).toBe(200);
    panel.store.db.prepare("UPDATE work_items SET body='broken archived work' WHERE group_id=?").run(GROUP);
    panel.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('archived-run',?,'a',1,0,'broken archived run')").run(GROUP);
    const body = await overview(panel);
    expect(body.groups.some(g=>g.groupId===GROUP)).toBe(false);
    expect(body.steps.some(s=>s.groupId===GROUP)).toBe(false);
    expect(body.issues.some(i=>i.groupId===GROUP)).toBe(false);
    expect(body.groups.some(g=>g.groupId==="healthy")).toBe(true);
  });
  it("keeps invalid archive authority as an explicit issue without hiding healthy groups", async () => {
    const {panel} = await panelFixture(); seedZeroQuestion(panel,"healthy");
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.archived',json(?)) WHERE id=?").run(JSON.stringify({at:"invalid",actor:"human"}),GROUP);
    const body = await overview(panel);
    expect(body.issues.find(i=>i.groupId===GROUP)).toMatchObject({reason:"group-archived-invalid"});
    expect(body.groups.some(g=>g.groupId==="healthy")).toBe(true);
  });

  it("excludes active-ready independently of estimates or pending wakes while another task is claimable", async () => {
    const {panel} = await panelFixture(true);
    await panel.drainWakes();
    const estimate = (await view(panel)).estimates[0]!;
    const estimateRun = panel.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=?").get(GROUP,estimate.estimateId)!;
    settleRun(panel.store,String(estimateRun.id),"settled-restartable");
    panel.service.completeEstimate(GROUP,estimate.estimateId,null);
    await confirm(panel);
    expect((await overview(panel)).steps.some(s=>s.kind==="start-review")).toBe(true);
    await command(panel,`/api/control/groups/${GROUP}/start`,{commandId:"start",expectedRevision:await revision(panel),payload:{}});
    await panel.drainWakes();
    const body = await overview(panel), activeReadyId = GROUP;
    expect(body.groups.find(g=>g.groupId===GROUP)).toMatchObject({state:"ready",counts:{idle:1,running:1,waiting:0,blocked:0,done:0}});
    expect(panel.store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(GROUP)).toEqual([{state:"failed"}]);
    expect(panel.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id=? AND delivered=0").all(GROUP)).toEqual([]);
    expect(panel.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").all(GROUP)).toHaveLength(1);
    expect(panel.store.db.prepare("SELECT active FROM runs WHERE id=?").get(estimateRun.id)?.active).toBe(0);
    expect(body.steps.some(s => s.kind === 'start-review' && s.groupId === activeReadyId)).toBe(false);
  });

});
