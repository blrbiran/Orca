import { describe,it,expect } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { recordUsage } from "../../src/control/usage.js";
import { setGroupLimit } from "../../src/control/commands.js";
import { getGroup } from "../../src/control/queries.js";
import { openTestStore,seedBudgetCase,amount } from "./fixtures/store.js";
describe("ordered cumulative usage",()=>{
 it("deduplicates events, rejects conflicting replay, and drains gaps in sequence",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);const c=claimWork(h.store,s.t1Claim);
   const e={runId:c.runId,generation:1,eventSeq:1,bucket:"work" as const,cumulative:amount(10,20,1,1),source:s.usageRef};
   expect(recordUsage(h.store,e)).toEqual({applied:true,highWater:1});
   expect(recordUsage(h.store,e)).toEqual({applied:false,highWater:1});
   expect(()=>recordUsage(h.store,{...e,cumulative:amount(11,20,1,1)})).toThrow("usage-event-conflict");
   expect(recordUsage(h.store,{...e,eventSeq:3,cumulative:amount(40,30,1,1)}).highWater).toBe(1);
   expect(getGroup(h.store,"g1").used.tokens).toBe(10);
   expect(recordUsage(h.store,{...e,eventSeq:2,cumulative:amount(20,25,1,1)}).highWater).toBe(3);
   expect(getGroup(h.store,"g1").used).toEqual(amount(40,30,1,1));
   expect(getGroup(h.store,"g1").reserved.tokens).toBe(40);
   expect(()=>recordUsage(h.store,{...e,eventSeq:4,cumulative:amount(30,30,1,1)})).toThrow("usage-regression");
   expect(getGroup(h.store,"g1").used.tokens).toBe(40);
  }finally{await h.dispose();}
 });
 it("retains unknown reserves and distinguishes explicit zero from missing consumption",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);const c=claimWork(h.store,s.t1Claim);
   recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:1,bucket:"work",cumulative:null,source:s.usageRef});
   expect(getGroup(h.store,"g1").reserved.tokens).toBe(80);
   const body=()=>JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(c.runId)?.body));
   expect(body().unknown.work).toBe(true);
   recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:2,bucket:"work",cumulative:amount(0,0,0,0),source:s.usageRef});
   expect(body().unknown.work).toBe(false);expect(getGroup(h.store,"g1").reserved.tokens).toBe(80);
  }finally{await h.dispose();}
 });
 it("records real overshoot without taking handoff or review reserve and stops new work",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store,"soft");const c=claimWork(h.store,s.t1Claim);
   recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:1,bucket:"work",cumulative:amount(120,50,1,1),source:s.usageRef});
   expect(getGroup(h.store,"g1").used.tokens).toBe(120);expect(getGroup(h.store,"g1").reserved.tokens).toBe(20);
   expect(getGroup(h.store,"g1").stopped).toBe(true);
   expect(()=>claimWork(h.store,s.t2Claim)).toThrow("group-stopped");
   const r=JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(c.runId)?.body));expect(r.breaches).toHaveLength(1);
  }finally{await h.dispose();}
 });
 it("adds simultaneous run time rather than using elapsed wall time and rejects old generation",async()=>{
  const h=await openTestStore();try{
   const s=seedBudgetCase(h.store);setGroupLimit(h.store,"g1",amount(200,1000000,100,100),{commandId:"raise",expectedRevision:3,by:"human"});
   const a=claimWork(h.store,{...s.t1Claim,expectedRevision:4});const b=claimWork(h.store,{...s.t2Claim,expectedRevision:4});
   for(const c of [a,b]) recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:1,bucket:"work",cumulative:amount(1,60000,1,1),source:s.usageRef});
   expect(getGroup(h.store,"g1").used.activeMs).toBe(120000);
   expect(()=>recordUsage(h.store,{runId:a.runId,generation:2,eventSeq:2,bucket:"work",cumulative:amount(2,60000,1,1),source:s.usageRef})).toThrow("run-generation-conflict");
   expect(getGroup(h.store,"g1").used.tokens).toBe(2);
  }finally{await h.dispose();}
 });
});
