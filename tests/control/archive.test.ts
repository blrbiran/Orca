import { describe,it,expect } from "vitest";
import { rename, readFile, writeFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { archiveRun,readArtifact,writeArtifact } from "../../src/control/archive.js";
import { verifySnapshot } from "../../src/control/snapshot.js";
import { archiveCase } from "./fixtures/archive.js";
import { openTestStore } from "./fixtures/store.js";
describe("independent evidence archive",()=>{
 it("reads every original log after the complete source directory has moved",async()=>{
  const h=await archiveCase();try{
   const result=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:h.stopProof});
   expect(result.missing).toEqual([]);await rename(h.sourceDir,h.sourceDir+"-retained");
   await verifySnapshot(h.store,result.snapshot!);
   const contents=await Promise.all(result.artifacts.map(ref=>readArtifact(h.store,ref)));
   for(const file of ["stdout.log","stderr.log","usage.json","verification.log","contract.json","config.json"]) expect(contents.some(b=>b.equals(Buffer.from("raw "+file+"\n")))).toBe(true);
   for(let i=0;i<contents.length;i++) expect(createHash("sha256").update(contents[i]).digest("hex")).toBe(result.artifacts[i].hash);
  }finally{await h.dispose();}
 });
 it("rejects immutable ID conflict, forged hashes and traversal, with private archive files",async()=>{
  const h=await openTestStore();try{
   const ref=await writeArtifact(h.store,"sample",Buffer.from("first"));
   expect(await writeArtifact(h.store,"sample",Buffer.from("first"))).toEqual(ref);
   await expect(writeArtifact(h.store,"sample",Buffer.from("different"))).rejects.toThrow("artifact-id-conflict");
   await expect(readArtifact(h.store,{...ref,hash:"0".repeat(64)})).rejects.toThrow("artifact-hash-mismatch");
   for(const id of ["../escape","/absolute"]) await expect(writeArtifact(h.store,id,Buffer.from("x"))).rejects.toThrow();
   expect((await stat(join(h.store.stateDir,"artifacts","sample","data"))).mode&0o777).toBe(0o600);
   await writeFile(join(h.store.stateDir,"artifacts","sample","data"),"corrupt");
   await expect(readArtifact(h.store,ref)).rejects.toThrow("artifact-hash-mismatch");
  }finally{await h.dispose();}
 });
 it("refuses archive parent symlinks rather than writing outside state",async()=>{
  const h=await openTestStore();try{
   await symlink(h.root,join(h.store.stateDir,"artifacts"));
   await expect(writeArtifact(h.store,"escape",Buffer.from("x"))).rejects.toThrow("control-path-symlink");
  }finally{await h.dispose();}
 });
 it("retains source on a publication failure and never calls a missing stop proof complete",async()=>{
  const h=await archiveCase();try{
   const result=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:null});
   expect(result.missing).toContain("stop-unconfirmed");
   await expect(verifySnapshot(h.store,result.snapshot!)).rejects.toThrow("snapshot-partial");
   await expect(archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:h.stopProof},{beforePublish:()=>{throw Object.assign(new Error("ENOSPC"),{code:"ENOSPC"});}})).rejects.toThrow("ENOSPC");
   expect(await readFile(join(h.sourceDir,"stdout.log"),"utf8")).toBe("raw stdout.log\n");
  }finally{await h.dispose();}
 });
 it("syncs file contents before publishing a readable immutable reference",async()=>{
  const h=await openTestStore();try{
   const steps:string[]=[];
   const ref=await writeArtifact(h.store,"ordered",Buffer.from("durable"),{syncFile:async file=>{await file.sync();steps.push("synced");},beforePublish:()=>{expect(steps).toEqual(["synced"]);steps.push("published");}});
   expect((await readArtifact(h.store,ref)).toString()).toBe("durable");expect(steps).toEqual(["synced","published"]);
  }finally{await h.dispose();}
 });

});
