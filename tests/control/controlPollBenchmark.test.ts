import { describe, expect, it } from "vitest";
import { recordActivity } from "../../src/control/activity.js";
import { normalizeOutput, captureDatabase, restoreDatabase } from "../bench/controlPollPerformance.js";
import { buildControlPollFixture, dagTasks } from "./fixtures/controlPollPerformance.js";
import { installControlReadCounters } from "./fixtures/controlReadCounters.js";
import { readGroupSummary, readControlGroup } from "../../src/panel/controlViews.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
describe("real-path benchmark integrity",()=>{
 it("normalizes only run identity and keeps all business hashes and refusal detail",()=>{
  expect(normalizeOutput({runId:"run-random",hash:"a".repeat(64),detail:"run-invalid:run-random",nested:["run-random"]},new Map([["run-random","live-000/t00/1"]]))).toEqual({runId:"live-000/t00/1",hash:"a".repeat(64),detail:"run-invalid:live-000/t00/1",nested:["live-000/t00/1"]});
 });
 it("builds one legal store with DAG, current runs, activities and a real replenishment",async()=>{
  process.env.ORCA_PERFORMANCE_ROOT="/private/tmp/od9/performance-fixture-test";
  const f=await buildControlPollFixture({liveGroups:2,archivedGroups:2,tasksPerGroup:3,now:1791518400000});
  try {expect(f.manifest()).toEqual({liveGroups:2,archivedGroups:2,tasks:6,dependencies:6,runs:2,pendingTargetWakes:6});
   expect(dagTasks(3).map(t=>t.dependsOn)).toEqual([[],["t00"],["t01","t00"]]);
   for(const id of f.liveGroupIds) expect(readControlGroup(f.store,"benchmark",id).runs).toHaveLength(1);
   const counter=installControlReadCounters(f.store);
   readGroupSummary(f.store,f.liveGroupIds[0]);const counted=counter.snapshot().executions.length;
   counter.restore();readGroupSummary(f.store,f.liveGroupIds[0]);expect(counter.snapshot().executions.length).toBe(counted);
   const initial=captureDatabase(f.store);
   f.store.transaction(()=>recordActivity(f.store,{groupId:f.liveGroupIds[0],kind:"command",body:{restore:true}}));
   restoreDatabase(f.store,initial);
   f.store.transaction(()=>recordActivity(f.store,{groupId:f.liveGroupIds[0],kind:"command",body:{restore:true}}));
   const seq=Number(f.store.db.prepare("SELECT MAX(seq) AS n FROM activity").get()!.n);
   const originalSeq=Number(initial.find(t=>t.name==="activity")!.rows.at(-1)!.seq);
   expect(seq).toBe(originalSeq+1);
   restoreDatabase(f.store,initial); expect(captureDatabase(f.store)).toEqual(initial);
   expect(replenishStartWakes(f.driverDeps)).toEqual(["drive:live-000:1"]);
  } finally {await f.dispose();delete process.env.ORCA_PERFORMANCE_ROOT;}
 },30000);
});
