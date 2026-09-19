import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { openControlStore } from "../../src/control/store.js";
import { describe,it,expect } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { recordUsage } from "../../src/control/usage.js";
import { createGroup,putWork,setGroupLimit,setGroupStopped } from "../../src/control/commands.js";
import { getGroup } from "../../src/control/queries.js";
import { openTestStore,seedBudgetCase,amount,caps } from "./fixtures/store.js";
import type { WorkKind } from "../../src/control/types.js";
describe("unified work claims",()=>{
 it("reserves both buckets atomically and replays one immutable run",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);const c=claimWork(h.store,s.t1Claim);
   expect(getGroup(h.store,"g1").reserved.tokens).toBe(80);
   expect(claimWork(h.store,s.t1Claim)).toEqual(c);
   expect(()=>claimWork(h.store,s.t2Claim)).toThrow("group-budget-unavailable");
   expect(()=>claimWork(h.store,{...s.t1Claim,commandId:"duplicate"})).toThrow("work-already-active");
   recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:1,bucket:"work",cumulative:amount(40,20,1,1),source:s.usageRef});
   expect(getGroup(h.store,"g1").used.tokens).toBe(40);expect(getGroup(h.store,"g1").reserved.tokens).toBe(40);
   expect(getGroup(h.store,"g1").revision).toBe(3);
  }finally{await h.dispose();}
 });
 it.each<Exclude<WorkKind,"handoff">>(["task","decompose","reconcile","goal-review","memory"])("refuses stopped %s work without creating execution",async kind=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);putWork(h.store,"g1",{...s.w1,kind},{commandId:"kind",expectedRevision:3,by:"human"});
   setGroupStopped(h.store,"g1",true,{commandId:"stop",expectedRevision:4,by:"human"});
   expect(()=>claimWork(h.store,{...s.t1Claim,expectedRevision:5,graphVersion:4,targetVersion:2})).toThrow("group-stopped");
   expect(h.store.db.prepare("SELECT id FROM runs").all()).toHaveLength(0);
  }finally{await h.dispose();}
 });
 it.each([{...caps,budgetEnforcement:"soft" as const},{...caps,requestBoundEvidence:null},{...caps,durableAccept:false}])("refuses unproven strict capabilities before reserving",async capabilities=>{
  const h=await openTestStore();try{const s=seedBudgetCase(h.store);expect(()=>claimWork(h.store,{...s.t1Claim,capabilities})).toThrow("control-capability-unsupported");expect(getGroup(h.store,"g1").reserved.tokens).toBe(10);}finally{await h.dispose();}
 });
 it("transfers goal review reserve without charging it twice",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);putWork(h.store,"g1",{...s.w1,workItemId:"review",taskId:null,kind:"goal-review",grant:{work:amount(10,100,1,1),handoff:amount(0,0,0,0)}},{commandId:"review",expectedRevision:3,by:"human"});
   claimWork(h.store,{...s.t1Claim,workItemId:"review",expectedRevision:4,graphVersion:4});
   expect(getGroup(h.store,"g1").reserved.tokens).toBe(10);
  }finally{await h.dispose();}
 });
 it("uses the parent's handoff reservation after stop without creating another run",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);const c=claimWork(h.store,s.t1Claim);
   putWork(h.store,"g1",{...s.w1,workItemId:"handoff",kind:"handoff",parentRunId:c.runId,grant:{work:amount(0,0,0,0),handoff:s.w1.grant.handoff}},{commandId:"handoff",expectedRevision:3,by:"service"});
   setGroupStopped(h.store,"g1",true,{commandId:"stop",expectedRevision:4,by:"human"});
   const handoff=claimWork(h.store,{...s.t1Claim,workItemId:"handoff",commandId:"claim-handoff",expectedRevision:5});
   expect(handoff.runId).toBe(c.runId);expect(h.store.db.prepare("SELECT id FROM runs").all()).toHaveLength(1);
   recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:1,bucket:"handoff",cumulative:amount(5,10,0,0),source:s.usageRef});
   expect(getGroup(h.store,"g1").used.attempts).toBe(0);expect(getGroup(h.store,"g1").reserved.tokens).toBe(75);
  }finally{await h.dispose();}
 });
 it("rejects stale versions, expired deadlines, recovery ownership and unmet dependencies",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);
   expect(()=>claimWork(h.store,{...s.t1Claim,graphVersion:1})).toThrow("graph-version-conflict");
   expect(()=>claimWork(h.store,{...s.t1Claim,targetVersion:2})).toThrow("target-version-conflict");
   h.store.dispatchBlocked=true;expect(()=>claimWork(h.store,s.t1Claim)).toThrow("control-recovery-required");h.store.dispatchBlocked=false;
   putWork(h.store,"g1",{...s.w2,dependsOn:["T1"]},{commandId:"deps",expectedRevision:3,by:"human"});
   expect(()=>claimWork(h.store,{...s.t2Claim,expectedRevision:4,graphVersion:4,targetVersion:2})).toThrow("dependency-not-done");
   createGroup(h.store,{groupId:"expired",projectKey:"x",goal:"x",successConditions:["x"],limit:amount(100),reviewReserve:amount(0,0,0,0),deadlineAt:"2020-01-01T00:00:00Z"},{commandId:"create",expectedRevision:0,by:"human"});
   putWork(h.store,"expired",s.w1,{commandId:"w",expectedRevision:1,by:"human"});
   expect(()=>claimWork(h.store,{...s.t1Claim,groupId:"expired",expectedRevision:2,graphVersion:2})).toThrow("group-deadline-expired");
  }finally{await h.dispose();}
 });
 it("enforces the database active-run constraint independently of application reads",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);const c=claimWork(h.store,s.t1Claim);
   expect(()=>h.store.db.prepare("INSERT INTO runs SELECT 'duplicate',group_id,work_item_id,generation,active,body FROM runs WHERE id=?").run(c.runId)).toThrow();
   expect(h.store.db.prepare("SELECT id FROM runs").all()).toHaveLength(1);
  }finally{await h.dispose();}
 });
 it("lets only one process claim while a service owner is alive and keeps that claim after close",async()=>{
  const h=await openTestStore();const s=seedBudgetCase(h.store);h.store.close();
  const args=["--import","tsx",resolve("tests/control/fixtures/claim-worker.ts"),h.store.stateDir,JSON.stringify(s.t1Claim)];
  const child=spawn(process.execPath,args,{stdio:["pipe","pipe","pipe"]});let stderr="";child.stderr.on("data",b=>stderr+=b);
  try {
   await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>fail(new Error(stderr)),10000);child.stdout.once("data",()=>{clearTimeout(timer);ok();});child.once("exit",code=>{clearTimeout(timer);fail(new Error(String(code)+stderr));});});
   expect(()=>execFileSync(process.execPath,args,{stdio:"pipe"})).toThrow();
   const done=once(child,"exit");child.stdin.end();await done;
   const store=await openControlStore({stateDir:h.store.stateDir});try{
    expect(()=>claimWork(store,{...s.t1Claim,commandId:"other-process"})).toThrow("work-already-active");
    expect(store.db.prepare("SELECT id FROM runs").all()).toHaveLength(1);
   }finally{store.close();}
  }finally{if(child.exitCode===null && child.signalCode===null) child.kill("SIGKILL");await h.dispose();}
 });

});
