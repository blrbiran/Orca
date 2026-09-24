import { createHash, randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ControlStore } from "./store.js";
import type { Candidate, ArtifactRef } from "./types.js";
import { ControlError } from "./errors.js";
import { readArtifact } from "./archive.js";
import { verifySnapshot } from "./snapshot.js";
import { readRun, releaseRunReserve, saveRun, hasObservedUsage } from "./budget.js";
import { readGroup, readWork, saveGroup, saveWork } from "./queries.js";
import { privateDirectory, syncDirectory, assertRegular } from "./paths.js";
import { candidateSchema } from "./schema.js";
import { hashPayload } from "./commands.js";
export interface CommitDependencies {
 afterArchive?:()=>Promise<void>;
 afterTransaction?:()=>Promise<void>;
 admit?<T>(operation:()=>Promise<T>):Promise<T>;
}
function assertIdentity(store:ControlStore,c:Candidate):void {
 const r=readRun(store,c.runId),g=readGroup(store,c.groupId),w=readWork(store,c.groupId,c.workItemId);
 if(r.groupId!==c.groupId || r.workItemId!==c.workItemId || r.taskId!==c.taskId || r.generation!==c.generation || r.graphVersion!==c.graphVersion || g.graphVersion!==c.graphVersion || r.targetVersion!==c.targetVersion || w.targetVersion!==c.targetVersion) throw new ControlError("checkpoint-identity-conflict");
 if(c.usageHighWater!==r.highWater) throw new ControlError("checkpoint-usage-high-water");
}
export async function verifyCandidateArtifacts(store:ControlStore,c:Candidate):Promise<void> {
 for(const ref of c.artifacts) await readArtifact(store,ref);
 await readArtifact(store,c.handoff);
 if(c.snapshot){await readArtifact(store,c.snapshot);if(c.result==="complete") await verifySnapshot(store,c.snapshot);}
 else if(c.result==="complete") throw new ControlError("snapshot-required");
 for(const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<=?").all(c.runId,c.usageHighWater)) {
  const event=JSON.parse(String(row.body));await readArtifact(store,event.source);
 }
 if(c.stopProof){
  const raw=JSON.parse((await readArtifact(store,c.stopProof.source)).toString());const r=readRun(store,c.runId);
  if(raw.isolated!==true || raw.executionId!==c.stopProof.executionId || raw.generation!==c.stopProof.generation || r.executionId!==raw.executionId || r.generation!==raw.generation) throw new ControlError("run-stop-unconfirmed");
 }
}
export async function acceptanceEvidence(store:ControlStore,runId:string):Promise<boolean> {
 const row=store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='acceptance'").get("acceptance:"+runId);
 if(!row) return false;const record=JSON.parse(String(row.body));
 const proof=JSON.parse((await readArtifact(store,record.source as ArtifactRef)).toString());
 return record.runId===runId && record.accepted===true && proof.runId===runId && proof.checksPassed===true && proof.landing==="landed";
}
async function persistImmutableCheckpoint(store:ControlStore,c:Candidate):Promise<{checkpointId:string;hash:string}> {
 const dir=privateDirectory(join(store.stateDir,"checkpoints",c.runId)),path=join(dir,c.checkpointId+".json");
 const bytes=Buffer.from(JSON.stringify(c)),temp=join(dir,".staging-"+randomUUID());
 const file=await open(temp,"wx",0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 // The service owns this directory. Keep the final existence check and rename in
 // one synchronous section so concurrent commits cannot replace immutable IDs.
 store.assertOwner();
 if(existsSync(path)) {
  assertRegular(path);const previous=readFileSync(path);
  if(previous.equals(bytes)) return {checkpointId:c.checkpointId,hash:createHash("sha256").update(bytes).digest("hex")};
  if(store.db.prepare("SELECT id FROM checkpoints WHERE id=?").get(c.checkpointId)) throw new ControlError("checkpoint-id-conflict");
  let valid=false;try{JSON.parse(previous.toString());valid=true;}catch{}
  if(valid) throw new ControlError("checkpoint-id-conflict");
  // Retain evidence from pre-atomic writers without treating a torn file as a
  // committed checkpoint or allowing replacement of a different valid object.
  renameSync(path,join(dir,".interrupted-"+randomUUID()));
 }
 renameSync(temp,path);syncDirectory(dir);
 return {checkpointId:c.checkpointId,hash:createHash("sha256").update(bytes).digest("hex")};
}
export async function commitCandidate(store:ControlStore,c:Candidate,deps:CommitDependencies={}):Promise<{checkpointId:string;hash:string}> {
 c=candidateSchema.parse(c);
 await verifyCandidateArtifacts(store,c);
 const accepted=await acceptanceEvidence(store,c.runId);
 const commit=async()=>{
 const reference=await persistImmutableCheckpoint(store,c);await deps.afterArchive?.();
 return store.transaction(()=>{
  const previous=store.db.prepare("SELECT hash,body FROM checkpoints WHERE id=?").get(c.checkpointId);
  if(previous){if(previous.hash!==reference.hash || hashPayload(JSON.parse(String(previous.body)))!==hashPayload(c)) throw new ControlError("checkpoint-id-conflict");return reference;}
  assertIdentity(store,c);let run=readRun(store,c.runId);
  if(run.state==="settled") throw new ControlError("checkpoint-run-settled");
  const pending=store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(c.runId,run.highWater);
  const settled=!!c.stopProof && c.unresolvedRequestIds.length===0 && !pending && !run.unknown.work && !run.unknown.handoff && hasObservedUsage(store,run);
  store.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?)").run(c.checkpointId,c.runId,reference.hash,JSON.stringify(c));
  if(settled) releaseRunReserve(store,c.runId,c.stopProof!);
  run=readRun(store,c.runId);run.checkpointId=c.checkpointId;
  // Ruling (2026-09-22, §6.3 correction): `recoverable` answers one question -- can this
  // checkpoint be continued from -- and a settled run whose dirty snapshot arrived complete can,
  // even when the task stopped before finishing. Whether the task *finished* is `completed`.
  // The two were one boolean, which made §6.3's continuation unreachable by construction: only a
  // finished task could be `recoverable`, and a finished task is never the predecessor to continue.
  const continuable=settled && c.missing.length===0 && !!c.snapshot;
  const completed=continuable && c.result==="complete";
  run.recoverable=continuable;saveRun(store,run);
  const work=readWork(store,c.groupId,c.workItemId);work.status=completed && accepted ? "done":"blocked";
  saveWork(store,c.groupId,work);
  // Final review I1 (controller ruling, 2026-09-25): a Web group blocked by a budget breach (usage.ts) stays
  // blocked through a settle; `review` would re-open it to dispatch, and that block is its only brake.
  const group=readGroup(store,c.groupId);if(!("planHash" in group && group.status==="blocked"))group.status="review";saveGroup(store,group);
  store.db.prepare("INSERT INTO outbox VALUES (?, 'projection', ?, 0)").run("projection:"+c.checkpointId,JSON.stringify({runId:c.runId,...reference}));
  const taskCheckpointRefs=[] as Array<{taskId:string;checkpointId:string;checkpointHash:string}>;const seen=new Set<string>();
  for(const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid DESC").all(c.groupId)){const value=JSON.parse(String(row.body));if(!value.taskId||!value.checkpointId||seen.has(value.taskId))continue;seen.add(value.taskId);const checkpoint=store.db.prepare("SELECT hash FROM checkpoints WHERE id=? AND run_id=?").get(value.checkpointId,value.runId);if(checkpoint)taskCheckpointRefs.push({taskId:value.taskId,checkpointId:value.checkpointId,checkpointHash:String(checkpoint.hash)});}
  taskCheckpointRefs.sort((a,b)=>a.taskId.localeCompare(b.taskId));
  if(c.taskId)store.db.prepare("INSERT INTO outbox VALUES (?, 'task-handoff', ?, 0)").run(`task-handoff:${c.groupId}:${c.taskId}:${c.checkpointId}`,JSON.stringify({groupId:c.groupId,taskId:c.taskId,runId:c.runId,checkpointId:c.checkpointId,checkpointHash:reference.hash}));
  const groupCheckpointId=hashPayload({groupId:c.groupId,revision:group.revision,budgetVersion:group.budgetVersion,taskCheckpointRefs});
  store.db.prepare("INSERT INTO outbox VALUES (?, 'group-handoff', ?, 0) ON CONFLICT(id) DO NOTHING").run(`group-handoff:${c.groupId}:${groupCheckpointId}`,JSON.stringify({groupId:c.groupId,groupCheckpointId,revision:group.revision,budgetVersion:group.budgetVersion,taskCheckpointRefs}));
  return reference;
 });};
 const result=await (deps.admit?deps.admit(commit):commit());
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

/** Business acceptance can arrive after final accounting; never settle twice. */
export async function repairAcceptedWork(store:ControlStore,runId:string,deps:{admit?<T>(operation:()=>T):T}={}):Promise<void> {
 const run=readRun(store,runId);
 if(run.state!=="settled" || !run.recoverable) return;
 const c=await readCommittedCheckpoint(store,runId);await verifyCandidateArtifacts(store,c);
 // Acceptance completes a task; it does not finish an interrupted one. `recoverable` says the
 // checkpoint is continuable, which an unfinished task's checkpoint also is.
 if(c.result!=="complete") return;
 if(!await acceptanceEvidence(store,runId)) return;
 const repair=()=>store.transaction(()=>{
  const current=readRun(store,runId),work=readWork(store,run.groupId,run.workItemId),group=readGroup(store,run.groupId);
  if(current.checkpointId!==c.checkpointId || work.targetVersion!==run.targetVersion || group.graphVersion!==run.graphVersion || current.state!=="settled" || !current.recoverable) return;
  work.status="done";saveWork(store,run.groupId,work);
 });
 deps.admit?deps.admit(repair):repair();
}
