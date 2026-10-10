import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { validateAllowanceCheckpoint } from "../../src/control/fundedAllowance.js";
import { readDriverRun, readStartEnvelope } from "../../src/control/executionDriver.js";
import { readCommittedCheckpoint } from "../../src/control/checkpoints.js";
import { readArtifact, writeArtifact } from "../../src/control/archive.js";
import { afterAll, describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { ccloopWorlds, realBinary, startGroup, workRuns, until } from "./fixtures/ccloopWorld.js";
import { readWork } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
const worlds=ccloopWorlds({rootPrefix:"orca-token-policy-",epochPrefix:"token-policy-"});
afterAll(worlds.removeRoots);
describe.skipIf(!realBinary)("paired source nullable token lifecycle",()=>{
 worlds.relocateHome("orca-token-policy-home-");
 it("finishes beyond the old default with a capable peer or refuses nullable work before an old peer spends",async()=>{
  expect(realBinary).toBeTruthy();
  const world=await worlds.world([{taskId:"a",targetPaths:["answer.txt"],loop:{goal:"write answer",successCondition:"answer is 42",targetPaths:["answer.txt"],checks:["test -f answer.txt"]}}],{a:{files:{"answer.txt":"42\n"}}},{tokenPolicy:"optional-v1"});
  const command=world.agentsTable.installations.codex.command as string[];
  command.splice(1,0,resolve("tests/control/fixtures/fake-token-codex.mjs"));
  await writeFile(world.table,JSON.stringify(world.agentsTable));
  const runtime=await world.boot();try {
   const features=await runtime.port.readFeatures?.();
   if(features?.tokenPolicy!=="optional-v1"){
    await startGroup(runtime,world.repoId).catch(()=>{});
    expect(JSON.parse(String(runtime.store.db.prepare("SELECT body_json FROM commands WHERE group_id='g' AND id='confirm'").get()!.body_json))).toMatchObject({error:{code:"control-token-policy-unsupported"}});
    expect(world.calls()).toEqual([]);return;
   }
   await startGroup(runtime,world.repoId);runtime.startPump(50);
   await until(()=>{const runs=workRuns(runtime);const blocked=runs.find(r=>r.body.state==="blocked");if(blocked)throw new Error(JSON.stringify(blocked.body.drive));return runs.some(r=>r.body.state==="settled");},60_000,"nullable task settles");
   const run=workRuns(runtime)[0]!.body;
   expect(run.grant.work.tokens).toBeNull();expect(run.cumulative.work.tokens).toBeGreaterThan(3_000_000);
   expect(run.breaches).toEqual([]);expect(world.calls()).toEqual(["plan","execute"]);
   expect(readControlGroup(runtime.store,runtime.epoch,"g").ledger.used.tokens).toBeGreaterThan(3_000_000);
  }finally{await world.teardown();}
 },75_000);
 it.each([null,5_000_000])("renews a saved funded allowance after a cap change without replaying paid planning (authored %s)",async(authored)=>{
  const world=await worlds.world([{taskId:"a",targetPaths:["answer.txt"],loop:{goal:"write answer",successCondition:"answer is 42",targetPaths:["answer.txt"],checks:["test -f answer.txt"],tokenBudget:authored}}],{a:{files:{"answer.txt":"42\n"}}},{tokenPolicy:"optional-v1"});
  (world.agentsTable.installations.codex.command as string[]).splice(1,0,resolve("tests/control/fixtures/fake-token-codex.mjs"));
  await writeFile(world.table,JSON.stringify(world.agentsTable));
  const runtime=await world.boot();try {
   if((await runtime.port.readFeatures?.())?.tokenPolicy!=="optional-v1"){
    if(authored===null){await startGroup(runtime,world.repoId).catch(()=>{});
      expect(JSON.parse(String(runtime.store.db.prepare("SELECT body_json FROM commands WHERE group_id='g' AND id='confirm'").get()!.body_json))).toMatchObject({error:{code:"control-token-policy-unsupported"}});
    }else{
      await startGroup(runtime,world.repoId,0,async()=>{runtime.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run();});
      expect(await deliverScheduledStart({store:runtime.store,profileRouter:runtime.router},"g")).toEqual({kind:"blocked",reason:"control-token-policy-unsupported"});
      expect(workRuns(runtime)).toHaveLength(0);
    }expect(world.calls()).toEqual([]);return;
   }
   await startGroup(runtime,world.repoId,0,async()=>{runtime.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run();});
   runtime.startPump(50);
   await until(()=>{const runs=workRuns(runtime);const blocked=runs.find(r=>r.body.state==="blocked");if(blocked)throw new Error(JSON.stringify(blocked.body.drive));return runs.some(r=>r.body.state==="settled-recoverable");},60_000,"saved allowance waits");
   expect(world.calls()).toEqual(["plan"]);expect(workRuns(runtime)).toHaveLength(1);
   const saved=workRuns(runtime)[0]!,checkpoint=await readCommittedCheckpoint(runtime.store,saved.runId),sourceEnvelope=readStartEnvelope(runtime.store,readDriverRun(runtime.store,saved.runId));
   await expect(validateAllowanceCheckpoint(runtime.store,checkpoint,{...sourceEnvelope,claim:{...sourceEnvelope.claim,workItemId:"foreign"}})).rejects.toThrow("resume-handoff-invalid");
   await expect(validateAllowanceCheckpoint(runtime.store,{...checkpoint,generation:checkpoint.generation+1},sourceEnvelope)).rejects.toThrow("resume-handoff-invalid");
   const packet=JSON.parse((await readArtifact(runtime.store,checkpoint.handoff)).toString());
   const ledger=JSON.parse((await readArtifact(runtime.store,packet.allowanceContinuation.usage)).toString());
   for(const dimension of ["tokens","activeMs","attempts","sessions"] as const){
    const changed=structuredClone(ledger);changed.totals.work[dimension]=Math.max(0,changed.totals.work[dimension]-1);
    changed.events.at(-1).cumulative[dimension]=changed.totals.work[dimension];
    const usage=await writeArtifact(runtime.store,`tampered-usage-${dimension}`,Buffer.from(JSON.stringify(changed)));
    const forged=structuredClone(packet),old=forged.allowanceContinuation.usage;forged.allowanceContinuation.usage=usage;forged.artifacts=forged.artifacts.map((ref:any)=>ref.artifactId===old.artifactId?usage:ref);
    const handoff=await writeArtifact(runtime.store,`tampered-handoff-${dimension}`,Buffer.from(JSON.stringify(forged)));
    await expect(validateAllowanceCheckpoint(runtime.store,{...checkpoint,handoff,artifacts:[...checkpoint.artifacts,usage,handoff]},sourceEnvelope)).rejects.toThrow("resume-handoff-invalid");
   }
   const missing=structuredClone(packet);missing.artifacts=missing.artifacts.filter((ref:any)=>ref.artifactId!==missing.allowanceContinuation.usage.artifactId);
   const handoff=await writeArtifact(runtime.store,"unreachable-usage-handoff",Buffer.from(JSON.stringify(missing)));
   await expect(validateAllowanceCheckpoint(runtime.store,{...checkpoint,handoff},sourceEnvelope)).rejects.toThrow("resume-handoff-invalid");

   runtime.store.transaction(()=>runtime.store.db.prepare(authored===null?"UPDATE spend_caps SET tokens=6000000 WHERE scope='all'":"DELETE FROM spend_caps WHERE scope='all'").run());
   await until(()=>{const runs=workRuns(runtime);const blocked=runs.find(r=>r.body.state==="blocked");if(blocked)throw new Error(JSON.stringify(blocked.body.drive));return readWork(runtime.store,"g","a").status==="done";},60_000,"renewal finishes");
   const runs=workRuns(runtime);expect(runs).toHaveLength(2);expect(world.calls()).toEqual(["plan","execute"]);
   const renewed=runs.find(r=>r.body.tokenPolicy?.inheritedUsage.tokens>0)!.body;
   expect(readStartEnvelope(runtime.store,readDriverRun(runtime.store,renewed.runId)).protocol).toBe(4);
   expect(renewed.tokenPolicy.inheritedUsage.tokens).toBe(1_600_000);
   expect(renewed.cumulative.work.tokens).toBe(1_600_000);
   expect(renewed.tokenPolicy.inheritedUsage.attempts).toBe(1);expect(renewed.tokenPolicy.inheritedUsage.sessions).toBe(1);
   expect(renewed.grant.work.attempts).toBe(2);expect(renewed.grant.work.sessions).toBe(2);
   expect(readControlGroup(runtime.store,runtime.epoch,"g").ledger.used.tokens).toBe(3_200_000);
  }finally{await world.teardown();}
 },135_000);

});
