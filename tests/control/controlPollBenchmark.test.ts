import { describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordActivity } from "../../src/control/activity.js";
import { normalizeOutput, captureDatabase, restoreDatabase, storePending } from "../bench/controlPollPerformance.js";
import { buildControlPollFixture, openExistingControlPollFixture, dagTasks } from "./fixtures/controlPollPerformance.js";
import { installControlReadCounters } from "./fixtures/controlReadCounters.js";
import { readGroupSummary, readControlGroup } from "../../src/panel/controlViews.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";

async function withFreshRoot(run: (root: string) => Promise<void>): Promise<void> {
 const root=await realpath(await mkdtemp(join(tmpdir(),"orca-control-poll-")));
 const previousRoot=process.env.ORCA_PERFORMANCE_ROOT;
 process.env.ORCA_PERFORMANCE_ROOT=root;
 try {await run(root);} finally {
  if(previousRoot===undefined)delete process.env.ORCA_PERFORMANCE_ROOT;else process.env.ORCA_PERFORMANCE_ROOT=previousRoot;
  await rm(root,{recursive:true,force:true});
 }
}
describe("real-path benchmark integrity",()=>{
 it("normalizes only run identity and keeps all business hashes and refusal detail",()=>{
  expect(normalizeOutput({runId:"run-random",hash:"a".repeat(64),detail:"run-invalid:run-random",nested:["run-random"]},new Map([["run-random","live-000/t00/1"]]))).toEqual({runId:"live-000/t00/1",hash:"a".repeat(64),detail:"run-invalid:live-000/t00/1",nested:["live-000/t00/1"]});
 });
 it("builds one legal store with DAG, current runs, activities and a real replenishment",async()=>withFreshRoot(async()=>{
  const f=await buildControlPollFixture({liveGroups:2,archivedGroups:2,tasksPerGroup:3,now:1791518400000});
  try {
   expect(f.manifest()).toEqual({liveGroups:2,archivedGroups:2,tasks:6,dependencies:6,runs:2,pendingTargetWakes:6});
   expect(dagTasks(3).map(t=>t.dependsOn)).toEqual([[],["t00"],["t01","t00"]]);
   const counter=installControlReadCounters(f.store);let counted=0;
   try {
    for(const id of f.liveGroupIds)expect(readControlGroup(f.store,"benchmark",id).runs).toHaveLength(1);
    readGroupSummary(f.store,f.liveGroupIds[0]);counted=counter.snapshot().executions.length;
   } finally {counter.restore();}
   readGroupSummary(f.store,f.liveGroupIds[0]);expect(counter.snapshot().executions.length).toBe(counted);
   const nativePending=f.store.db.prepare("SELECT id,group_id,kind,body,delivered FROM scheduler_wakes ORDER BY rowid").all();
   const pending=storePending(f.store);
   expect(Object.getPrototypeOf(pending[0])).toBe(Object.prototype);
   expect(pending).toStrictEqual(JSON.parse(JSON.stringify(nativePending)));
   const initial=captureDatabase(f.store);
   f.store.transaction(()=>recordActivity(f.store,{groupId:f.liveGroupIds[0],kind:"command",body:{restore:true}}));
   restoreDatabase(f.store,initial);
   f.store.transaction(()=>recordActivity(f.store,{groupId:f.liveGroupIds[0],kind:"command",body:{restore:true}}));
   const seq=Number(f.store.db.prepare("SELECT MAX(seq) AS n FROM activity").get()!.n);
   const originalSeq=Number(initial.find(t=>t.name==="activity")!.rows.at(-1)!.seq);
   expect(seq).toBe(originalSeq+1);
   restoreDatabase(f.store,initial);expect(captureDatabase(f.store)).toEqual(initial);
   expect(replenishStartWakes(f.driverDeps)).toEqual(["drive:live-000:1"]);
  } finally {await f.dispose();}
 }),30000);
 it("refuses a nontemporary sandbox before either writable fixture entry initializes data",async()=>{
  const root=await realpath(await mkdtemp(join(process.cwd(),".orca-control-poll-sandbox-")));
  const previousRoot=process.env.ORCA_PERFORMANCE_ROOT;process.env.ORCA_PERFORMANCE_ROOT=root;
  try {
   await writeFile(join(root,"sandbox-sentinel"),"preserve me",{mode:0o600});
   for(const entry of ["build","open"]){
    let error:unknown,f:Awaited<ReturnType<typeof buildControlPollFixture>>|undefined;
    try {f=entry==="build"?await buildControlPollFixture({liveGroups:0,archivedGroups:0,tasksPerGroup:1,now:1791518400000}):await openExistingControlPollFixture(1791518400000);}catch(failure){error=failure;}finally{await f?.dispose();}
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("control-poll-fixture-root-not-temporary");
    expect(await readFile(join(root,"sandbox-sentinel"),"utf8")).toBe("preserve me");expect(await readdir(root)).toEqual(["sandbox-sentinel"]);
   }
  } finally {
   if(previousRoot===undefined)delete process.env.ORCA_PERFORMANCE_ROOT;else process.env.ORCA_PERFORMANCE_ROOT=previousRoot;
   await rm(root,{recursive:true,force:true});
  }
 });
 it("refuses a nonempty temporary root before removing a sentinel or initializing data",async()=>withFreshRoot(async root=>{
  const sentinel=join(root,"unowned-sentinel");await writeFile(sentinel,"preserve me",{mode:0o600});
  let error:unknown,f:Awaited<ReturnType<typeof buildControlPollFixture>>|undefined;
  try {f=await buildControlPollFixture({liveGroups:0,archivedGroups:0,tasksPerGroup:1,now:1791518400000});}catch(failure){error=failure;}finally{await f?.dispose();}
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("control-poll-fixture-root-not-empty");
  expect(await readFile(sentinel,"utf8")).toBe("preserve me");expect(await readdir(root)).toEqual(["unowned-sentinel"]);
 }));
});
