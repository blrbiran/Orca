import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { expect,it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";
import { readWork } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
it("stops an unbounded task with its authored ceiling intact, then admits a finite group ceiling",async()=>{
 const x=await driverHarness([{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1",killGraceMs:0,behaviour:()=>"stoppable"});
 const driver=x.driver();try {
  const id=await x.claim();await x.until(driver,()=>x.body(id).state==="accepted");
  const before=readControlGroup(x.h.store,"epoch","g").ledger.groupLimit;
  expect(x.service.setLimit(x.h.command("set-limit",{limit:{...before,tokens:5_000_000}}))).toMatchObject({error:{code:"active-unbounded-budget-conflict"}});
  await x.service.handoffStop(x.h.command("handoff-stop",{}));
  await x.until(driver,()=>{const r=x.body(id);if(r.state==="blocked")throw new Error(JSON.stringify(r.drive));return r.state==="settled-recoverable";});
  expect(readWork(x.h.store,"g","a").grant.work.tokens).toBeNull();
  expect(x.service.setLimit(x.h.command("set-limit",{limit:{...before,tokens:5_000_000}}))).not.toHaveProperty("error");
  expect(readControlGroup(x.h.store,"epoch","g").ledger.groupLimit.tokens).toBe(5_000_000);
  expect(await x.service.resumeFromHandoff(x.h.command("resume-from-handoff",{selections:[{taskId:"a",predecessorRunId:id,checkpointId:x.body(id).checkpointId}]}))).not.toHaveProperty("error");
  const continued=await deliverScheduledStart(x.dispatch,"g");expect(continued.kind).toBe("claimed");if(continued.kind!=="claimed")return;
  expect(x.body(continued.runId).grant.work).toMatchObject({attempts:2,sessions:2});
  expect(x.body(continued.runId).grant.work.tokens).toBeGreaterThan(0);expect(x.body(continued.runId).grant.work.tokens).toBeLessThan(5_000_000);
  expect(x.body(continued.runId).tokenPolicy.inheritedUsage.tokens).toBe(10);
 }finally{await driver.stop();await x.h.dispose();}
});

it("holds an unknown nullable stop and refuses remaining-grant settlement",async()=>{
 const x=await driverHarness([{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1",killGraceMs:0,behaviour:()=>"stoppable-usage-unknown"});const driver=x.driver();try {
  const id=await x.claim();await x.until(driver,()=>x.body(id).state==="accepted");
  const before=readControlGroup(x.h.store,"epoch","g").ledger.committedRemaining.tokens;
  await x.service.handoffStop(x.h.command("handoff-stop",{}));
  await x.until(driver,()=>{const r=x.body(id);if(r.state==="blocked")throw new Error(JSON.stringify(r.drive));return r.state==="settled-unrecoverable";});
  const view=readControlGroup(x.h.store,"epoch","g");expect(view.ledger.usageUnknown).toBe(true);expect(view.ledger.committedRemaining.tokens).toBe(before);
  expect(view.runs[0]!.unknownUsageSettlement).toMatchObject({allowed:false,refusalReason:"run-usage-not-settleable"});
  expect(x.service.setSpendCap({schema:"orca-raw-command-v1",commandId:"cap-after-unknown",actorId:"human",expectedRevision:0,verb:"set-spend-cap",target:{kind:"spend"},payload:{scope:"all",period:"total",tokens:5_000_000}})).toMatchObject({error:{code:"active-unbounded-budget-conflict"}});
 }finally{await driver.stop();await x.h.dispose();}
});

it("a fresh retry preserves prior finite attempts and sessions under unlimited tokens",async()=>{
 const x=await driverHarness([{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1",killGraceMs:0,behaviour:()=>"failed"});const driver=x.driver();try {
  const first=await x.claim();await x.until(driver,()=>x.body(first).state==="blocked");
  expect(x.service.retryTask(x.h.command("retry-task",{taskId:"a"}))).not.toHaveProperty("error");
  await driver.round();await deliverScheduledStart(x.dispatch,"g");
  expect(x.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g'").all()).toHaveLength(2);
  const next=String(x.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' ORDER BY rowid DESC LIMIT 1").get()!.id);expect(next).not.toBe(first);
  expect(x.body(next).grant.work).toMatchObject({tokens:null,attempts:2,sessions:2});
  expect(x.body(next).tokenPolicy.inheritedUsage).toMatchObject({tokens:10,attempts:1,sessions:1});
 }finally{await driver.stop();await x.h.dispose();}
});
