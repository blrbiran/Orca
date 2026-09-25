import { readFile, realpath } from "node:fs/promises";
import { describe,it,expect } from "vitest";
import { synthesizeReconcileContract,materialiseConflict } from "../../src/scheduler/reconcile.js";
import { makeSandbox,seedConflictingCopy,contractObject } from "../scheduler/sandbox.js";

describe("controlled reconciliation budget",()=>{
 for(const tokens of [7,0]) it(`uses the approved grant or refuses zero (${tokens})`,async()=>{
  const s=await makeSandbox();try{
   const f=await seedConflictingCopy(s);
   const conflict=await materialiseConflict(f.copyPath,f.wTip,f.incomingRef);
   const contracts=new Map<string,unknown>();
   for(const id of ["T1","T2"]) contracts.set(id,await contractObject(s,id,{goal:id,targetPaths:[f.path],requiredChecks:["true"]}));
   const result=await synthesizeReconcileContract({taskId:"T1",contract:"/outside/a",dependsOn:[]},{taskId:"T2",contract:"/outside/b",dependsOn:[]},contracts,s.runsDir,conflict,{maxAttempts:1,perAttemptTimeoutMs:500,totalRuntimeBudgetMs:500,tokenBudget:tokens});
   if(tokens===0){expect(result).toHaveProperty("escalate");return;}
   if("escalate" in result) throw new Error(result.escalate);
   const built=JSON.parse(await readFile(result.path,"utf8"));
   expect(built.executionPolicy.tokenBudget).toBe(7);
   expect(built.executionPolicy.totalRuntimeBudgetMs).toBe(500);
   expect(built.executionPolicy.maxAttempts).toBe(1);
  }finally{await s.cleanup();}
 });
});

it("checks execution capabilities before reading or mutating the prepared target",async()=>{
 const {runPreparedRound}=await import("../../src/scheduler/run.js");
 let checked=0;
 await expect(runPreparedRound({} as never,{}, {
  mode:"controlled",preflight:async()=>{checked++;throw new Error("protocol-refused");},
  execute:async()=>{throw new Error("unexpected-launch");},
  dispose:async()=>{throw new Error("unexpected-cleanup");},
  reconcileBudget:async()=>{throw new Error("unexpected-claim");},
  land:async()=>{throw new Error("unexpected-landing");},
 })).rejects.toThrow("protocol-refused");
 expect(checked).toBe(1);
});

it("reserves reconciliation once from remaining group budget and refuses stopped groups",async()=>{
 const {ControlService}=await import("../../src/control/service.js");
 // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
 const {openTestStore,seedBudgetCase,caps,amount,resolvedAs}=await import("./fixtures/store.js");
 const {claimWork}=await import("../../src/control/budget.js");
 const {getGroup}=await import("../../src/control/queries.js");
 const {setGroupStopped}=await import("../../src/control/commands.js");
 const h=await openTestStore();try{
  const seeded=seedBudgetCase(h.store);claimWork(h.store,seeded.t1Claim);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  const service=new ControlService(h.store,{resolveAgent:async()=>resolvedAs(caps)} as never,{reconcileGrant:{work:amount(7,500,1,1),handoff:amount(2,50,0,0)}});
  const first=await service.reconcileBudget("g1","T1");
  expect(first.tokenBudget).toBe(7);expect(first.totalRuntimeBudgetMs).toBe(500);
  const reserved=getGroup(h.store,"g1").reserved;
  expect(await service.reconcileBudget("g1","T1")).toEqual(first);
  expect(getGroup(h.store,"g1").reserved).toEqual(reserved);
  expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(2);
  const g=getGroup(h.store,"g1");setGroupStopped(h.store,"g1",true,{commandId:"stop",expectedRevision:g.revision,by:"human"});
  await expect(service.reconcileBudget("g1","T2")).rejects.toThrow("group-stopped");
 }finally{await h.dispose();}
});
// Human authorization (2026-09-24, ruling-88): rewritten for the v2 wire vocabulary (G1 seam A
// Task 3) -- `durableAccept` is a retired field that no longer exists on `Capabilities`; the
// rewrite is a whole swap, not a weakening, and keeps the same "peer answers with a hard miss"
// shape this test pinned before.
it("gets capabilities from the peer before a service claim",async()=>{
 const {ControlService}=await import("../../src/control/service.js");
 // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
 const {openTestStore,seedBudgetCase,caps,resolvedAs}=await import("./fixtures/store.js");
 const h=await openTestStore();try{
  seedBudgetCase(h.store);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  const service=new ControlService(h.store,{resolveAgent:async()=>resolvedAs({...caps,handoffExecution:null})} as never);
  await expect(service.claim("g1","T1")).rejects.toThrow("control-capability-unsupported");
  expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
 }finally{await h.dispose();}
});

it.each(["success","budget","stopped","crash"])("runs a real conflicting graph through durable control: %s",async(mode)=>{
 const {ControlService}=await import("../../src/control/service.js");
 const {makeControlledExecution}=await import("../../src/control/schedulerBridge.js");
 const {runPreparedRound,loadRound}=await import("../../src/scheduler/run.js");
 const {seedLyingPlan,showFileAt}=await import("../scheduler/sandbox.js");
 // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
 const {openTestStore,amount,fixtureAgent}=await import("./fixtures/store.js");
 const {roundPeer}=await import("./fixtures/roundPeer.js");
 const {createGroup,putWork}=await import("../../src/control/commands.js");
 const {getGroup,readWork}=await import("../../src/control/queries.js");
 const {setGroupStopped}=await import("../../src/control/commands.js");
 const {join}=await import("node:path");
 const s=await makeSandbox(),h=await openTestStore();try{
  const p=await seedLyingPlan(s),loaded=await loadRound(p.planPath);if("rejections" in loaded)throw new Error(JSON.stringify(loaded));
  createGroup(h.store,{groupId:"g",projectKey:"offline/project",goal:"both changes",successConditions:["checks"],limit:amount(100,100000,10,10),reviewReserve:amount(10,100,1,1),deadlineAt:null},{commandId:"g",expectedRevision:0,by:"human"});
  let revision=1;
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  for(const task of loaded.round.plan.tasks)putWork(h.store,"g",{workItemId:task.taskId,taskId:task.taskId,kind:"task",dependsOn:task.dependsOn,contract:loaded.round.contracts.get(task.taskId),configHash:"offline",agent:fixtureAgent,grant:{work:amount(35,20000,1,1),handoff:amount(5,100,0,0)}},{commandId:task.taskId,expectedRevision:revision++,by:"human"});
  const service=new ControlService(h.store,roundPeer(join(h.root,"peer")),{targetRepo:s.targetRepo,reconcileGrant:{work:amount(mode==="budget"?0:7,500,1,1),handoff:amount(1,50,0,0)}});
  const messages:string[]=[];
  const execution=makeControlledExecution(service,"g");
  let retryLanding: (()=>Promise<unknown>)|undefined;
  let merges=0;
  if(mode==="crash") {
   const land=execution.land;
   execution.land=async(plan,runs,incoming,perform)=>{
    retryLanding=()=>land(plan,runs,incoming,async()=>{merges++;return perform();});
    return land(plan,runs,incoming,async()=>{merges++;await perform();throw new Error("crash-after-merge");});
   };
  }
  if(mode==="stopped") {
   const budget=execution.reconcileBudget;
   execution.reconcileBudget=async taskId=>{const g=getGroup(h.store,"g");setGroupStopped(h.store,"g",true,{commandId:"stop-reconcile",expectedRevision:g.revision,by:"human"});return budget(taskId);};
  }
  expect(await (mode==="success"?service.run("g",p.planPath,{log:x=>messages.push(x),logError:x=>messages.push(x)}):runPreparedRound(loaded.round,{log:x=>messages.push(x),logError:x=>messages.push(x)},execution)),messages.join("\n")).toBe(mode==="success"?2:3);
  if(mode==="crash") {
   const {git}=await import("./fixtures/archive.js");
   const {acquireRepoLock}=await import("../../src/scheduler/repoLock.js");
   const tip=git(s.targetRepo,"rev-parse",p.workBranch).toString();
   const count=git(s.targetRepo,"rev-list","--count",p.workBranch).toString();
   const lock=await acquireRepoLock(s.targetRepo);
   try{expect(await retryLanding!()).toEqual({merged:true});expect(await retryLanding!()).toEqual({merged:true});}finally{await lock.release();}
   expect(merges).toBe(1);
   expect(git(s.targetRepo,"rev-parse",p.workBranch).toString()).toBe(tip);
   expect(git(s.targetRepo,"rev-list","--count",p.workBranch).toString()).toBe(count);
   return;
  }
  if(mode!=="success") {
   const rows=h.store.db.prepare("SELECT body FROM runs").all().map(row=>JSON.parse(String(row.body)));
   expect(rows).toHaveLength(2);
   expect(readWork(h.store,"g","T2").status).toBe("blocked");
   const t2=rows.find(r=>r.taskId==="T2");
   const {git}=await import("./fixtures/archive.js");
   expect(git(join(s.runsDir,t2.runId,"repo"),"show-ref").toString()).toContain("refs/orca/conflict/");
   expect(await readFile(join(s.runsDir,t2.runId,"stdout.log"),"utf8")).toBe("raw peer output\n");
   return;
  }
  expect(await showFileAt(s.targetRepo,p.workBranch,"shared.txt"),messages.join("\n")).toBe("one and two\n");
  const rows=h.store.db.prepare("SELECT body FROM runs").all().map(row=>JSON.parse(String(row.body)));
  expect(rows).toHaveLength(3);expect(rows.every(r=>r.state==="settled" && r.recoverable)).toBe(true);
  expect(rows.find(r=>r.workItemId==="reconcile-T2").grant.work.tokens).toBe(7);
  expect(getGroup(h.store,"g").used.tokens).toBe(3);expect(getGroup(h.store,"g").status).toBe("review");
  for(const row of rows)expect(await readFile(join(h.root,"peer",row.runId,"launches"),"utf8")).toBe("1\n");
 }finally{await h.dispose();await s.cleanup();}
},30000);
