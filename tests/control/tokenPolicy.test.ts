import { describe, expect, it } from "vitest";
import * as policy from "../../src/control/tokenPolicy.js";
import { amountSchema } from "../../src/control/schema.js";

// Deleting nullable handling must turn unbounded positive usage into exhaustion;
// deleting finite Amount validation must let corrupt usage enter arithmetic.
describe("authored token policy", () => {
  it("keeps unlimited ceilings while subtracting finite observations and enforcing other dimensions", () => {
    expect(policy.remainingBudget({tokens:null,activeMs:100,attempts:2,sessions:3},{tokens:4_800_000,activeMs:40,attempts:1,sessions:2})).toEqual({tokens:null,activeMs:60,attempts:1,sessions:1});
    expect(policy.budgetFits({tokens:4_800_000,activeMs:101,attempts:1,sessions:1},{tokens:null,activeMs:100,attempts:2,sessions:3})).toBe(false);
    expect(policy.budgetFits({tokens:4_800_000,activeMs:40,attempts:1,sessions:1},{tokens:null,activeMs:100,attempts:2,sessions:3})).toBe(true);
  });
  it("keeps zero a real ceiling and combines only actual finite binders", () => {
    expect(policy.minTokenCeiling(null,12)).toBe(12);
    expect(policy.minTokenCeiling(null,null)).toBeNull();
    expect(policy.minTokenCeiling(null,0)).toBe(0);
    expect(policy.remainingBudget({tokens:10,activeMs:100,attempts:2,sessions:3},{tokens:12,activeMs:40,attempts:1,sessions:2}).tokens).toBe(0);
  });
  it("does not reinterpret unknown remaining as unlimited", () => {
    expect(policy.tokenRemainingStatus(100,true)).toBe("unknown");
    expect(policy.tokenRemainingStatus(null,false)).toBe("unlimited");
    expect(policy.tokenRemainingStatus(null,true)).toBe("unknown");
  });
  it("refuses nullable and unsafe usage, even below an unlimited ceiling", () => {
    for (const tokens of [null,Infinity,-1,Number.MAX_SAFE_INTEGER+1]) {
      const invalid={tokens,activeMs:0,attempts:0,sessions:0};
      expect(amountSchema.safeParse(invalid).success).toBe(false);
      expect(()=>policy.remainingBudget({tokens:null,activeMs:100,attempts:2,sessions:3},invalid as never)).toThrow();
    }
  });
});

import { webFixture } from "./fixtures/web.js";
import { readBudgetProposal, readGroup, readWork } from "../../src/control/queries.js";
import { ESTIMATE_GRANT, GOAL_REVIEW, TASK_HANDOFF } from "../../src/control/estimator.js";
it("imports advisory forecasts without authoring a cumulative task or group ceiling",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try {
  const proposal=readBudgetProposal(h.store,"g"),group=readGroup(h.store,"g"),work=readWork(h.store,"g","a");
  expect(proposal.groupLimit.tokens).toBeNull();expect(work.grant.work.tokens).toBeNull();
  expect(proposal.allocations.find(a=>a.ownerId==="a"&&a.bucket==="work")!.amount.tokens).toBeNull();
  expect(group.reserved.tokens).toBe(ESTIMATE_GRANT.tokens+GOAL_REVIEW.tokens);
  expect(work.grant.handoff).toEqual(TASK_HANDOFF);
  expect(group.reserved.activeMs).toBe(20_700_000);
 }finally{await h.dispose();}
});

import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
it("confirms the new nullable policy and exposes valid draft and confirmed projections",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try {
  expect(readControlGroup(h.store,"epoch","g").ledger.groupLimit.tokens).toBeNull();
  const service=new WebControlService(h.deps),result=await service.confirm(h.command("confirm",await h.confirmPayload()));
  expect(result).not.toHaveProperty("error");
  expect(readBudgetProposal(h.store,"g").state).toBe("confirmed");
  expect(readControlGroup(h.store,"epoch","g").ledger.groupLimit.tokens).toBeNull();
 }finally{await h.dispose();}
});

it("respects an explicitly authored finite handwritten token ceiling",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:99_000}],{tokenPolicy:"optional-v1"});try {
 expect(readWork(h.store,"g","a").grant.work.tokens).toBe(99_000);
 }finally{await h.dispose();}
});
import { expandLoopTask, expandRecipe } from "../../src/control/loopPlans.js";
it("defaults new recipes to unlimited without rewriting historical recipe expansion",()=>{
 const input={goal:"ship",successCondition:"passes",targetPaths:["src"],checks:["true"]};
 const newest=expandLoopTask("a","/repo",input,[]);expect(newest.ok).toBe(true);if(!newest.ok)return;
 expect((newest.contract.executionPolicy as {tokenBudget:unknown}).tokenBudget).toBeNull();
 for(const planVersion of [1,2]) {
  const old=expandRecipe("a","/repo",{...newest.recipe,planVersion});expect(old.ok).toBe(true);
  if(old.ok)expect((old.contract.executionPolicy as {tokenBudget:unknown}).tokenBudget).toBe(3_000_000);
 }
 const finite=expandLoopTask("a","/repo",{...input,tokenBudget:99_000} as never,[]);
 expect(finite.ok&&((finite.contract.executionPolicy as {tokenBudget:unknown}).tokenBudget)).toBe(99_000);
});

import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readRun, saveRun, releaseRunReserve } from "../../src/control/budget.js";
import { recordUsage } from "../../src/control/usage.js";
it("claims a new nullable task and exposes finite observed usage beyond the former default",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try {
 const service=new WebControlService(h.deps);
 expect(await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}))).not.toHaveProperty("error");
 expect(await service.start(h.command("start",{}))).not.toHaveProperty("error");
 const claim=await deliverScheduledStart(h.deps,"g");expect(claim.kind).toBe("claimed");if(claim.kind!=="claimed")return;
 const run=readRun(h.store,claim.runId);expect(run.grant.work.tokens).toBeNull();
 recordUsage(h.store,{runId:run.runId,generation:1,eventSeq:1,bucket:"work",cumulative:{tokens:4_800_000,activeMs:100,attempts:1,sessions:1},source:{artifactId:"usage",hash:"a".repeat(64)}});
 expect(readRun(h.store,run.runId).breaches).toEqual([]);
 const view=readControlGroup(h.store,"epoch","g");expect(view.ledger.used.tokens).toBe(4_800_000);expect(view.ledger.groupLimit.tokens).toBeNull();
 }finally{await h.dispose();}
});

it("keeps reconciliation independently finite while preserving larger explicitly finite demands",()=>{
 expect(policy.finiteReconcileTokens([null])).toBe(3_000_000);
 expect(policy.finiteReconcileTokens([99_000,200_000])).toBe(200_000);
 expect(policy.finiteReconcileTokens([null,5_000_000])).toBe(5_000_000);
});

it("edits a task ceiling finite then unlimited without changing its finite usage or handoff reserve",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try {
 const service=new WebControlService(h.deps);
 for(const value of [500,null]) {
  const result=service.editProposal(h.command("proposal-edit",{baseProposalVersion:readBudgetProposal(h.store,"g").proposalVersion,operations:[{target:{scope:"task",taskId:"a",allocation:"work",dimension:"tokens"},value,provenance:"human"}]} as never));
  expect(result).not.toHaveProperty("error");expect(readWork(h.store,"g","a").grant.work.tokens).toBe(value);
  expect(readGroup(h.store,"g").reserved.tokens).toBe(1_250_000);
 }
 }finally{await h.dispose();}
});

import { beginProviderAttempt, settleProviderAttempt } from "../../src/control/webDispatch.js";
it("reclaims a proved no-provider funded lease without duplicating token or non-token commitments",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try {
  const service=new WebControlService(h.deps);await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}));await service.start(h.command("start",{}));
  const first=await deliverScheduledStart(h.deps,"g");expect(first.kind).toBe("claimed");if(first.kind!=="claimed")return;
  const committed=readGroup(h.store,"g").reserved;
  settleProviderAttempt(h.deps,{runId:first.runId,phase:"work",firstAttemptProof:"invalid"});
  const second=await deliverScheduledStart(h.deps,"g");expect(second.kind).toBe("claimed");if(second.kind!=="claimed")return;
  expect(readGroup(h.store,"g").reserved).toEqual(committed);expect(readRun(h.store,second.runId).cumulative.work).toEqual({tokens:0,activeMs:0,attempts:0,sessions:0});
 }finally{await h.dispose();}
});

it("refuses a missing authored policy record instead of interpreting a nullable body as an unlimited grant",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try {
  const service=new WebControlService(h.deps);await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}));await service.start(h.command("start",{}));
  h.store.db.prepare("DELETE FROM token_policies WHERE group_id='g' AND work_item_id=''").run();
  await expect(deliverScheduledStart(h.deps,"g")).rejects.toThrow("token-policy-identity");
  expect(h.store.db.prepare("SELECT id FROM runs").all()).toEqual([]);
 }finally{await h.dispose();}
});

it("defers a cap-funded claim with the actual cap named in its read model",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try {
  const service=new WebControlService(h.deps);await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}));await service.start(h.command("start",{}));
  h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',10,0,'human')").run();
  expect(await deliverScheduledStart(h.deps,"g")).toEqual({kind:"blocked",reason:"spend-cap-reached"});
  expect(readControlGroup(h.store,"epoch","g").spendCapBlock).toMatchObject({code:"spend-cap-reached",scope:"all",period:"total",capTokens:10});
 }finally{await h.dispose();}
});

it("clears a historical group ceiling explicitly while preserving its finite task grants",async()=>{
 const h=await webFixture();try{
  const service=new WebControlService(h.deps),before=readGroup(h.store,"g");
  expect(await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}))).not.toHaveProperty("error");
  expect(await service.start(h.command("start",{}))).not.toHaveProperty("error");
  const claim=await deliverScheduledStart(h.deps,"g");expect(claim.kind).toBe("claimed");if(claim.kind!=="claimed")return;
  const reserved=readGroup(h.store,"g").reserved;
  expect(service.setLimit(h.command("set-limit",{limit:{...before.limit,tokens:null}}))).not.toHaveProperty("error");
  expect(readGroup(h.store,"g").reserved).toEqual(reserved);
  expect(readRun(h.store,claim.runId).grant.work.tokens).toBe(3_000_000);
  expect(readControlGroup(h.store,"epoch","g").ledger.groupLimit.tokens).toBeNull();
 }finally{await h.dispose();}
});
it("an explicit pre-start task ceiling removal converts only mutable funding bookkeeping",async()=>{
 const h=await webFixture();try{
  const service=new WebControlService(h.deps);
  expect(service.editProposal(h.command("proposal-edit",{baseProposalVersion:1,operations:[{target:{scope:"task",taskId:"a",allocation:"work",dimension:"tokens"},value:null,provenance:"human"}]}))).not.toHaveProperty("error");
  expect(readWork(h.store,"g","a").grant.work.tokens).toBeNull();
  expect(readGroup(h.store,"g").reserved.tokens).toBe(1_250_000);
 }finally{await h.dispose();}
});

it("rechecks the current cap period after an awaited probe crosses rollover",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try{
  const service=new WebControlService(h.deps);await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}));await service.start(h.command("start",{}));
  h.store.db.prepare("INSERT INTO usage_calendar VALUES (1,'UTC',1)").run();h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','week',1900000,0,'human')").run();
  let now=Date.parse("2026-10-11T23:59:59Z"),enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
  const router={...h.deps.profileRouter,probe:async(...args:Parameters<typeof h.deps.profileRouter.probe>)=>{enter();await held;return h.deps.profileRouter.probe(...args);}};
  const pending=deliverScheduledStart({...h.deps,profileRouter:router,now:()=>new Date(now)},"g");await entered;
  now=Date.parse("2026-10-12T00:00:01Z");
  h.store.transaction(()=>h.store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (?,'other','repo',NULL,'pre-ledger',NULL,NULL,NULL,NULL,NULL,1900000,'unattributed')").run(now));release();
  expect(await pending).toEqual({kind:"blocked",reason:"spend-cap-reached"});expect(h.store.db.prepare("SELECT id FROM runs").all()).toEqual([]);
 }finally{await h.dispose();}
});


it("rejects a stale optional policy ceiling while preserving authoritative legal legacy limit edits",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",tokenBudget:99_000}],{tokenPolicy:"optional-v1"});try{
  const service=new WebControlService(h.deps);await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}));await service.start(h.command("start",{}));
  h.store.db.prepare("UPDATE token_policies SET tokens=9000000 WHERE group_id='g' AND work_item_id=''").run();
  await expect(deliverScheduledStart(h.deps,"g")).rejects.toThrow("token-policy-identity");expect(h.store.db.prepare("SELECT id FROM runs").all()).toEqual([]);
 }finally{await h.dispose();}
});
it("claims and releases mixed explicit finite and null tasks after a pre-start owner edit",async()=>{
 const h=await webFixture(undefined,[{taskId:"a"},{taskId:"b"}]);try{
  const service=new WebControlService(h.deps);
  expect(service.editProposal(h.command("proposal-edit",{baseProposalVersion:1,operations:[{target:{scope:"task",taskId:"a",allocation:"work",dimension:"tokens"},value:null,provenance:"human"}]}))).not.toHaveProperty("error");
  expect(readWork(h.store,"g","b").grant.work.tokens).toBe(3_000_000);
  expect(await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}))).not.toHaveProperty("error");
  expect(service.setLimit(h.command("set-limit",{limit:{...readGroup(h.store,"g").limit,tokens:null}}))).not.toHaveProperty("error");
  await service.start(h.command("start",{}));const claim=await deliverScheduledStart(h.deps,"g");expect(claim.kind).toBe("claimed");if(claim.kind!=="claimed")return;
  expect(readRun(h.store,claim.runId).grant.work.tokens).toBeNull();const committed=readGroup(h.store,"g").reserved;
  expect(beginProviderAttempt(h.deps,claim.runId,"work").kind).toBe("reserved");
  recordUsage(h.store,{runId:claim.runId,generation:1,eventSeq:1,bucket:"work",cumulative:{tokens:4_800_000,activeMs:100,attempts:1,sessions:1},source:{artifactId:"usage",hash:"b".repeat(64)}});
  expect(readGroup(h.store,"g").used.tokens).toBe(4_800_000);expect(readControlGroup(h.store,"epoch","g").ledger.groupLimit.tokens).toBeNull();
  expect(readGroup(h.store,"g").reserved.tokens).toBe(committed.tokens);
  recordUsage(h.store,{runId:claim.runId,generation:1,eventSeq:2,bucket:"handoff",cumulative:{tokens:0,activeMs:0,attempts:0,sessions:0},source:{artifactId:"handoff-usage",hash:"c".repeat(64)}});
  h.store.transaction(()=>{const run=readRun(h.store,claim.runId);run.executionId="fake-stopped";saveRun(h.store,run);releaseRunReserve(h.store,run.runId,{executionId:"fake-stopped",generation:1,isolated:true,source:{artifactId:"stop",hash:"d".repeat(64)}});});
  expect(readGroup(h.store,"g").reserved.tokens).toBe(ESTIMATE_GRANT.tokens+GOAL_REVIEW.tokens);expect(readGroup(h.store,"g").used.tokens).toBe(4_800_000);
  expect(readControlGroup(h.store,"epoch","g").ledger.used.tokens).toBe(4_800_000);
 }finally{await h.dispose();}
});


import { createGroup, putWork } from "../../src/control/commands.js";
import { claimWork } from "../../src/control/budget.js";
import { amount, caps, fixtureAgent } from "./fixtures/store.js";
it("an actual optional claim leaves the full historical finite claim admissible under their shared cap",async()=>{
 const h=await webFixture();try{
  const service=new WebControlService(h.deps);expect(await service.confirm(h.command("confirm",{...await h.confirmPayload(),budgetMode:"soft"}))).not.toHaveProperty("error");expect(await service.start(h.command("start",{}))).not.toHaveProperty("error");
  createGroup(h.store,{groupId:"h",projectKey:"other",goal:"new task",successConditions:["done"],budgetMode:"soft",limit:{...amount(0,1_000_000,100,100),tokens:null},reviewReserve:amount(0,0,0,0),deadlineAt:null},{commandId:"h-create",expectedRevision:0,by:"human"});
  putWork(h.store,"h",{workItemId:"a",taskId:"a",kind:"task",dependsOn:[],contract:{},configHash:"config",agent:fixtureAgent,grant:{work:{...amount(0),tokens:null},handoff:amount(10,0,0,0)}},{commandId:"h-put",expectedRevision:1,by:"human"});
  h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',3600000,0,'human')").run();
  const optional=claimWork(h.store,{groupId:"h",workItemId:"a",graphVersion:2,targetVersion:1,commandId:"h-claim",expectedRevision:2,by:"service",capabilities:caps});expect(optional.grant.work.tokens).toBe(299_990);
  const fixed=await deliverScheduledStart(h.deps,"g");expect(fixed.kind).toBe("claimed");if(fixed.kind!=="claimed")return;
  expect(readRun(h.store,fixed.runId).grant.work.tokens).toBe(3_000_000);expect(h.store.db.prepare("SELECT run_id FROM funded_allowances WHERE run_id=?").get(fixed.runId)).toBeUndefined();
 }finally{await h.dispose();}
});
