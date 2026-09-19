import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ControlStore } from "./store.js";
import type { Candidate, ArtifactRef } from "./types.js";
import { ControlError } from "./errors.js";
import { readArtifact } from "./archive.js";
import { verifySnapshot } from "./snapshot.js";
import { readRun, releaseRunReserve, saveRun } from "./budget.js";
import { readGroup, readWork, saveGroup } from "./queries.js";
import { privateDirectory, syncDirectory, assertRegular } from "./paths.js";
import { idSchema,safeInteger } from "./schema.js";
import { hashPayload } from "./commands.js";
export interface CommitDependencies {afterArchive?:()=>Promise<void>;afterTransaction?:()=>Promise<void>}
function assertIdentity(store:ControlStore,c:Candidate):void {
 const r=readRun(store,c.runId),g=readGroup(store,c.groupId),w=readWork(store,c.groupId,c.workItemId);
 if(r.groupId!==c.groupId || r.workItemId!==c.workItemId || r.taskId!==c.taskId || r.generation!==c.generation || r.graphVersion!==c.graphVersion || g.graphVersion!==c.graphVersion || r.targetVersion!==c.targetVersion || w.targetVersion!==c.targetVersion) throw new ControlError("checkpoint-identity-conflict");
 if(c.usageHighWater!==r.highWater) throw new ControlError("checkpoint-usage-high-water");
}
export async function verifyCandidateArtifacts(store:ControlStore,c:Candidate):Promise<void> {
 for(const ref of c.artifacts) await readArtifact(store,ref);
 if(c.snapshot){await readArtifact(store,c.snapshot);if(c.result==="complete") await verifySnapshot(store,c.snapshot);}
 else if(c.result==="complete") throw new ControlError("snapshot-required");
 for(const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<=?").all(c.runId,c.usageHighWater)) {
  const event=JSON.parse(String(row.body));await readArtifact(store,event.source);
 }
 if(c.stopProof){
  const raw=JSON.parse((await readArtifact(store,c.stopProof.source)).toString());const r=readRun(store,c.runId);
  if(!raw.isolated || raw.executionId!==c.stopProof.executionId || raw.generation!==c.stopProof.generation || r.executionId!==raw.executionId || r.generation!==raw.generation) throw new ControlError("run-stop-unconfirmed");
 }
}
export async function acceptanceEvidence(store:ControlStore,runId:string):Promise<boolean> {
 const row=store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='acceptance'").get("acceptance:"+runId);
 if(!row) return false;const record=JSON.parse(String(row.body));
 const proof=JSON.parse((await readArtifact(store,record.source as ArtifactRef)).toString());
 return record.runId===runId && record.accepted===true && proof.runId===runId && proof.checksPassed===true && proof.landing==="landed";
}
async function persistImmutableCheckpoint(store:ControlStore,c:Candidate):Promise<{checkpointId:string;hash:string}> {
 const dir=privateDirectory(join(store.stateDir,"checkpoints",c.runId));const path=join(dir,c.checkpointId+".json");const bytes=Buffer.from(JSON.stringify(c));
 try {const file=await open(path,"wx",0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}syncDirectory(dir);}
 catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST") throw error;assertRegular(path);if(!(await readFile(path)).equals(bytes)) throw new ControlError("checkpoint-id-conflict");}
 return {checkpointId:c.checkpointId,hash:createHash("sha256").update(bytes).digest("hex")};
}
export async function commitCandidate(store:ControlStore,c:Candidate,deps:CommitDependencies={}):Promise<{checkpointId:string;hash:string}> {
 idSchema.parse(c.runId);idSchema.parse(c.checkpointId);safeInteger.parse(c.usageHighWater);
 if(!["complete","partial","failed"].includes(c.result)) throw new ControlError("checkpoint-result-invalid");
 await verifyCandidateArtifacts(store,c);
 const accepted=await acceptanceEvidence(store,c.runId);
 const reference=await persistImmutableCheckpoint(store,c);await deps.afterArchive?.();
 const result=store.transaction(()=>{
  const previous=store.db.prepare("SELECT hash,body FROM checkpoints WHERE id=?").get(c.checkpointId);
  if(previous){if(previous.hash!==reference.hash || hashPayload(JSON.parse(String(previous.body)))!==hashPayload(c)) throw new ControlError("checkpoint-id-conflict");return reference;}
  assertIdentity(store,c);let run=readRun(store,c.runId);
  if(run.state==="settled") throw new ControlError("checkpoint-run-settled");
  const pending=store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(c.runId,run.highWater);
  const settled=!!c.stopProof && c.unresolvedRequestIds.length===0 && !pending && !run.unknown.work && !run.unknown.handoff;
  store.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?)").run(c.checkpointId,c.runId,reference.hash,JSON.stringify(c));
  if(settled) releaseRunReserve(store,c.runId,c.stopProof!);
  run=readRun(store,c.runId);run.checkpointId=c.checkpointId;
  run.recoverable=settled && c.result==="complete" && c.missing.length===0 && !!c.snapshot;saveRun(store,run);
  const work=readWork(store,c.groupId,c.workItemId);work.status=run.recoverable && accepted ? "done":"blocked";
  store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work),c.groupId,c.workItemId);
  const group=readGroup(store,c.groupId);group.status="review";saveGroup(store,group);
  store.db.prepare("INSERT INTO outbox VALUES (?, 'projection', ?, 0)").run("projection:"+c.checkpointId,JSON.stringify({runId:c.runId,...reference}));
  return reference;
 });
 await deps.afterTransaction?.();return result;
}
export async function readCommittedCheckpoint(store:ControlStore,runId:string):Promise<Candidate> {
 const run=readRun(store,runId);
 if(!run.checkpointId) throw new ControlError("checkpoint-not-committed");
 const row=store.db.prepare("SELECT hash,body FROM checkpoints WHERE id=? AND run_id=?").get(run.checkpointId,runId);
 if(!row) throw new ControlError("checkpoint-not-committed");
 const path=join(store.stateDir,"checkpoints",runId,run.checkpointId+".json");assertRegular(path);const bytes=await readFile(path);
 if(createHash("sha256").update(bytes).digest("hex")!==row.hash || !bytes.equals(Buffer.from(String(row.body)))) throw new ControlError("checkpoint-hash-mismatch");
 return JSON.parse(bytes.toString());
}
