import {createOverviewFixtures} from "./controlOverviewFixtures.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { command, createHarness, get, json, GROUP, revision, view } from "./fixtures/controlPanel.js";
import { newRound, newDraft, writeRound, writeDraft } from "../../src/control/requirementRecords.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";

const h = createHarness();
afterAll(() => h.dispose());
const {panelFixture,confirm,overview,seedZeroQuestion,finishEstimate} = createOverviewFixtures(h);
describe("overview human work rules", () => {
  it("keeps queued estimates out of human preparation and preserves current split review identity", async () => {
    const { panel } = await panelFixture(); seedZeroQuestion(panel, "split");
    panel.store.transaction(() => { writeRound(panel.store, "split", { ...newRound(1), state: "answered" }); writeDraft(panel.store, "split", { ...newDraft(2, 0), state: "awaiting-review" }); });
    const body = await overview(panel);
    expect(body.steps.some(s => s.kind === "budget-review")).toBe(false);
    expect(body.steps.find(s => s.kind === "requirement-review")).toMatchObject({ groupId: "split", destination: { kind: "requirement", groupId: "split", region: "draft" } });
    panel.store.transaction(() => writeDraft(panel.store, "split", { ...newDraft(2, 0), state: "accepted" }));
    expect((await overview(panel)).steps.some(s => s.kind === "requirement-review" && s.groupId === "split")).toBe(false);
  });
  it("counts plan tasks while retaining failed and held task identities, and keeps goal review separate", async () => {
    const paths = await h.workspace();
    const plan = JSON.parse(readFileSync(paths.planPath, "utf8"));
    const first = JSON.parse(readFileSync(plan.tasks[0].contract, "utf8"));
    first.objective.taskId = "b"; first.context.targetPaths = ["b.ts"];
    const contract = join(plan.tasks[0].contract, "..", "b.json"); writeFileSync(contract, JSON.stringify(first));
    plan.tasks.push({ taskId: "b", contract, dependsOn: ["a"], targetVersion: 1 }); writeFileSync(paths.planPath, JSON.stringify(plan));
    const panel = await h.boot("overview-epoch", paths);
    const imported = await command(panel, "/api/control/groups/import-plan", { commandId: "import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','done') WHERE group_id=? AND id='a'").run(GROUP);
    const bodyA = String(panel.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='a'").get(GROUP)!.body);
    panel.store.db.prepare("INSERT INTO work_items(id,group_id,target_version,body) VALUES ('auxiliary',?,1,?)").run(GROUP, bodyA);
    const body = await overview(panel), planWithAuxiliaryWorkId = GROUP;
    expect(body.groups.find(g => g.groupId === planWithAuxiliaryWorkId)?.completion).toEqual({done:1,total:2});
    panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','held') WHERE group_id=? AND id='b'").run(GROUP);
    expect((await overview(panel)).steps.find(s => s.taskId === "b")).toMatchObject({ kind: "task-attention", reason: "task-held", runId: null });
    panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','blocked') WHERE group_id=? AND id='b'").run(GROUP);
    expect((await overview(panel)).steps.find(s => s.taskId === "b")).toMatchObject({ kind: "task-attention", reason: "task-blocked" });
    panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','done') WHERE group_id=? AND id='b'").run(GROUP);
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','review') WHERE id=?").run(GROUP);
    expect((await overview(panel)).groups[0]).toMatchObject({ state: "review", completion: {done:2,total:2} });
    expect((await overview(panel)).steps.some(s => s.kind === "start-review")).toBe(false);
  });
  it("preserves recovery, stop, and integration reasons and sorts exceptions before preparation", async () => {
    const { panel } = await panelFixture();
    await finishEstimate(panel);
    let body = await overview(panel);
    expect(body.steps.find(s => s.kind === "budget-review")).toMatchObject({ destination: { kind: "group", region: "preparation" }, ownerRequired: false });
    const integration = newGroupIntegration({delivery:"local", target:"main", method:"merge", trigger:"group"})!;
    integration.state = "conflict"; integration.reason = "integration-conflict";
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.integration',json(?),'$.stopped',json('true')) WHERE id=?").run(JSON.stringify(integration), GROUP);
    panel.store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,'pause',1,?)").run(GROUP, canonicalBytes({ mode:"pause", state:"paused", frozenRunIds:[], acceptedAt:null, deadlineAt:null }).toString());
    panel.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('one',?,NULL,'group','ledger-corrupt',?),('two',?,NULL,'group','ledger-corrupt',?),('three',?,NULL,'group','claim-unknown',?)").run(GROUP, '{"evidenceIds":[]}', GROUP, '{"evidenceIds":[]}', GROUP, '{"evidenceIds":[]}');
    body = await overview(panel);
    expect(body.steps.filter(s => s.kind === "recovery-review").map(s => s.reason).sort()).toEqual(["claim-unknown", "ledger-corrupt"]);
    expect(body.steps.find(s => s.kind === "stop-review")).toMatchObject({ reason: "paused" });
    expect(body.steps.find(s => s.kind === "integration-review")).toMatchObject({ reason:"integration-conflict", ownerRequired:true });
    expect(body.steps.at(-1)?.kind).toBe("budget-review");
    expect((await overview(panel)).steps).toEqual(body.steps);
  });
  it("routes accepted export problems to Requirements and excludes pending export from start", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    seedZeroQuestion(panel, "source-requirement");
    const requirementBody = JSON.parse(String(panel.store.db.prepare("SELECT body FROM groups WHERE id='source-requirement'").get()!.body));
    const requirement = {...requirementBody.requirement, acceptedDraftNo:1, export:{state:"conflict", path:null, commit:null, parent:null, detail:"document changed"}};
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.requirement',json(?)) WHERE id=?").run(JSON.stringify(requirement), GROUP);
    let body = await overview(panel);
    expect(body.steps.find(s => s.groupId === GROUP && s.kind === "requirement-attention")).toMatchObject({ destination:{kind:"requirement", groupId:GROUP, region:"problem"} });
    expect(body.steps.some(s => s.groupId === GROUP && s.kind === "requirement-review")).toBe(false);
    expect(body.steps.some(s => s.groupId === GROUP && s.kind === "start-review")).toBe(false);
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.requirement.export.state','pending') WHERE id=?").run(GROUP);
    body = await overview(panel);
    expect(body.steps.some(s => s.groupId === GROUP && s.kind === "start-review")).toBe(false);
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.requirement.export.state','done') WHERE id=?").run(GROUP);
    expect((await overview(panel)).steps.some(s => s.groupId === GROUP && s.kind === "start-review")).toBe(true);
  });
  it("requires idle claimable work and excludes stop, held, continuing, unknown usage and pending resume", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    for (const status of ["active", "start-unknown", "held", "continuing", "blocked"]) {
      panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status',?) WHERE group_id=? AND id='a'").run(status, GROUP);
      expect((await overview(panel)).steps.some(s => s.kind === "start-review")).toBe(false);
    }
    panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','ready') WHERE group_id=? AND id='a'").run(GROUP);
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.ledger.usageUnknown',json('true')) WHERE id=?").run(GROUP);
    expect((await overview(panel)).steps.some(s => s.kind === "start-review")).toBe(false);
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.ledger.usageUnknown',json('false')) WHERE id=?").run(GROUP);
    panel.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('resume-test',?,'resume','{}',0)").run(GROUP);
    expect((await overview(panel)).steps.some(s => s.kind === "start-review")).toBe(false);
  });

  it("preserves active run failure and unknown-usage identity and observes a handoff still settling", async () => {
    const {panel} = await panelFixture(); await confirm(panel);
    await command(panel, `/api/control/groups/${GROUP}/start`, {commandId:"start",expectedRevision:await revision(panel),payload:{}}); await panel.drainWakes();
    const run = panel.store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND active=1").get(GROUP)!;
    const original = JSON.parse(String(run.body));
    const changed = {...original,state:"unknown",failureCode:"adapter-unanswered",unknown:{work:true,handoff:false}};
    panel.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(changed),run.id);
    let body = await overview(panel);
    expect(body.steps.find(s => s.runId === run.id)).toMatchObject({kind:"recovery-review",taskId:"a",reason:"usage-unknown",ownerRequired:true});
    panel.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({...original,state:"blocked",failureCode:"provider-crashed"}),run.id);
    body = await overview(panel);
    expect(body.steps.find(s => s.taskId === "a")).toMatchObject({kind:"task-attention",runId:run.id,reason:"provider-crashed"});
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.stopped',json('true')) WHERE id=?").run(GROUP);
    panel.store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,'handoff',1,?)").run(GROUP,canonicalBytes({mode:"handoff",state:"handoff-pending",frozenRunIds:[run.id],acceptedAt:"2026-10-10T00:00:00.000Z",deadlineAt:"2026-10-10T00:01:00.000Z"}).toString());
    expect((await overview(panel)).steps.find(s=>s.kind==="stop-review")).toMatchObject({reason:"handoff-pending"});
  });
  it("keeps ownerless global recovery global and isolates malformed work without zero-task claims", async () => {
    const {panel} = await panelFixture(); seedZeroQuestion(panel,"healthy");
    panel.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('global-one',NULL,NULL,'global','store-recovery',?)").run('{"evidenceIds":[]}');
    panel.store.db.prepare("UPDATE work_items SET body='broken' WHERE group_id=?").run(GROUP);
    const body = await overview(panel);
    expect(body.steps.find(s => s.reason === "store-recovery")).toMatchObject({groupId:null,repoId:null,destination:{kind:"recovery"}});
    expect(body.issues.find(i=>i.groupId===GROUP)).toBeDefined();
    expect(body.groups.some(g=>g.groupId===GROUP)).toBe(false);
    expect(body.groups.some(g=>g.groupId==="healthy")).toBe(true);
  });

  it("reads shared canonical contract hashes across groups and refuses missing or tampered contracts", async () => {
    const { panel } = await panelFixture(); seedZeroQuestion(panel,"healthy");
    const imported = await command(panel,"/api/control/groups/import-plan", {commandId:"shared-import",expectedRevision:0,payload:{groupId:"shared",repoId:"repo",planId:"plan"}});
    expect(imported.status).toBe(201);
    let body = await overview(panel);
    expect(body.issues).toEqual([]);
    expect(body.groups.filter(g=>g.groupId===GROUP || g.groupId==="shared").map(g=>g.completion)).toEqual([{done:0,total:1},{done:0,total:1}]);
    const plan = readArchivedPlan(panel.store,GROUP);
    expect(() => readArchivedPlan(panel.store,GROUP,new Map([[plan.planHash,plan.canonicalJson]]))).toThrow();
    const hash = plan.plan.tasks[0]!.originalContractHash;
    const contract = panel.store.db.prepare("SELECT hash,group_id,body FROM execution_snapshots WHERE hash=?").get(hash)!;
    panel.store.db.prepare("DELETE FROM execution_snapshots WHERE hash=?").run(hash);
    body = await overview(panel);
    expect(body.issues.filter(i=>i.groupId===GROUP || i.groupId==="shared")).toHaveLength(2);
    expect(body.groups.some(g=>g.groupId===GROUP || g.groupId==="shared")).toBe(false);
    expect(body.groups.some(g=>g.groupId==="healthy")).toBe(true);
    panel.store.db.prepare("INSERT INTO execution_snapshots(hash,group_id,body) VALUES (?,?,?)").run(contract.hash,contract.group_id,'{}');
    body = await overview(panel);
    expect(body.issues.filter(i=>i.groupId===GROUP || i.groupId==="shared")).toHaveLength(2);
    panel.store.db.prepare("UPDATE execution_snapshots SET body=? WHERE hash=?").run(contract.body,hash);
    expect((await overview(panel)).issues).toEqual([]);
  });

  it("does not advertise start while an estimate has an unresolved launch", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    panel.store.db.prepare("UPDATE estimates SET state='start-unknown',body=json_set(body,'$.state','start-unknown') WHERE group_id=?").run(GROUP);
    const body = await overview(panel);
    expect(body.steps.some(s=>s.kind==="start-review")).toBe(false);
  });
  it("rejects a task borrowing an auxiliary run instead of attributing that run's attention to it", async () => {
    const {panel} = await panelFixture(); await confirm(panel);
    await command(panel, `/api/control/groups/${GROUP}/start`, {commandId:"start",expectedRevision:await revision(panel),payload:{}}); await panel.drainWakes();
    const row = panel.store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").get(GROUP)!;
    const original = JSON.parse(String(row.body));
    const auxiliary = {...original,runId:"auxiliary-run",workItemId:"auxiliary",taskId:null,phase:"handoff",state:"blocked",failureCode:"auxiliary-failed"};
    panel.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('auxiliary-run',?,'auxiliary',1,0,?)").run(GROUP,JSON.stringify(auxiliary));
    panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.currentRunId','auxiliary-run') WHERE group_id=? AND id='a'").run(GROUP);
    const body = await overview(panel);
    expect(body.issues.some(i=>i.groupId===GROUP)).toBe(true);
    expect(body.steps.some(s=>s.taskId==="a" && s.reason==="auxiliary-failed")).toBe(false);
  });

});
