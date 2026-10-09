import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve, isAbsolute, dirname, basename, relative } from "node:path";
import { openControlStore, type ControlStore } from "../../../src/control/store.js";
import { createAdmissionGate } from "../../../src/control/admissionGate.js";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { importControlPlan, prepareEstimatorSlot, type ImportCommand } from "../../../src/control/planImport.js";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import { resolveGroupSelections } from "../../../src/control/agentFreeze.js";
import { applySetAgentPreferences } from "../../../src/control/agentPreferences.js";
import { readArchivedPlan, readBudgetProposal } from "../../../src/control/queries.js";
import { createGroup } from "../../../src/control/commands.js";
import { createWebWakeHandlers, deliverScheduledStart } from "../../../src/control/webDispatch.js";
import { WebControlService } from "../../../src/control/webService.js";
import { recordActivity } from "../../../src/control/activity.js";
import { advance, type ExecutionDriverDeps } from "../../../src/control/executionDriver.js";
import { controlWorkspaceRoots } from "../../../src/control/workspace.js";
import { fakeCcloopPort } from "./driverPort.js";
import type { ExecutionPort } from "../../../src/control/executionPort.js";
import type { ExecutionProfileSnapshotV1, RawAuthorityCommandV1 } from "../../../src/control/webProtocol.js";
export const performanceRoot = () => process.env.ORCA_PERFORMANCE_ROOT ?? "/private/tmp/od9/performance-fixture";
/** Writable fixture setup is confined to temporary namespaces, including canonical symlink targets. */
async function assertTemporaryFixtureRoot(root:string):Promise<void> {
 if(!isAbsolute(root))throw new Error("control-poll-fixture-root-must-be-absolute");
 const canonical=async(path:string):Promise<string>=>{
  const suffix:string[]=[];let parent=resolve(path);
  for(;;){try{return join(await realpath(parent),...suffix.reverse());}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;const next=dirname(parent);if(next===parent)throw error;suffix.push(basename(parent));parent=next;}}
 };
 const candidate=await canonical(root),temporaryRoots=await Promise.all([tmpdir(),"/tmp","/private/tmp"].map(canonical));
 if(!temporaryRoots.some(parent=>{const path=relative(parent,candidate);return path!==""&&path!==".."&&!path.startsWith("../")&&!isAbsolute(path);}))throw new Error("control-poll-fixture-root-not-temporary");
}
export interface ControlPollFixture {
 store: ControlStore;
 wakeDeps: Parameters<typeof createWebWakeHandlers>[0];
 driverDeps: Pick<ExecutionDriverDeps, "store" | "admissionGate">;
 service: WebControlService;
 liveGroupIds: readonly string[];
 archivedGroupIds: readonly string[];
 canonicalRunIds: ReadonlyMap<string,string>;
 manifest(): { liveGroups: number; archivedGroups: number; tasks: number; dependencies: number; runs: number; pendingTargetWakes: number };
 dispose(): Promise<void>;
}
export function dagTasks(n: number) {
 return Array.from({length:n}, (_,i) => ({taskId:`t${String(i).padStart(2,"0")}`, dependsOn: i===0 ? [] : i===1 ? ["t00"] : [`t${String(i-1).padStart(2,"0")}`,`t${String(i-2).padStart(2,"0")}`]}));
}
export const profileSnapshot = (): ExecutionProfileSnapshotV1 => ({
  schema: "orca-execution-profile-snapshot-v2",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000,
      requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["tokens"], handoffDimensions: [], evidenceKind: "proof" } },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { proofDocumentContentHashes: ["c".repeat(64)], tokenizerArtifactHashes: [], secretValueHashes: [] },
});


function checked(value: any) { if (value && "error" in value) throw new Error(JSON.stringify(value)); return value; }
function command(store: ControlStore, groupId: string, verb: RawAuthorityCommandV1["verb"], payload: unknown): any {
 return {schema:"orca-raw-command-v1",commandId:`${groupId}-${verb}`,expectedRevision:Number(store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)?.revision ?? 0),actorId:"human",verb,target:{kind:"group",groupId},payload};
}
export async function buildControlPollFixture(options: {liveGroups:number;archivedGroups:number;tasksPerGroup:number;now:number}): Promise<ControlPollFixture> {
 const root=performanceRoot(), repo=join(root,"repo");
 await assertTemporaryFixtureRoot(root);
 // Setup never resets an existing dataset or deletes an env-selected path.
 if(!isAbsolute(root))throw new Error("control-poll-fixture-root-must-be-absolute");
 const existingRoot=await lstat(root).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
 if(existingRoot && (!existingRoot.isDirectory() || (await readdir(root)).length > 0)) throw new Error("control-poll-fixture-root-not-empty");
 await mkdir(root,{recursive:true,mode:0o700}); await mkdir(repo,{mode:0o700});
 let fixtureClock=options.now; const store=await openControlStore({stateDir:join(root,"state"),now:()=>fixtureClock});
 const snapshot=profileSnapshot();
 const port=createFixturePort(snapshot);
 const supplied=resolveProfile(snapshot,port), router=createExecutionProfileRouter([supplied]), frozen=router.resolve("budget-estimate","all",supplied.profileHash);
 const admissionGate=createAdmissionGate(), planPath=join(root,"plan.json");
 checked(applySetAgentPreferences({store},{schema:"orca-raw-command-v1",commandId:"preferences",expectedRevision:0,actorId:"human",verb:"set-agent-preferences",target:{kind:"operator",operatorId:"human"},payload:{preferences:{defaultAgent:"codex",perAgent:{}}}}));
 const deps={store,port,profileRouter:router,admissionGate,now:()=>new Date(options.now),trustedConfig:{resolveTarget:()=>({repositoryPath:repo,planPath,validatePlanDescriptor(){}})},defaults:()=>({estimatorProfileId:"all",estimatorProfileHash:frozen.profileHash,estimateMode:"soft" as const})};
 const service=new WebControlService(deps);
 const liveGroupIds=Array.from({length:options.liveGroups},(_,i)=>`live-${String(i).padStart(3,"0")}`), archivedGroupIds=Array.from({length:options.archivedGroups},(_,i)=>`archive-${String(i).padStart(3,"0")}`);
 try {
 const planTasks=[];
 for(const task of dagTasks(options.tasksPerGroup)) {
    const contract = { objective: { taskId: task.taskId, goal: "ship", successCondition: "passes", nonGoals: [] },
      context: { repoPath: repo, targetPaths: [task.taskId], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
      verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] } };

 const contractPath=join(root,`contract-${task.taskId}.json`); await writeFile(contractPath,canonicalBytes(contract),{mode:0o600});
 planTasks.push({...task,targetVersion:1,contract:contractPath});
 }
 await writeFile(planPath,JSON.stringify({targetRepo:repo,ccloopBin:"/bin/true",runsDir:root,workBranch:"orca/work",policy:"local-merge",ledgerMode:"out-of-repo",goal:"ship",successConditions:["passes"],tasks:planTasks}),{mode:0o600});
 for(const groupId of liveGroupIds) {
  const cmd:ImportCommand={schema:"orca-raw-command-v1",commandId:`${groupId}-import`,expectedRevision:0,actorId:"human",verb:"import-plan",target:{kind:"group",groupId},payload:{groupId,repoId:"repo",planId:"plan"}};
  const prepared=await prepareEstimatorSlot({store,profileRouter:router},cmd,frozen);
  checked(importControlPlan({...deps,estimatorSlot:prepared.outcome,estimatorObservation:()=>({profile:frozen,observed:snapshot.profile.capabilities,probeFailureCode:null,resolution:prepared.observation.resolution})},cmd));
  const selections=await resolveGroupSelections({store,port},groupId,"human");
  checked(await service.confirm(command(store,groupId,"confirm",{planHash:readArchivedPlan(store,groupId).planHash,proposalVersion:readBudgetProposal(store,groupId).proposalVersion,budgetMode:"soft",profileIds:{estimator:"all",worker:"all",handoff:"all",goalReview:"all"},profileHashes:{estimator:frozen.profileHash,worker:frozen.profileHash,handoff:frozen.profileHash,goalReview:frozen.profileHash},contextPolicy:{handoffAtContextTokens:800000},selectionsHash:selections.selectionsHash})));
  checked(await service.start(command(store,groupId,"start",{})));
  const claimed=await deliverScheduledStart(deps,groupId); assert.equal(claimed.kind,"claimed");
  if(claimed.kind!=="claimed") throw new Error(JSON.stringify(claimed));
  store.transaction(()=>{recordActivity(store,{groupId,runId:claimed.runId,kind:"phase",body:{stage:"first"}});fixtureClock=options.now-1;recordActivity(store,{groupId,runId:claimed.runId,kind:"phase",body:{stage:"latest"}});fixtureClock=options.now;});
 }
 // Complete t00 legally in the first group, retaining its displayed current run and making t01 claimable.
 if(liveGroupIds.length && options.tasksPerGroup>1) {
  const git=(...args:string[])=>execFileSync("/usr/bin/git",["-c","user.name=fixture","-c","user.email=fixture@example.invalid","-c","core.hooksPath=/dev/null",...args],{cwd:repo,encoding:"utf8"});
  git("init","-q","-b","main"); await writeFile(join(repo,"base.txt"),"base\n",{mode:0o600}); git("add","base.txt"); git("commit","-qm","base");
  const fake=fakeCcloopPort({capabilities:snapshot.profile.capabilities,behaviour:()=>"succeed",files:()=>({t00:"t00\n"})});
  const full:ExecutionDriverDeps={store,router:createExecutionProfileRouter([resolveProfile(snapshot,fake.port)]),admissionGate,roots:controlWorkspaceRoots(store.stateDir),resolveRepository:()=>repo,ccloopBin:process.env.ORCA_PERFORMANCE_FAKE_CCLOOP ?? resolve("tests/control/fixtures/fake-ccloop-run.mjs"),agentsTablePath:join(root,"agents.json")};
  const runId=String(store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(liveGroupIds[0])!.id);
  const context={reconciling:new Map<string,Promise<void>>(),stopped:false};
  for(let i=0;i<60;i++) { const body=JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)); if(body.state==="settled") break; await advance(full,runId,context); }
  assert.equal(JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).state,"settled");
 }
 await writeFile(planPath,JSON.stringify({targetRepo:repo,ccloopBin:"/bin/true",runsDir:root,workBranch:"orca/work",policy:"local-merge",ledgerMode:"out-of-repo",goal:"ship",successConditions:["passes"],tasks:planTasks.slice(0,1)}),{mode:0o600});
 for(const groupId of archivedGroupIds) {
  const cmd:ImportCommand={schema:"orca-raw-command-v1",commandId:`${groupId}-import`,expectedRevision:0,actorId:"human",verb:"import-plan",target:{kind:"group",groupId},payload:{groupId,repoId:"repo",planId:"archive-plan"}};
  const prepared=await prepareEstimatorSlot({store,profileRouter:router},cmd,frozen);
  checked(importControlPlan({...deps,estimatorSlot:prepared.outcome,estimatorObservation:()=>({profile:frozen,observed:snapshot.profile.capabilities,probeFailureCode:null,resolution:prepared.observation.resolution})},cmd));
  checked(service.archiveGroup(command(store,groupId,"archive-group",{})));
  for(const kind of ["start","no-start","resume"]) store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,?,?,0)").run(`${groupId}:${kind}`,groupId,kind,JSON.stringify({groupId,startRevision:1}));
 }
 // Queued estimator work is outside the target wake workload; preserve it as delivered fixture history.
 store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE kind='budget-estimate'").run();
 return connectFixture(store,service,{...deps,service},liveGroupIds,archivedGroupIds);
 } catch(error) {store.close();throw error;}
}
export function connectFixture(store:ControlStore,service:WebControlService,wakeDeps:ControlPollFixture["wakeDeps"],liveGroupIds:readonly string[],archivedGroupIds:readonly string[]):ControlPollFixture {
 const canonicalRunIds=new Map<string,string>();
 for(const row of store.db.prepare("SELECT id,body FROM runs ORDER BY rowid").all()) {const run=JSON.parse(String(row.body));canonicalRunIds.set(String(row.id),`${run.groupId}/${run.taskId}/${run.claimOrdinal}`);}
 return {store,service,wakeDeps,driverDeps:{store,admissionGate:wakeDeps.admissionGate},liveGroupIds,archivedGroupIds,canonicalRunIds,
 manifest(){let dependencies=0;for(const row of store.db.prepare("SELECT body FROM work_items WHERE group_id LIKE 'live-%'").all()) dependencies+=JSON.parse(String(row.body)).dependsOn?.length??0;const count=(sql:string)=>Number(store.db.prepare(sql).get()!.n);return {liveGroups:liveGroupIds.length,archivedGroups:archivedGroupIds.length,tasks:count("SELECT COUNT(*) AS n FROM work_items WHERE group_id LIKE 'live-%'"),dependencies,runs:count("SELECT COUNT(*) AS n FROM runs"),pendingTargetWakes:count("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE delivered=0 AND kind IN ('start','no-start','resume')")};},
 async dispose(){store.close();}}
}
export function assertMeasurementCoverage(fixture:ControlPollFixture):void {
 const m=fixture.manifest();assert.equal(m.liveGroups,100);assert.equal(m.archivedGroups,100);assert.equal(m.tasks,5000);assert.equal(m.dependencies,9700);assert.equal(m.runs,100);assert.equal(m.pendingTargetWakes,300);
 for(const groupId of fixture.liveGroupIds) {
  const tasks=fixture.store.db.prepare("SELECT id,body FROM work_items WHERE group_id=? ORDER BY id").all(groupId);assert.equal(tasks.length,50);
  tasks.forEach((row,i)=>assert.deepEqual(JSON.parse(String(row.body)).dependsOn,[...dagTasks(50)[i].dependsOn].sort()));
  assert.equal(Number(fixture.store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE group_id=? AND json_extract(body,'$.currentRunId') IS NOT NULL").get(groupId)!.n)>=1,true);
  assert.equal(Number(fixture.store.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE group_id=?").get(groupId)!.n)>0,true);
 }
 for(const groupId of fixture.archivedGroupIds) assert.deepEqual(fixture.store.db.prepare("SELECT kind FROM scheduler_wakes WHERE group_id=? AND delivered=0 ORDER BY kind").all(groupId).map(r=>r.kind),["no-start","resume","start"]);
}

function createFixturePort(snapshot:ExecutionProfileSnapshotV1):ExecutionPort {
 return {
  resolveAgent:async partial=>({selection:{agent:"codex",model:"fixture-model",contextWindow:"agent-default",...partial},configHash:sha256Canonical({}),timeoutMs:120_000,killGraceMs:5000,capabilities:snapshot.profile.capabilities,singleCallExecution:"v1"}),
  listAgents:async()=>({installations:[{id:"codex",kind:"codex",defaults:{model:"fixture-model",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"0.0.0-fixture"}]}),
  accept:async()=>({kind:"unknown"}), inspect:async()=>({kind:"unknown"}), collect:async()=>({events:[],candidate:null,terminal:null}),readEvidence:async()=>Buffer.alloc(0),requestHandoff:async(_e,request)=>({kind:"unknown",requestId:request.requestId})
 };
}

/** Reopen the exact same initial database/evidence namespace; no fixture contracts are regenerated. */
export async function openExistingControlPollFixture(now:number):Promise<ControlPollFixture> {
 await assertTemporaryFixtureRoot(performanceRoot());
 const store=await openControlStore({stateDir:join(performanceRoot(),"state"),now:()=>now});
 store.dispatchBlocked=false;
 const port=createFixturePort(profileSnapshot()), supplied=resolveProfile(profileSnapshot(),port), profileRouter=createExecutionProfileRouter([supplied]),admissionGate=createAdmissionGate();
 const deps={store,port,profileRouter,admissionGate,now:()=>new Date(now),trustedConfig:{resolveTarget:()=>({repositoryPath:join(performanceRoot(),"repo"),planPath:join(performanceRoot(),"plan.json"),validatePlanDescriptor(){}})},defaults:()=>({estimatorProfileId:"all",estimatorProfileHash:supplied.profileHash,estimateMode:"soft" as const})};
 const service=new WebControlService(deps);
 const ids=store.db.prepare("SELECT id FROM groups ORDER BY id").all().map(r=>String(r.id));
 return connectFixture(store,service,{...deps,service},ids.filter(id=>id.startsWith("live-")),ids.filter(id=>id.startsWith("archive-")));
}
