import {canonicalBytes} from "../../src/control/canonicalJson.js";
import {createOverviewFixtures} from "./controlOverviewFixtures.js";
import { login, seedUser } from "./fixtures/auth.js";
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { command, createHarness, get, json, GROUP, revision, view, settleRun } from "./fixtures/controlPanel.js";
import { newRound, writeRound } from "../../src/control/requirementRecords.js";

const h = createHarness();
afterAll(() => h.dispose());
const {panelFixture,confirm,overview,seedZeroQuestion} = createOverviewFixtures(h);
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

  it("keeps an active blocked auxiliary run visible with its own reason and run identity", async () => {
    const {panel} = await panelFixture(); await panel.drainWakes();
    const row = panel.store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND active=1").get(GROUP)!;
    const run = JSON.parse(String(row.body));
    expect(run.phase).toBe("estimate");
    panel.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({...run,state:"blocked",failureCode:"estimator-interrupted"}),row.id);
    const body = await overview(panel);
    expect(body.steps.find(s=>s.runId===row.id)).toMatchObject({kind:"recovery-review",groupId:GROUP,taskId:null,reason:"estimator-interrupted",destination:{kind:"group",groupId:GROUP,region:"problem",runId:row.id,taskId:null}});
  });
  it("deduplicates a run blocker and the same unknown-usage fact without losing the stronger owner explanation", async () => {
    const {panel} = await panelFixture(); await confirm(panel);
    await command(panel,`/api/control/groups/${GROUP}/start`,{commandId:"start",expectedRevision:await revision(panel),payload:{}}); await panel.drainWakes();
    const row = panel.store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND work_item_id='a' AND active=1").get(GROUP)!;
    const run = JSON.parse(String(row.body));
    panel.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({...run,state:"unknown",unknown:{work:true,handoff:false}}),row.id);
    panel.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('usage-blocker',?,?,'run','usage-unknown',?)").run(GROUP,row.id,'{"evidenceIds":[]}');
    const body = await overview(panel);
    const matching = body.steps.filter(s=>s.kind==="recovery-review" && s.groupId===GROUP && s.runId===row.id && s.reason==="usage-unknown");
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({taskId:"a",ownerRequired:true});
  });
  it("does not overwrite owner-required usage recovery with a weaker blocked-run observation", async () => {
    const {panel} = await panelFixture(); await panel.drainWakes();
    const row = panel.store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND active=1").get(GROUP)!;
    const run = JSON.parse(String(row.body));
    panel.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({...run,state:"blocked",failureCode:"usage-unknown",unknown:{work:true,handoff:false}}),row.id);
    const matching = (await overview(panel)).steps.filter(s=>s.kind==="recovery-review" && s.runId===row.id && s.reason==="usage-unknown");
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ownerRequired:true});
  });

});


describe("overview stored authority review regressions", () => {
  it("isolates an estimate whose row state disagrees with its canonical body", async () => {
    const {panel} = await panelFixture(); seedZeroQuestion(panel,"healthy");
    panel.store.db.prepare("UPDATE estimates SET state='ready' WHERE group_id=?").run(GROUP);
    const body = await overview(panel);
    expect(body.issues.find(i=>i.groupId===GROUP)).toMatchObject({reason:"recovery-blocked"});
    expect(body.groups.some(g=>g.groupId===GROUP)).toBe(false);
    expect(body.groups.some(g=>g.groupId==="healthy")).toBe(true);
    expect(body.steps.some(s=>s.groupId===GROUP)).toBe(false);
  });
  it.each([
    ["malformed body", "ledger-corrupt", null, "broken"],
    ["empty code", "", null, '{"evidenceIds":[]}'],
    ["invalid run identity", "ledger-corrupt", "../bad", '{"evidenceIds":[]}'],
    ["noncanonical evidence", "ledger-corrupt", null, '{"evidenceIds":["z","a"]}'],
  ])("isolates ownerless global recovery with %s", async (_label,code,runId,storedBody) => {
    const {panel} = await panelFixture();
    panel.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('global-bad',NULL,?,'global',?,?)").run(runId,code,storedBody);
    panel.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('global-good',NULL,'unowned-run','global','global-valid',?)").run('{"evidenceIds":[]}');
    const body = await overview(panel);
    expect(body.steps.find(s=>s.reason==="global-valid")).toMatchObject({groupId:null,repoId:null,runId:"unowned-run",destination:{kind:"recovery"}});
    expect(body.groups.some(g=>g.groupId===GROUP)).toBe(true);
    expect(body.issues).toContainEqual({groupId:null,repoId:null,reason:"recovery-blocker-invalid"});
    expect(body.steps.some(s=>s.groupId===null && s.reason===code)).toBe(false);
  });
});


describe("overview canonical estimate proofs", () => {
  it.each(["estimateId","estimateVersion","requestHash","canonicalBytes"])("refuses altered %s without hiding another group", async field => {
    const {panel} = await panelFixture(); seedZeroQuestion(panel,"healthy");
    const row = panel.store.db.prepare("SELECT id,body FROM estimates WHERE group_id=?").get(GROUP)!;
    const record = JSON.parse(String(row.body));
    if (field === "estimateId") record.estimateId = "wrong-estimate";
    if (field === "estimateVersion") record.estimateVersion++;
    if (field === "requestHash") record.requestHash = "9".repeat(64);
    const bodyBytes = field === "canonicalBytes" ? JSON.stringify(record,null,2) : canonicalBytes(record).toString();
    panel.store.db.prepare("UPDATE estimates SET body=? WHERE group_id=? AND id=?").run(bodyBytes,GROUP,row.id);
    const body = await overview(panel);
    expect(body.issues.find(i=>i.groupId===GROUP)).toMatchObject({reason:"recovery-blocked"});
    expect(body.groups.some(g=>g.groupId==="healthy")).toBe(true);
    expect(body.groups.some(g=>g.groupId===GROUP)).toBe(false);
  });
});
