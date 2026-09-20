import { it,expect } from "vitest";
import { candidateCase } from "./fixtures/candidate.js";
import { commitCandidate } from "../../src/control/checkpoints.js";
import { getGroup } from "../../src/control/queries.js";
import { setGroupLimit } from "../../src/control/commands.js";
import { writeArtifact,readArtifact } from "../../src/control/archive.js";
import { cleanupCommittedRun } from "../../src/control/cleanup.js";
it("retains stable task/group evidence and cumulative usage after source cleanup and limit increase",async()=>{
 const {listGroupArtifacts,listTaskArtifacts}=await import("../../src/control/queries.js");
 const h=await candidateCase();try{
  const source=await writeArtifact(h.store,"accepted-final",Buffer.from(JSON.stringify({runId:h.claim.runId,checksPassed:true,landing:"landed"})));
  h.store.transaction(()=>h.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1)").run("acceptance:"+h.claim.runId,JSON.stringify({runId:h.claim.runId,accepted:true,source})));
  await commitCandidate(h.store,h.candidate);await cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir);
  const before=getGroup(h.store,"g1");setGroupLimit(h.store,"g1",{...before.limit,tokens:200},{commandId:"more-budget",expectedRevision:before.revision,by:"human"});
  expect(getGroup(h.store,"g1").used).toEqual(before.used);expect(getGroup(h.store,"g1").status).toBe("review");
  const group=listGroupArtifacts(h.store,"g1"),task=listTaskArtifacts(h.store,"g1","T1");
  expect(group.length).toBeGreaterThan(0);expect(task).toEqual(group);
  for(const ref of task) expect((await readArtifact(h.store,ref)).length).toBeGreaterThan(0);
 }finally{await h.dispose();}
},30000);

it("does not publish private claim fields inside a checkpoint",async()=>{
 const {readCommittedCheckpoint}=await import("../../src/control/checkpoints.js");
 const h=await candidateCase();try{await commitCandidate(h.store,h.candidate);
  const c=await readCommittedCheckpoint(h.store,h.claim.runId);
  expect(c).not.toHaveProperty("ownerToken");expect(c).not.toHaveProperty("grant");
 }finally{await h.dispose();}
},30000);
it("refuses cleanup when a different directory reuses the registered run path",async()=>{
 const {rename,mkdir,writeFile,readFile}=await import("node:fs/promises");const {join}=await import("node:path");
 const h=await candidateCase();try{
  await commitCandidate(h.store,{...h.candidate,terminalOutcome:"failed"});
  await rename(h.sourceDir,h.sourceDir+"-original");await mkdir(h.sourceDir);await writeFile(join(h.sourceDir,"keep"),"new identity");
  await expect(cleanupCommittedRun(h.store,h.claim.runId,h.sourceDir)).rejects.toThrow("cleanup-source-reused");
  expect(await readFile(join(h.sourceDir,"keep"),"utf8")).toBe("new identity");
 }finally{await h.dispose();}
},30000);
it("refuses a copied backup without transferring execution ownership",async()=>{
 const {openTestStore,seedBudgetCase}=await import("./fixtures/store.js");
 const {openControlStore}=await import("../../src/control/store.js");
 const {cp,readFile}=await import("node:fs/promises");const {join}=await import("node:path");
 const h=await openTestStore();try{
  seedBudgetCase(h.store);h.store.close();const backup=join(h.root,"backup");await cp(h.store.stateDir,backup,{recursive:true});
  const before=await readFile(join(backup,"control.sqlite"));
  await expect(openControlStore({stateDir:backup,recovery:true})).rejects.toThrow("control-host-mismatch");
  expect(await readFile(join(backup,"control.sqlite"))).toEqual(before);
 }finally{await h.dispose();}
},30000);
it("keeps production execution unavailable",async()=>{
 const {ControlService}=await import("../../src/control/service.js");
 const {openTestStore,seedBudgetCase}=await import("./fixtures/store.js");
 const h=await openTestStore();try{seedBudgetCase(h.store);
  await expect(new ControlService(h.store).claim("g1","T1")).rejects.toThrow("control-protocol-unavailable");
  expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
 }finally{await h.dispose();}
},30000);

it("blocks recovery of a missing current checkpoint instead of selecting an older one",async()=>{
 const {recoverControl}=await import("../../src/control/recovery.js");
 const {getRun}=await import("../../src/control/queries.js");
 const {unlink}=await import("node:fs/promises");const {join}=await import("node:path");
 const h=await candidateCase();try{
  await commitCandidate(h.store,{...h.candidate,result:"partial",stopProof:null});
  await commitCandidate(h.store,{...h.candidate,checkpointId:"cp2"});const before=getGroup(h.store,"g1").used;
  await unlink(join(h.store.stateDir,"checkpoints",h.claim.runId,"cp2.json"));
  const result=await recoverControl(h.store,{} as never);
  expect(result.blockedRunIds).toContain(h.claim.runId);expect(getRun(h.store,h.claim.runId).checkpointId).toBe("cp2");expect(getGroup(h.store,"g1").used).toEqual(before);
 }finally{await h.dispose();}
},30000);
it("rejects malformed peer capability booleans",async()=>{
 const {ControlService}=await import("../../src/control/service.js");const {openTestStore,seedBudgetCase,caps}=await import("./fixtures/store.js");
 const h=await openTestStore();try{seedBudgetCase(h.store);
  const service=new ControlService(h.store,{capabilities:async()=>({...caps,durableAccept:"false"})} as never);
  await expect(service.claim("g1","T1")).rejects.toThrow();
  expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
 }finally{await h.dispose();}
},30000);
