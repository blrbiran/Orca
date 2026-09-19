import { describe,it,expect } from "vitest";
import { join } from "node:path";
import { stat,writeFile } from "node:fs/promises";
import { commitCandidate } from "../../src/control/checkpoints.js";
import { cleanupCommittedRun } from "../../src/control/cleanup.js";
import { readArtifact,writeArtifact } from "../../src/control/archive.js";
import { getRun } from "../../src/control/queries.js";
import { candidateCase } from "./fixtures/candidate.js";
describe("cleanup authorization",()=>{
 it("requires committed recoverable evidence and durable acceptance before removing only the registered run",async()=>{
  const h=await candidateCase();try{
   await expect(cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir)).rejects.toThrow("checkpoint-not-committed");
   await commitCandidate(h.store,h.candidate);
   await expect(cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir)).rejects.toThrow("landing-not-confirmed");
   const acceptance=await writeArtifact(h.store,"acceptance",Buffer.from(JSON.stringify({runId:h.claim.runId,checksPassed:true,landing:"landed"})));
   h.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1)").run("acceptance:"+h.claim.runId,JSON.stringify({runId:h.claim.runId,accepted:true,source:acceptance}));
   await expect(cleanupCommittedRun(h.store,h.claim.runId,h.root)).rejects.toThrow("cleanup-path-invalid");
   await expect(cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir,{beforeCleanup:async()=>{throw new Error("cleanup-io-failure");}})).rejects.toThrow("cleanup-io-failure");
   expect((await stat(h.sourceDir)).isDirectory()).toBe(true);expect(h.store.db.prepare("SELECT id FROM runs").all()).toHaveLength(1);
   expect(getRun(h.store,h.claim.runId).state).toBe("settled");
   expect(await cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir)).toEqual({removed:true});
   expect(await cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir)).toEqual({removed:false});
   await expect(stat(h.sourceDir)).rejects.toThrow();
   for(const ref of h.candidate.artifacts) expect((await readArtifact(h.store,ref)).length).toBeGreaterThan(0);
   expect(getRun(h.store,h.claim.runId).state).toBe("settled");
  }finally{await h.dispose();}
 });
 it("refuses deletion when archived content was corrupted after commit",async()=>{
  const h=await candidateCase();try{
   await commitCandidate(h.store,h.candidate);
   const acceptance=await writeArtifact(h.store,"acceptance",Buffer.from(JSON.stringify({runId:h.claim.runId,checksPassed:true,landing:"landed"})));
   h.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1)").run("acceptance:"+h.claim.runId,JSON.stringify({runId:h.claim.runId,accepted:true,source:acceptance}));
   const ref=h.candidate.artifacts[0];await writeFile(join(h.store.stateDir,"artifacts",ref.artifactId,"data"),"corrupt");
   await expect(cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir)).rejects.toThrow("artifact-hash-mismatch");
   expect((await stat(h.sourceDir)).isDirectory()).toBe(true);
  }finally{await h.dispose();}
 });
});
