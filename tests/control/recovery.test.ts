import { describe,it,expect } from "vitest";
import { crashCase } from "./fixtures/crashCase.js";
import { readRun } from "../../src/control/budget.js";
describe("crash recovery with real SIGKILL",()=>{
 for(const point of ["after-claim","after-accept","after-archive","after-transaction","before-projection","before-cleanup"]) it(point,async()=>{
  const sample=await crashCase(point);try{
   const first=await sample.recover(),second=await sample.recover();
   expect(second.used).toEqual(first.used);expect(second.launches).toBe(first.launches);
   expect(second.landingCount).toBe(first.landingCount);expect(second.referencedHashes).toEqual(first.referencedHashes);
   expect(first.launches).toBe(point==="after-claim"?0:1);
   expect(first.landingCount).toBe(["after-claim","after-accept"].includes(point)?0:1);
   if(point==="after-claim"){expect(first.blockedRunIds).toContain(sample.info.runId);expect(readRun(sample.store,sample.info.runId).state).toBe("claimed");}
   else {expect(first.used.tokens).toBe(1);expect(readRun(sample.store,sample.info.runId).state).toBe("settled");expect(first.referencedHashes.length).toBeGreaterThan(0);}
  }finally{await sample.dispose();}
 },30000);
});

// Tester #393 residual: a recovery that blocks dispatch changes what the overview reports (the global
// `dispatch-blocked` row), but it never moved the projection cursor, so an incremental poll answered the tiny empty
// shape and the row stayed invisible until some unrelated group moved.
it("a recovery that sets the dispatch latch moves the projection cursor (#393)",async()=>{
 const sample=await crashCase("after-claim");try{
  const {readProjectionChanges,readProjectionState}=await import("../../src/control/projectionJournal.js");
  const before=readProjectionState(sample.store).changeSeq;
  const result=await sample.recover();
  expect(result.blockedRunIds).toContain(sample.info.runId);
  expect(readProjectionChanges(sample.store,before).groups.map((group)=>group.groupId)).toContain("g1");
 }finally{await sample.dispose();}
},30000);

it("advances a partial checkpoint when later isolation evidence arrives",async()=>{
 const sample=await crashCase("after-accept");try{
  const {recoverControl}=await import("../../src/control/recovery.js");
  const {roundPeer}=await import("./fixtures/roundPeer.js");
  const {join}=await import("node:path");const peer=roundPeer(join(sample.root,"peer"));
  const partial={...peer,collect:async(...args:Parameters<typeof peer.collect>)=>{const report=await peer.collect(...args);return {...report,candidate:report.candidate?{...report.candidate,stopProof:null}:null};}};
  const first=await recoverControl(sample.store,partial);expect(first.blockedRunIds).toContain(sample.info.runId);
  const before=readRun(sample.store,sample.info.runId);expect(before.state).not.toBe("settled");expect(before.checkpointId).not.toBeNull();
  const second=await recoverControl(sample.store,peer);expect(second.blockedRunIds).toEqual([]);
  expect(readRun(sample.store,sample.info.runId).state).toBe("settled");
  expect(readRun(sample.store,sample.info.runId).checkpointId).not.toBe(before.checkpointId);
 }finally{await sample.dispose();}
},30000);

it("keeps an unknown accepted run active with its reserved budget",async()=>{
 const sample=await crashCase("after-accept");try{
  const {recoverControl}=await import("../../src/control/recovery.js");const {roundPeer}=await import("./fixtures/roundPeer.js");const {join}=await import("node:path");
  const before=readRun(sample.store,sample.info.runId).remaining;
  const peer={...roundPeer(join(sample.root,"peer")),inspect:async()=>({kind:"unknown" as const})};
  for(let n=0;n<2;n++){expect((await recoverControl(sample.store,peer)).blockedRunIds).toContain(sample.info.runId);expect(readRun(sample.store,sample.info.runId).remaining).toEqual(before);}
  expect(sample.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);expect(readRun(sample.store,sample.info.runId).state).toBe("unknown");
 }finally{await sample.dispose();}
},30000);
