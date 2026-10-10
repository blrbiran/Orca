import { createGroup, putWork } from "../../src/control/commands.js";
import { claimWork } from "../../src/control/budget.js";
import { amount, caps, fixtureAgent } from "./fixtures/store.js";
import { expect, it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";
import { readGroup, readWork } from "../../src/control/queries.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { committedTokens } from "../../src/control/spendCaps.js";
import { readControlGroup } from "../../src/panel/controlViews.js";

it.each(["uncapped", "cap", "group", "legacy", "mixed"] as const)("conserves all commitments across repeated pre-provider stops (%s)", async mode => {
 const t=await driverHarness([{taskId:"a",tokenBudget:null}],{...(mode==="legacy"?{}:{tokenPolicy:"optional-v1" as const}),killGraceMs:0,behaviour:()=>"stoppable"});const driver=t.driver();
 try {
  let other=0;
  if(mode==="mixed"){
   createGroup(t.h.store,{groupId:"old",projectKey:"old",goal:"old task",successConditions:["done"],budgetMode:"soft",limit:amount(200_000,1_000_000,100,100),reviewReserve:amount(0,0,0,0),deadlineAt:null},{commandId:"old-create",expectedRevision:0,by:"human"});
   putWork(t.h.store,"old",{workItemId:"old",taskId:"old",kind:"task",dependsOn:[],contract:{},configHash:"config",agent:fixtureAgent,grant:{work:amount(100_000),handoff:amount(10_000,0,0,0)}},{commandId:"old-put",expectedRevision:1,by:"human"});
   claimWork(t.h.store,{groupId:"old",workItemId:"old",graphVersion:2,targetVersion:1,commandId:"old-claim",expectedRevision:2,by:"service",capabilities:caps});other=110_000;
  }
  const legacyHeld=mode==="mixed"?structuredClone(readGroup(t.h.store,"old").reserved):null;
  if(mode==="cap"||mode==="mixed")t.h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run();
  if(mode==="group")expect(t.service.setLimit(t.h.command("set-limit",{limit:{...readGroup(t.h.store,"g").limit,tokens:3_150_000}}))).not.toHaveProperty("error");
  const idle=structuredClone(readGroup(t.h.store,"g").reserved);let id=await t.claim();const active=structuredClone(readGroup(t.h.store,"g").reserved);
  for(let cycle=0;cycle<3;cycle++) {
   const run=t.body(id);if(mode!=="uncapped")expect(committedTokens(t.h.store,"all",null)).toBe(other+run.grant.work.tokens+run.grant.handoff.tokens);
   expect(t.fake.calls.accept).toHaveLength(0);expect(await t.service.handoffStop(t.h.command("handoff-stop",{}))).not.toHaveProperty("error");
   await t.until(driver,()=>t.body(id).state==="settled-restartable");
   expect(t.body(id).unknown).toEqual({work:false,handoff:false});expect(t.body(id).cumulative).toEqual({work:{tokens:0,activeMs:0,attempts:0,sessions:0},handoff:{tokens:0,activeMs:0,attempts:0,sessions:0}});
   expect(readGroup(t.h.store,"g").reserved).toEqual(mode==="legacy"?active:idle);
   expect(committedTokens(t.h.store,"all",null)).toBe(other);
   if(legacyHeld)expect(readGroup(t.h.store,"old").reserved).toEqual(legacyHeld);
   expect(readControlGroup(t.h.store,"epoch","g").ledger.committedRemaining).toEqual(mode==="legacy"?active:idle);
   await driver.round();expect(readGroup(t.h.store,"g").reserved).toEqual(mode==="legacy"?active:idle);
   const resume=t.h.command("resume-from-handoff",{selections:[]});const resumed=await t.service.resumeFromHandoff(resume);expect(resumed).not.toHaveProperty("error");expect(await t.service.resumeFromHandoff(resume)).toEqual(resumed);
   const next=await deliverScheduledStart(t.dispatch,"g");expect(next.kind).toBe("claimed");if(next.kind!=="claimed")return;id=next.runId;expect(await deliverScheduledStart(t.dispatch,"g")).toEqual(next);
   expect(readGroup(t.h.store,"g").reserved).toEqual(active);expect(readGroup(t.h.store,"g").used).toEqual({tokens:0,activeMs:0,attempts:0,sessions:0});
   expect(readControlGroup(t.h.store,"epoch","g").ledger.committedRemaining).toEqual(active);
   expect(t.h.store.db.prepare("SELECT id FROM runs WHERE active=1 AND group_id='g'").all()).toHaveLength(1);
  }
 }finally{await driver.stop();await t.h.dispose();}
});


it("keeps the predecessor and non-token promises when an optional continuation stops before provider start",async()=>{
 const t=await driverHarness([{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1",killGraceMs:0,behaviour:()=>"stoppable"});const driver=t.driver();try{
  t.h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run();
  const predecessor=await t.claim();await t.until(driver,()=>t.body(predecessor).state==="accepted");await t.service.handoffStop(t.h.command("handoff-stop",{}));await t.until(driver,()=>t.body(predecessor).state==="settled-recoverable");
  const checkpointId=t.body(predecessor).checkpointId,used=structuredClone(readGroup(t.h.store,"g").used);
  let active:unknown;
  for(let cycle=0;cycle<2;cycle++){
   expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff",{selections:[{taskId:"a",predecessorRunId:predecessor,checkpointId}]}))).not.toHaveProperty("error");
   const claim=await deliverScheduledStart(t.dispatch,"g");expect(claim.kind).toBe("claimed");if(claim.kind!=="claimed")return;
   const reserved=structuredClone(readGroup(t.h.store,"g").reserved);if(active)expect(reserved).toEqual(active);active=reserved;
   expect(readControlGroup(t.h.store,"epoch","g").ledger.committedRemaining).toEqual(reserved);
   await t.service.handoffStop(t.h.command("handoff-stop",{}));await t.until(driver,()=>t.body(claim.runId).state==="settled-restartable");
   expect(readWork(t.h.store,"g","a")).toMatchObject({status:"held",currentRunId:predecessor,pendingRunId:null,continuation:null});
   expect(readGroup(t.h.store,"g").reserved).toEqual({...reserved,tokens:reserved.tokens-t.body(claim.runId).grant.work.tokens-t.body(claim.runId).grant.handoff.tokens});
   expect(readGroup(t.h.store,"g").used).toEqual(used);expect(committedTokens(t.h.store,"all",null)).toBe(0);expect(t.fake.calls.accept).toHaveLength(1);
  }
 }finally{await driver.stop();await t.h.dispose();}
});
