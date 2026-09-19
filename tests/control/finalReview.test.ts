import { describe,it,expect } from "vitest";
import { join } from "node:path";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { candidateCase } from "./fixtures/candidate.js";
import { archiveCase } from "./fixtures/archive.js";
import { crashCase } from "./fixtures/crashCase.js";
import { roundPeer } from "./fixtures/roundPeer.js";
import { caps,amount,openTestStore,seedBudgetCase } from "./fixtures/store.js";
import { commitCandidate,readCommittedCheckpoint } from "../../src/control/checkpoints.js";
import { publishPending } from "../../src/control/projection.js";
import { readRun,claimWork } from "../../src/control/budget.js";
import { createGroup,putWork,setGroupStopped } from "../../src/control/commands.js";
import { readWork,getGroup } from "../../src/control/queries.js";
import { ControlService } from "../../src/control/service.js";
import { recoverControl } from "../../src/control/recovery.js";
import { archiveRun,writeArtifact } from "../../src/control/archive.js";
import { recordUsage } from "../../src/control/usage.js";
import { collectControlled,makeControlledExecution,disposeControlled } from "../../src/control/schedulerBridge.js";
import { landIntoW } from "../../src/scheduler/land.js";
import { acquireRepoLock } from "../../src/scheduler/repoLock.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
function latch(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}
describe("final review regressions",{timeout:30000},()=>{
 it("retains reserve until the producer final usage watermark arrives",async()=>{
  const h=await crashCase("after-accept");try{
   const peer=roundPeer(join(h.root,"peer"));let tail=false;
   const port:ExecutionPort={...peer,collect:async(...args)=>{const r=await peer.collect(...args);return {...r,events:tail?[...r.events,{...r.events[0],eventSeq:3,cumulative:amount(2,2,1,1)}]:r.events,candidate:{...r.candidate!,usageHighWater:3}};}};
   for(let i=0;i<2;i++){expect((await recoverControl(h.store,port)).blockedRunIds).toContain(h.info.runId);expect(readRun(h.store,h.info.runId).state).not.toBe("settled");expect(readRun(h.store,h.info.runId).remaining.work.tokens).toBeGreaterThan(0);}
   tail=true;expect((await recoverControl(h.store,port)).blockedRunIds).toEqual([]);expect(readRun(h.store,h.info.runId).highWater).toBe(3);expect(getGroup(h.store,"g1").used.tokens).toBe(2);
   await recoverControl(h.store,port);expect(getGroup(h.store,"g1").used.tokens).toBe(2);
  }finally{await h.dispose();}
 });
 it.each(["none","work","handoff","both"])("requires explicit observations of both budget buckets: %s",async(observed)=>{
  const h=await archiveCase();try{
   const source=await writeArtifact(h.store,"explicit-zero",Buffer.from(JSON.stringify(amount(0,0,0,0))));let seq=0;
   for(const bucket of ["work","handoff"] as const)if(observed==="both"||observed===bucket)recordUsage(h.store,{runId:h.claim.runId,generation:1,eventSeq:++seq,bucket,cumulative:amount(0,0,0,0),source});
   const proofSource=await writeArtifact(h.store,"stop-proof",Buffer.from(JSON.stringify({executionId:"execution-1",generation:1,isolated:true})));const stopProof={...h.stopProof,source:proofSource};
   const a=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof});
   const reserved=getGroup(h.store,"g1").reserved;
   await commitCandidate(h.store,{...h.claim,checkpointId:"observations",usageHighWater:seq,result:"complete",artifacts:[...a.artifacts,source,proofSource],snapshot:a.snapshot,missing:[],unresolvedRequestIds:[],stopProof,terminalOutcome:"succeeded"});
   expect(getGroup(h.store,"g1").used.tokens).toBe(0);
   if(observed==="both")expect(readRun(h.store,h.claim.runId).state).toBe("settled");
   else {expect(readRun(h.store,h.claim.runId).state).not.toBe("settled");expect(getGroup(h.store,"g1").reserved).toEqual(reserved);}
  }finally{await h.dispose();}
 });
 it("retries a torn uncommitted checkpoint without rewriting a committed checkpoint",async()=>{
  const h=await candidateCase();try{
   const dir=join(h.store.stateDir,"checkpoints",h.claim.runId);await mkdir(dir,{recursive:true});const file=join(dir,"cp1.json");await writeFile(file,JSON.stringify(h.candidate).slice(0,64));
   await expect(commitCandidate(h.store,h.candidate)).resolves.toHaveProperty("checkpointId","cp1");
   await writeFile(file,"torn");await expect(commitCandidate(h.store,h.candidate)).rejects.toThrow("checkpoint-id-conflict");await expect(readCommittedCheckpoint(h.store,h.claim.runId)).rejects.toThrow();
  }finally{await h.dispose();}
 });
 it("serializes projection publication so a delayed old write cannot become latest",async()=>{
  const h=await candidateCase(),entered=latch(),resume=latch();try{
   await commitCandidate(h.store,{...h.candidate,result:"partial",stopProof:null});
   const one=publishPending(h.store,{writeProjection:async(path,bytes)=>{await mkdir(join(path,".."),{recursive:true});entered.release();await resume.promise;await writeFile(path,bytes);}});
   await entered.promise;const second=await commitCandidate(h.store,{...h.candidate,checkpointId:"cp2"});
   const two=publishPending(h.store);await new Promise(r=>setTimeout(r,50));resume.release();await Promise.all([one,two]);
   const latest=JSON.parse(await readFile(join(h.store.stateDir,"projections",h.claim.runId,"latest.json"),"utf8"));expect(latest.checkpointId).toBe("cp2");expect(latest.hash).toBe(second.hash);expect(h.store.db.prepare("SELECT count(*) AS n FROM outbox WHERE kind='projection' AND delivered=0").get()?.n).toBe(0);
  }finally{resume.release();await h.dispose();}
 });
 it("claims the newly approved target version while preserving same-version idempotence",async()=>{
  const h=await candidateCase();try{
   await commitCandidate(h.store,h.candidate);const {targetVersion,status,...w}=readWork(h.store,"g1","T1");
   putWork(h.store,"g1",{...w,contract:{updated:true},grant:{work:amount(20,100,1,1),handoff:amount(0,0,0,0)}},{commandId:"update",expectedRevision:3,by:"human"});
   const service=new ControlService(h.store,{capabilities:async()=>caps} as ExecutionPort);const before=getGroup(h.store,"g1").reserved.tokens;
   const c=await service.claim("g1","T1");expect(c.runId).not.toBe(h.claim.runId);expect(c.targetVersion).toBe(2);expect(c.graphVersion).toBe(4);expect(getGroup(h.store,"g1").reserved.tokens).toBe(before+20);
   expect((await service.claim("g1","T1")).runId).toBe(c.runId);expect(getGroup(h.store,"g1").reserved.tokens).toBe(before+20);
  }finally{await h.dispose();}
 });
 it.each(["dispose","recovery"])("repairs late acceptance without charging or merging twice: %s",async(route)=>{
  const h=await crashCase("after-accept");try{
   const peer=roundPeer(join(h.root,"peer")),service=new ControlService(h.store,peer);const report=await collectControlled(service,h.info.runId),t=report.terminal!;
   const run={runId:h.info.runId,workdir:t.sourceDir,outcome:t.outcome,attemptSha:t.attemptSha};
   await recoverControl(h.store,peer);expect(readWork(h.store,"g1","T1").status).toBe("blocked");const used=getGroup(h.store,"g1").used;
   const lock=await acquireRepoLock(h.info.target);let merges=0;
   try{const plan={targetRepo:h.info.target,workBranch:"orca/w",runsDir:join(h.root,"runs")} as Parameters<ReturnType<typeof makeControlledExecution>["land"]>[0];await makeControlledExecution(service,"g1").land(plan,[run],run.attemptSha!,async()=>{merges++;return landIntoW(plan,run);});}finally{await lock.release();}
   for(let i=0;i<2;i++)if(route==="dispose")await disposeControlled(service,run,{keepWorkdirs:true});else await recoverControl(h.store,peer);
   expect(readWork(h.store,"g1","T1").status).toBe("done");expect(getGroup(h.store,"g1").used).toEqual(used);expect(merges).toBe(1);expect(getGroup(h.store,"g1").status).toBe("review");
  }finally{await h.dispose();}
 });
 it("refuses recovery while live service orchestration owns the store",async()=>{
  const h=await openTestStore(),entered=latch(),resume=latch();try{
   seedBudgetCase(h.store);const service=new ControlService(h.store,{...roundPeer(join(h.root,"peer")),capabilities:async()=>{entered.release();await resume.promise;throw new Error("end-live-probe");}} as ExecutionPort);
   const running=service.run("g1","unused").catch(e=>e.message);await entered.promise;
   await expect(recoverControl(h.store,{inspect:async()=>{throw new Error("unexpected inspect");}} as unknown as ExecutionPort)).rejects.toThrow("control-operation-in-progress");
   resume.release();expect(await running).toBe("end-live-probe");
  }finally{resume.release();await h.dispose();}
 });
 it("refuses goal review after a soft overshoot until the limit authorizes it",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store,"soft"),c=claimWork(h.store,s.t1Claim);recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:1,bucket:"work",cumulative:amount(120,5,1,1),source:s.usageRef});
   putWork(h.store,"g1",{...s.w1,workItemId:"review",taskId:null,kind:"goal-review",grant:{work:amount(10,100,1,1),handoff:amount(0,0,0,0)}},{commandId:"review",expectedRevision:3,by:"human"});setGroupStopped(h.store,"g1",false,{commandId:"unstop",expectedRevision:4,by:"human"});
   const before=getGroup(h.store,"g1");expect(()=>claimWork(h.store,{...s.t1Claim,workItemId:"review",commandId:"claim-review",expectedRevision:5})).toThrow("group-budget-unavailable");expect(getGroup(h.store,"g1")).toEqual(before);
  }finally{await h.dispose();}
 });
 it("maps work item dependencies to task dependencies in controlled preflight",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);createGroup(h.store,{groupId:"distinct",projectKey:"project",goal:"goal",successConditions:["okay"],limit:amount(200),reviewReserve:amount(0,0,0,0),deadlineAt:null},{commandId:"create",expectedRevision:0,by:"human"});
   putWork(h.store,"distinct",{...s.w1,workItemId:"WI1"},{commandId:"w1",expectedRevision:1,by:"human"});putWork(h.store,"distinct",{...s.w2,workItemId:"WI2",dependsOn:["WI1"]},{commandId:"w2",expectedRevision:2,by:"human"});
   const service=new ControlService(h.store,{...roundPeer(join(h.root,"peer")),capabilities:async()=>caps,readEvidence:async()=>Buffer.from("")},{targetRepo:h.root});
   await expect(makeControlledExecution(service,"distinct").preflight({plan:{targetRepo:h.root,tasks:[{taskId:"T1",dependsOn:[]},{taskId:"T2",dependsOn:["T1"]}]},contracts:new Map([["T1",s.w1.contract],["T2",s.w2.contract]])} as never)).resolves.toBeUndefined();
  }finally{await h.dispose();}
 });
});
