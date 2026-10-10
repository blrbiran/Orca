import { DISPATCHABLE_GROUP_STATES } from "../../src/control/executionDriver.js";
import { afterEach, describe, expect, it } from "vitest";
import { openTestStore, amount, fixtureAgent } from "./fixtures/store.js";
import { createGroup, putWork } from "../../src/control/commands.js";
import * as funded from "../../src/control/fundedAllowance.js";
const opened: Awaited<ReturnType<typeof openTestStore>>[]=[];
afterEach(async()=>{for(const h of opened.splice(0))await h.dispose();});
async function setup(tasks: Array<{g:string;repo:string;id:string;handoff:number;tokens?:number|null}>,cap:number|null) {
 const h=await openTestStore();opened.push(h);
 for(const g of [...new Set(tasks.map(t=>t.g))]) {
   createGroup(h.store,{groupId:g,projectKey:tasks.find(t=>t.g===g)!.repo,goal:"ship",successConditions:["passes"],budgetMode:"soft",limit:{...amount(0,1_000_000,100,100),tokens:null},reviewReserve:amount(0,0,0,0),deadlineAt:null} as never,{commandId:`create-${g}`,expectedRevision:0,by:"human"});
   let revision=1;
   for(const task of tasks.filter(t=>t.g===g))putWork(h.store,g,{workItemId:task.id,taskId:task.id,kind:"task",dependsOn:[],contract:{},configHash:"config",agent:fixtureAgent,grant:{work:{...amount(0),tokens:task.tokens??null},handoff:amount(task.handoff,0,0,0)}} as never,{commandId:`put-${task.id}`,expectedRevision:revision++,by:"human"});
 }
 if(cap!==null)h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',?,0,'human')").run(cap);
 return h;
}
describe("joint funded allowances",()=>{
 it("reserves unequal handoffs before distributing residual work",async()=>{
  const h=await setup([{g:"g",repo:"r",id:"a",handoff:10},{g:"g",repo:"r",id:"b",handoff:30}],100);
  expect(funded.allocateFundedAllowance(h.store,"g","a",0)?.grant).toEqual({work:amount(30),handoff:amount(10,0,0,0)});
  expect(funded.allocateFundedAllowance(h.store,"g","b",0)?.grant.work.tokens).toBe(30);
  expect(h.store.db.prepare("SELECT count(*) AS n FROM funded_allowances").get()!.n).toBe(0);
 });
 it("skips demand blocked by a project cap so the healthy project can claim global headroom",async()=>{
  const h=await setup([{g:"a",repo:"bad",id:"a",handoff:9},{g:"b",repo:"good",id:"b",handoff:9}],10);
  h.store.db.prepare("INSERT INTO spend_caps VALUES ('repo:bad','total',1,0,'human')").run();
  expect(funded.allocateFundedAllowance(h.store,"a","a",0)).toBeNull();
  expect(funded.allocateFundedAllowance(h.store,"b","b",0)?.grant.work.tokens).toBe(1);
 });
 it("redistributes unused finite demand without inventing fixed chunks",async()=>{
  const h=await setup([{g:"g",repo:"r",id:"a",handoff:10,tokens:5},{g:"g",repo:"r",id:"b",handoff:10}],100);
  expect(funded.allocateFundedAllowance(h.store,"g","a",0)?.grant.work.tokens).toBe(5);
  expect(funded.allocateFundedAllowance(h.store,"g","b",0)?.grant.work.tokens).toBe(75);
 });
 it("returns a truly unbounded work allowance only when no finite binder applies",async()=>{
  const h=await setup([{g:"g",repo:"r",id:"a",handoff:10}],null);
  expect(funded.allocateFundedAllowance(h.store,"g","a",0)).toMatchObject({grant:{work:{tokens:null},handoff:{tokens:10}},authoredTokenCeiling:null,inheritedUsage:amount(0,0,0,0),bindingCauses:[]});
 });
});

import { caps } from "./fixtures/store.js";
import { claimWork, readRun } from "../../src/control/budget.js";
import { recordUsage } from "../../src/control/usage.js";
import { setGroupLimit } from "../../src/control/commands.js";
it("claims only its actual allocation and books finite overshoot against an unlimited policy",async()=>{
 const h=await setup([{g:"g",repo:"r",id:"a",handoff:10},{g:"g",repo:"r",id:"b",handoff:30}],100);
 const claim=claimWork(h.store,{groupId:"g",workItemId:"a",graphVersion:3,targetVersion:1,commandId:"claim",expectedRevision:3,by:"service",capabilities:caps});
 expect(claim.grant.work.tokens).toBe(30);
 expect(h.store.db.prepare("SELECT count(*) AS n FROM funded_allowances").get()!.n).toBe(1);
 const source={artifactId:"usage",hash:"a".repeat(64)};
 recordUsage(h.store,{runId:claim.runId,generation:1,eventSeq:1,bucket:"work",cumulative:amount(35,5,1,1),source});
 expect(readRun(h.store,claim.runId).cumulative.work.tokens).toBe(35);
 expect(readRun(h.store,claim.runId).breaches).toEqual([1]);
 expect(funded.allocateFundedAllowance(h.store,"g","b",0)).toBeNull();
});
it("refuses a finite limit while an unbounded provider grant is active",async()=>{
 const h=await setup([{g:"g",repo:"r",id:"a",handoff:10}],null);
 const claim=claimWork(h.store,{groupId:"g",workItemId:"a",graphVersion:2,targetVersion:1,commandId:"claim",expectedRevision:2,by:"service",capabilities:caps});
 expect(claim.grant.work.tokens).toBeNull();
 expect(()=>setGroupLimit(h.store,"g",amount(1000,1_000_000,100,100),{commandId:"limit",expectedRevision:2,by:"human"})).toThrow("active-unbounded-budget-conflict");
});

import { inheritedWorkUsage } from "../../src/control/fundedAllowance.js";
import { readGroup, readWork, saveGroup, saveWork } from "../../src/control/queries.js";
import { saveRun } from "../../src/control/budget.js";
it.each(["attempts","sessions"] as const)("does not renew an exhausted inherited %s dimension",async dimension=>{
 const h=await setup([{g:"g",repo:"r",id:"a",handoff:10}],null);
 const work=readWork(h.store,"g","a");work.grant.work[dimension]=1;
 h.store.transaction(()=>saveWork(h.store,"g",work));
 const claim=claimWork(h.store,{groupId:"g",workItemId:"a",graphVersion:2,targetVersion:1,commandId:"claim",expectedRevision:2,by:"service",capabilities:caps});
 const source={artifactId:"usage",hash:"a".repeat(64)};
 const event={runId:claim.runId,generation:1,eventSeq:1,bucket:"work" as const,cumulative:amount(40,50,1,1),source};
 expect(recordUsage(h.store,event).applied).toBe(true);expect(recordUsage(h.store,event).applied).toBe(false);
 recordUsage(h.store,{...event,eventSeq:2,bucket:"handoff",cumulative:amount(0,0,0,0)});
 h.store.transaction(()=>{const run=readRun(h.store,claim.runId);run.state="settled";saveRun(h.store,run);h.store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(run.runId);work.status="ready";saveWork(h.store,"g",work);});
 expect(inheritedWorkUsage(h.store,"g","a")).toEqual(amount(40,50,1,1));
 expect(funded.allocateFundedAllowance(h.store,"g","a",0)).toBeNull();
});
it("skips stopped, archived, dependency-blocked and active demand",async()=>{
 const h=await setup([{g:"a",repo:"r",id:"a",handoff:9},{g:"b",repo:"r",id:"b",handoff:9}],10);
 const group=readGroup(h.store,"a");group.stopped=true;h.store.transaction(()=>saveGroup(h.store,group));
 expect(funded.allocateFundedAllowance(h.store,"b","b",0)?.grant.work.tokens).toBe(1);
 group.stopped=false;Object.assign(group,{archived:{at:0,actor:"human"}});h.store.transaction(()=>saveGroup(h.store,group));
 expect(funded.allocateFundedAllowance(h.store,"a","a",0)).toBeNull();
 expect(funded.allocateFundedAllowance(h.store,"b","b",0)?.grant.work.tokens).toBe(1);
});

it("re-evaluates period rollover and cap removal without inventing a new authored ceiling",async()=>{
 const h=await setup([{g:"g",repo:"r",id:"a",handoff:9}],null);
 const at=Date.parse("2026-10-05T12:00:00Z");
 h.store.db.prepare("INSERT INTO usage_calendar VALUES (1,'UTC',1)").run();
 h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','week',10,0,'human')").run();
 h.store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (?,'older','r',NULL,'pre-ledger',NULL,NULL,NULL,NULL,NULL,10,'unattributed')").run(at);
 expect(funded.allocateFundedAllowance(h.store,"g","a",at)).toBeNull();
 expect(funded.allocateFundedAllowance(h.store,"g","a",at+7*86_400_000)?.grant.work.tokens).toBe(1);
 h.store.db.prepare("DELETE FROM spend_caps").run();
 expect(funded.allocateFundedAllowance(h.store,"g","a",at)?.grant.work.tokens).toBeNull();
 expect(readWork(h.store,"g","a").grant.work.tokens).toBeNull();
});
it("deducts real start-unknown commitments and never includes the occupied work as idle demand",async()=>{
 const h=await setup([{g:"a",repo:"r",id:"a",handoff:10},{g:"b",repo:"s",id:"b",handoff:10}],100);
 const claim=claimWork(h.store,{groupId:"a",workItemId:"a",graphVersion:2,targetVersion:1,commandId:"claim",expectedRevision:2,by:"service",capabilities:caps});
 expect(claim.grant.work.tokens).toBe(40);
 const run=readRun(h.store,claim.runId);run.state="unknown";h.store.transaction(()=>saveRun(h.store,run));
 expect(funded.allocateFundedAllowance(h.store,"b","b",0)?.grant.work.tokens).toBe(40);
 expect(funded.allocateFundedAllowance(h.store,"a","a",0)).toBeNull();
});

it("rollover keeps a previous-period start-unknown lease occupied",async()=>{
 const h=await setup([{g:"a",repo:"r",id:"a",handoff:10},{g:"b",repo:"s",id:"b",handoff:10}],null);
 h.store.db.prepare("INSERT INTO usage_calendar VALUES (1,'UTC',1)").run();h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','week',100,0,'human')").run();
 const claim=claimWork(h.store,{groupId:"a",workItemId:"a",graphVersion:2,targetVersion:1,commandId:"claim",expectedRevision:2,by:"service",capabilities:caps});
 expect(claim.grant.work.tokens).toBe(40);
 const run=readRun(h.store,claim.runId);run.state="unknown";h.store.transaction(()=>saveRun(h.store,run));
 const at=Date.parse("2026-10-05T12:00:00Z");
 h.store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (?,'older','r',NULL,'pre-ledger',NULL,NULL,NULL,NULL,NULL,50,'unattributed')").run(at);
 expect(funded.allocateFundedAllowance(h.store,"b","b",at)).toBeNull();
 expect(funded.allocateFundedAllowance(h.store,"b","b",at+7*86_400_000)?.grant.work.tokens).toBe(40);
});

it("admits dependency-ready work after a prior landing puts the group into review",async()=>{
 const h=await setup([{g:"g",repo:"r",id:"a",handoff:10},{g:"g",repo:"r",id:"b",handoff:10}],null);
 h.store.transaction(()=>{const group=readGroup(h.store,"g");group.status="review";saveGroup(h.store,group);const a=readWork(h.store,"g","a");a.status="done";saveWork(h.store,"g",a);const b=readWork(h.store,"g","b");b.dependsOn=["a"];saveWork(h.store,"g",b);});
 for(const status of DISPATCHABLE_GROUP_STATES){h.store.transaction(()=>{const group=readGroup(h.store,"g");group.status=status as typeof group.status;saveGroup(h.store,group);});expect(funded.allocateFundedAllowance(h.store,"g","b",0)?.grant.work.tokens).toBeNull();}
});

it.each([100,300])("preserves full fixed legacy demand alongside optional demand under cap %s",async cap=>{
 const h=await setup([{g:"a-legacy",repo:"r",id:"legacy",handoff:10,tokens:60},{g:"b-new",repo:"r",id:"new",handoff:10}],cap);
 h.store.transaction(()=>{const group=readGroup(h.store,"a-legacy");group.limit.tokens=null;group.reserved.tokens=70;Object.assign(group,{planHash:"historical",proposal:{state:"confirmed"}});saveGroup(h.store,group);funded.saveTokenPolicy(h.store,"a-legacy","",null,"finite-legacy");funded.saveTokenPolicy(h.store,"a-legacy","legacy",60,"finite-legacy");});
 expect(funded.allocateFundedAllowance(h.store,"a-legacy","legacy",0)?.grant.work.tokens).toBe(60);
 expect(funded.allocateFundedAllowance(h.store,"b-new","new",0)?.grant.work.tokens).toBe(cap-80);
});
it("credits a fixed legacy group's existing reservation and skips its unfit full grant without partial funding",async()=>{
 const h=await setup([{g:"a-legacy",repo:"r",id:"legacy",handoff:10,tokens:60},{g:"b-new",repo:"r",id:"new",handoff:10}],69);
 h.store.transaction(()=>{const group=readGroup(h.store,"a-legacy");group.limit.tokens=70;group.reserved.tokens=70;Object.assign(group,{planHash:"historical",proposal:{state:"confirmed"}});saveGroup(h.store,group);funded.saveTokenPolicy(h.store,"a-legacy","",70,"finite-legacy");funded.saveTokenPolicy(h.store,"a-legacy","legacy",60,"finite-legacy");});
 expect(funded.allocateFundedAllowance(h.store,"a-legacy","legacy",0)).toBeNull();expect(funded.allocateFundedAllowance(h.store,"b-new","new",0)?.grant.work.tokens).toBe(59);
 h.store.db.prepare("UPDATE spend_caps SET tokens=100").run();expect(funded.allocateFundedAllowance(h.store,"a-legacy","legacy",0)?.grant.work.tokens).toBe(60);
 expect(funded.allocateFundedAllowance(h.store,"b-new","new",0)?.grant.work.tokens).toBe(20);
});

it("uses the full edited finite legacy authority without subtracting prior settled usage twice",async()=>{
 const h=await setup([{g:"g",repo:"r",id:"a",handoff:10,tokens:100}],null);
 h.store.transaction(()=>{funded.saveTokenPolicy(h.store,"g","",null,"finite-legacy");funded.saveTokenPolicy(h.store,"g","a",100,"finite-legacy");});
 const run=claimWork(h.store,{groupId:"g",workItemId:"a",graphVersion:2,targetVersion:1,commandId:"claim",expectedRevision:2,by:"service",capabilities:caps});
 recordUsage(h.store,{runId:run.runId,generation:1,eventSeq:1,bucket:"work",cumulative:amount(40,50,1,1),source:{artifactId:"usage",hash:"a".repeat(64)}});
 recordUsage(h.store,{runId:run.runId,generation:1,eventSeq:2,bucket:"handoff",cumulative:amount(0,0,0,0),source:{artifactId:"usage-handoff",hash:"b".repeat(64)}});
 h.store.transaction(()=>{const old=readRun(h.store,run.runId);old.state="settled";saveRun(h.store,old);h.store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(run.runId);const work=readWork(h.store,"g","a");work.status="ready";work.grant.work=amount(60,9950,9,9);saveWork(h.store,"g",work);funded.saveTokenPolicy(h.store,"g","a",60,"finite-legacy");});
 expect(funded.allocateFundedAllowance(h.store,"g","a",0)).toMatchObject({grant:{work:amount(60,9950,9,9)},inheritedUsage:amount(0,0,0,0)});
});
