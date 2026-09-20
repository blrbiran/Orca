import { describe,it,expect } from "vitest";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { commitCandidate,readCommittedCheckpoint,repairAcceptedWork } from "../../src/control/checkpoints.js";
import { writeArtifact } from "../../src/control/archive.js";
import { publishPending } from "../../src/control/projection.js";
import { getGroup,getRun,readVersions,readWork } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { candidateCase } from "./fixtures/candidate.js";
describe("checkpoint authority",{timeout:30000},()=>{
 it("commits once before projection and survives a projection failure without refunding usage",async()=>{
  const h=await candidateCase();try{
   await expect(readCommittedCheckpoint(h.store,h.claim.runId)).rejects.toThrow("checkpoint-not-committed");
   const committed=await commitCandidate(h.store,h.candidate);const before=getGroup(h.store,"g1");
   expect(before.used.tokens).toBe(40);expect(before.reserved.tokens).toBe(10);
   expect(getRun(h.store,h.claim.runId).recoverable).toBe(true);
   await expect(publishPending(h.store,{writeProjection:async()=>{throw new Error("projection-write-failed");}})).rejects.toThrow("projection-write-failed");
   expect((await readCommittedCheckpoint(h.store,h.claim.runId)).checkpointId).toBe(committed.checkpointId);
   await publishPending(h.store);await commitCandidate(h.store,h.candidate);await publishPending(h.store);
   expect(getGroup(h.store,"g1")).toEqual(before);
   expect(JSON.parse(await readFile(join(h.store.stateDir,"projections",h.claim.runId,"latest.json"),"utf8")).checkpointId).toBe("cp1");
   expect(getGroup(h.store,"g1").status).not.toBe("done");
   expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE id='T1'").get()?.body)).status).not.toBe("done");
  }finally{await h.dispose();}
 });
 it.each(["stop","requests","gap","unknown"])("retains active ownership and reserves for partial %s evidence",async why=>{
  const h=await candidateCase();try{
   const c={...h.candidate,result:"partial" as const};
   if(why==="stop") c.stopProof=null;
   if(why==="requests") c.unresolvedRequestIds=["pending"];
   if(why==="gap") recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:4,bucket:"work",cumulative:{tokens:50,activeMs:30,attempts:1,sessions:1},source:c.artifacts.at(-2)!});
   if(why==="unknown") {recordUsage(h.store,{runId:c.runId,generation:1,eventSeq:3,bucket:"work",cumulative:null,source:c.artifacts.at(-2)!});c.usageHighWater=3;}
   const reserved=getGroup(h.store,"g1").reserved;await commitCandidate(h.store,c);
   expect(getGroup(h.store,"g1").reserved).toEqual(reserved);expect(getRun(h.store,c.runId).recoverable).toBe(false);
   expect(h.store.db.prepare("SELECT active FROM runs").get()?.active).toBe(1);
  }finally{await h.dispose();}
 });
 it("keeps immutable older checkpoints and ignores late projection replay",async()=>{
  const h=await candidateCase();try{
   await commitCandidate(h.store,{...h.candidate,result:"partial",stopProof:null});
   const second=await commitCandidate(h.store,{...h.candidate,checkpointId:"cp2"});await publishPending(h.store);
   expect(JSON.parse(await readFile(join(h.store.stateDir,"checkpoints",h.claim.runId,"cp1.json"),"utf8")).result).toBe("partial");
   h.store.db.prepare("UPDATE outbox SET delivered=0 WHERE id='projection:cp1'").run();await publishPending(h.store);
   const latest=JSON.parse(await readFile(join(h.store.stateDir,"projections",h.claim.runId,"latest.json"),"utf8"));expect(latest.checkpointId).toBe("cp2");expect(latest.hash).toBe(second.hash);
   await expect(commitCandidate(h.store,{...h.candidate,checkpointId:"old",targetVersion:0})).rejects.toThrow("checkpoint-identity-conflict");
  }finally{await h.dispose();}
 });
 it("does not recover from a checkpoint file whose committed hash no longer matches",async()=>{
  const h=await candidateCase();try{
   await commitCandidate(h.store,h.candidate);
   await writeFile(join(h.store.stateDir,"checkpoints",h.claim.runId,"cp1.json"),"{}\n");
   await expect(readCommittedCheckpoint(h.store,h.claim.runId)).rejects.toThrow("checkpoint-hash-mismatch");
  }finally{await h.dispose();}
 });
 it("does not grant recovery or publish latest when interrupted between file fsync and database commit",async()=>{
  const h=await candidateCase();try{
   await expect(commitCandidate(h.store,h.candidate,{afterArchive:async()=>{throw new Error("crash-before-transaction");}})).rejects.toThrow("crash-before-transaction");
   expect(JSON.parse(await readFile(join(h.store.stateDir,"checkpoints",h.claim.runId,"cp1.json"),"utf8")).checkpointId).toBe("cp1");
   await expect(readCommittedCheckpoint(h.store,h.claim.runId)).rejects.toThrow("checkpoint-not-committed");
   await expect(readFile(join(h.store.stateDir,"projections",h.claim.runId,"latest.json"))).rejects.toThrow();
   expect(getGroup(h.store,"g1").reserved.tokens).toBe(40);
   await commitCandidate(h.store,h.candidate);expect(getRun(h.store,h.claim.runId).recoverable).toBe(true);
  }finally{await h.dispose();}
 });
 it("projects post-acceptance work repair exactly once",async()=>{
  const h=await candidateCase();try{
   await commitCandidate(h.store,h.candidate);
   expect(readWork(h.store,"g1","T1").status).toBe("blocked");
   const acceptance=await writeArtifact(h.store,"late-acceptance",Buffer.from(JSON.stringify({runId:h.claim.runId,checksPassed:true,landing:"landed"})));
   h.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1)").run("acceptance:"+h.claim.runId,JSON.stringify({runId:h.claim.runId,accepted:true,source:acceptance}));
   const before=readVersions(h.store,"g1");
   await repairAcceptedWork(h.store,h.claim.runId);
   expect(readWork(h.store,"g1","T1").status).toBe("done");
   expect(readVersions(h.store,"g1")).toEqual({commandRevision:before.commandRevision,projectionSeq:before.projectionSeq+1});
   await repairAcceptedWork(h.store,h.claim.runId);
   expect(readVersions(h.store,"g1")).toEqual({commandRevision:before.commandRevision,projectionSeq:before.projectionSeq+1});
  }finally{await h.dispose();}
 });

});
