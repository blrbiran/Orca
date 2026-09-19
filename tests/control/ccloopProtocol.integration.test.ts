import { execFile } from "node:child_process";
import { readFile, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { readArtifact } from "../../src/control/archive.js";
import { createGroup, hashPayload, putWork } from "../../src/control/commands.js";
import { startClaim } from "../../src/control/dispatch.js";
import { buildGroupHandoff } from "../../src/control/handoff.js";
import { getRun, readGroup } from "../../src/control/queries.js";
import { collectControlled } from "../../src/control/schedulerBridge.js";
import { ControlService } from "../../src/control/service.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { crashCase } from "./fixtures/crashCase.js";

const exec = promisify(execFile);
const binary = process.env.ORCA_CCLOOP_BIN;
const adapterConfigPath = process.env.ORCA_CCLOOP_ADAPTER_CONFIG;
const formal = process.env.ORCA_CONTROL_VERIFY === "1";
if (formal && (!binary || !adapterConfigPath)) throw new Error("formal control verification requires ORCA_CCLOOP_BIN and ORCA_CCLOOP_ADAPTER_CONFIG");

const amount = (tokens:number,activeMs:number,attempts:number,sessions:number)=>({tokens,activeMs,attempts,sessions});
const sleep = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function git(repo:string,...args:string[]) {return (await exec("git",["-C",repo,...args],{env:{...process.env,GIT_AUTHOR_NAME:"Control Test",GIT_AUTHOR_EMAIL:"control@example.invalid",GIT_COMMITTER_NAME:"Control Test",GIT_COMMITTER_EMAIL:"control@example.invalid"}})).stdout.trim();}

describe.skipIf(!binary || !adapterConfigPath)("real ccloop protocol",()=>{
 let root:string,target:string,runs:string,store:ControlStore,service:ControlService,configHash:string;
 beforeAll(async()=>{
  root=await realpath(await mkdtemp(join(tmpdir(),"orca-real-ccloop-")));target=join(root,"target");runs=join(root,"runs");
  await mkdir(target,{mode:0o700});await mkdir(runs,{mode:0o700});await git(target,"init","-q");
  await writeFile(join(target,"answer.txt"),"0\n");await writeFile(join(target,"check.cjs"),'if(require("fs").readFileSync("answer.txt","utf8")!=="42\\n")process.exit(1);\n');
  await git(target,"add",".");await git(target,"commit","-qm","base");
  store=await openControlStore({stateDir:join(root,"state")});
  const config=JSON.parse(await readFile(adapterConfigPath!,"utf8"));configHash=hashPayload(config);
  const check=`${process.execPath} check.cjs`;
  const contract={objective:{taskId:"T1",goal:"Set answer.txt to 42",successCondition:"answer is 42",nonGoals:[]},context:{repoPath:target,targetPaths:["answer.txt"],relevantDocs:[],buildTestCommands:[check],constraints:[]},executionPolicy:{autonomyLevel:"L2",maxAttempts:1,perAttemptTimeoutMs:30000,totalRuntimeBudgetMs:120000,tokenBudget:1000,worktreeRequired:true,partialOutcomeRecoveryWindowMs:100},safetyPolicy:{allowlistPaths:["answer.txt"],denylistPaths:[],maxFilesTouched:2,humanGateConditions:[]},verification:{verifierType:"agent",requiredChecks:[check],rejectOn:["failure"],evidenceRequired:[]},escalationAndExit:{escalationTargets:[],pauseOn:[],stopOn:[],terminalStates:["succeeded","blocked_waiting_human","exhausted","cancelled","failed"]}};
  createGroup(store,{groupId:"g1",projectKey:"fixture/repo",goal:"Ship",successConditions:["checks pass"],budgetMode:"soft",limit:amount(5000,300000,20,20),reviewReserve:amount(0,0,0,0),deadlineAt:null},{commandId:"create",expectedRevision:0,by:"test"});
  putWork(store,"g1",{workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract,configHash,grant:{work:amount(2000,120000,6,3),handoff:amount(200,30000,1,1)}},{commandId:"task",expectedRevision:1,by:"test"});
  service=new ControlService(store,createCcloopExecutionPort({binary:await realpath(binary!),adapter:"codex",adapterConfigPath:await realpath(adapterConfigPath!),timeoutMs:15000}));
 },120000);
 afterAll(async()=>{store?.close();if(root&&process.env.ORCA_KEEP_REAL_PROTOCOL_ROOT!=="1")await rm(root,{recursive:true,force:true});else if(root)process.stdout.write(`KEPT_REAL_PROTOCOL_ROOT=${root}\n`);});

 async function completed(runId:string){for(let i=0;i<200;i++){const report=await collectControlled(service,runId);if(report.candidate?.stopProof&&report.terminal)return report;await sleep(50);}throw new Error("real ccloop run did not become collectable");}

 it("accepts, accounts, commits a handoff, resumes a dirty snapshot, and collects a fresh execution",async()=>{
  const claim=await service.claim("g1","T1"),sourceDir=join(runs,claim.runId);await mkdir(sourceDir,{mode:0o700});
  const contract=(JSON.parse(String(store.db.prepare("SELECT body FROM work_items WHERE group_id='g1' AND id='T1'").get()?.body))).contract;
  const base=await git(target,"rev-parse","HEAD");
  const first=await startClaim(store,service.executionPort(),{protocol:1,claim,contractHash:hashPayload(contract),inputCheckpoint:null,work:{contract,targetRepo:target,base,sourceDir}});
  const replay=await service.executionPort().accept(JSON.parse(String(store.db.prepare("SELECT body FROM outbox WHERE id=?").get("start:"+claim.runId)?.body)));
  expect(replay).toMatchObject({kind:"accepted",executionId:first.executionId});
  const report=await completed(claim.runId);expect(report.terminal?.outcome).toBe("succeeded");expect(report.candidate?.result).toBe("complete");expect(Number(store.db.prepare("SELECT count(*) AS n FROM usage_events WHERE run_id=?").get(claim.runId)?.n)).toBeGreaterThan(0);expect(report.candidate?.usageHighWater).toBeGreaterThan(0);const proof=report.candidate!.stopProof!,proofRaw=JSON.parse((await readArtifact(store,proof.source)).toString());expect(proofRaw).toMatchObject({executionId:first.executionId,generation:claim.generation,isolated:true});expect(getRun(store,claim.runId).executionId).toBe(proofRaw.executionId);
  const repoDir=join(sourceDir,"repo");await writeFile(join(repoDir,"dirty.txt"),"preserve me\n");
  putWork(store,"g1",{workItemId:"handoff-T1",taskId:"T1",kind:"handoff",dependsOn:[],contract:{reason:"continue"},configHash,grant:{work:amount(0,0,0,0),handoff:amount(200,30000,1,1)},parentRunId:claim.runId},{commandId:"handoff-work",expectedRevision:2,by:"test"});
  await service.requestHandoff("g1",claim.runId,{requestId:"handoff-1",reason:"context",deadlineAt:new Date(Date.now()+30000).toISOString()});
  expect(getRun(store,claim.runId)).toMatchObject({state:"settled",recoverable:true});
  const next=await service.continueTask("g1","T1",{commandId:"continue-1",expectedRevision:readGroup(store,"g1").revision});expect(next.runId).not.toBe(claim.runId);expect(next.executionId).not.toBe(first.executionId);
  const nextEnvelope=JSON.parse(String(store.db.prepare("SELECT body FROM outbox WHERE id=?").get("start:"+next.runId)?.body));
  expect(nextEnvelope.inputCheckpoint).toMatchObject({predecessorRunId:claim.runId});
  const manifest=JSON.parse(await readFile(join(nextEnvelope.inputCheckpoint.bundlePath,"resume-bundle.json"),"utf8")),snapshotEntry=manifest.artifacts.find((entry:any)=>entry.ref.artifactId===manifest.snapshot.artifactId),snapshot=JSON.parse(await readFile(join(nextEnvelope.inputCheckpoint.bundlePath,snapshotEntry.file),"utf8"));expect(snapshot.tree.some((entry:any)=>entry.path==="dirty.txt")).toBe(true);
  const resumed=await completed(next.runId);expect(resumed.terminal?.outcome).toBe("succeeded");expect(resumed.candidate?.result).toBe("complete");expect(await git(target,"show","refs/ccloop/run/attempts/1:dirty.txt")).toBe("preserve me");expect(await readFile(join(nextEnvelope.work.sourceDir,"repo","dirty.txt"),"utf8")).toBe("preserve me\n");
  const groupHandoff=JSON.parse((await buildGroupHandoff(store,"g1")).json.toString()),checkpoint=store.db.prepare("SELECT id,hash FROM checkpoints WHERE run_id=?").get(claim.runId),processes={first:JSON.parse(await readFile(join(sourceDir,"control","processes.json"),"utf8")),continuation:JSON.parse(await readFile(join(nextEnvelope.work.sourceDir,"control","processes.json"),"utf8"))};expect(groupHandoff.groupCheckpointId).toMatch(/^[a-f0-9]{64}$/);process.stdout.write(`CONTROL_PROTOCOL_EVIDENCE=${JSON.stringify({root,binary,adapterConfigPath,configHash,first:{runId:claim.runId,executionId:first.executionId,checkpoint},continuation:{runId:next.runId,executionId:next.executionId,candidateCheckpointId:resumed.candidate?.checkpointId},groupCheckpointId:groupHandoff.groupCheckpointId,processes})}\n`);
 },120000);

 it.each(["after-archive","before-projection"])("recovers the Orca SIGKILL boundary without duplicating checkpoint or D3 Markdown: %s",async point=>{const sample=await crashCase(point,"control-crash-worker.mjs");try{const first=await sample.recover(),path=join(sample.root,"state","exports","groups","g1","handoff.md"),markdown=await readFile(path,"utf8"),checkpoints=Number(sample.store.db.prepare("SELECT count(*) AS n FROM checkpoints").get()?.n);const second=await sample.recover();expect(second.launches).toBe(first.launches);expect(Number(sample.store.db.prepare("SELECT count(*) AS n FROM checkpoints").get()?.n)).toBe(checkpoints);expect(await readFile(path,"utf8")).toBe(markdown);}finally{await sample.dispose();}},30000);
});
