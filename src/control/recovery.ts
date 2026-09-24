import type { ControlStore } from "./store.js";
import type { ExecutionPort } from "./executionPort.js";
import { reconcileStart, deliverSchedulerWakes, type WakeHandlers } from "./dispatch.js";
import { isWebWorkRun } from "./webDispatch.js";
import { readRun } from "./budget.js";
import { readCommittedCheckpoint,verifyCandidateArtifacts,repairAcceptedWork } from "./checkpoints.js";
import { publishPending } from "./projection.js";
import { cleanupCommittedRun } from "./cleanup.js";
import { ControlService } from "./service.js";
import { collectControlled,disposeControlled,confirmLanding } from "./schedulerBridge.js";
import { acquireRepoLock } from "../scheduler/repoLock.js";

/** Recovery never creates a replacement run or executes a Git merge. */
export async function recoverControl(store:ControlStore,port:ExecutionPort,wakes?:{handlers:WakeHandlers},options:{driverOwnsWebRuns?:boolean}={}):Promise<{blockedRunIds:string[];replayedProjectionIds:string[];pendingWakeIds:string[]}> {
 const release=store.beginOperation();
 try {
 store.assertOwner();store.dispatchBlocked=true;
 const service=new ControlService(store,port),blocked=new Set<string>();
 for(const row of store.db.prepare("SELECT id,body FROM outbox WHERE kind='landing' AND delivered=0").all()) {
  const intent=JSON.parse(String(row.body));let lock;
  try {lock=await acquireRepoLock(intent.repo);if(!await confirmLanding(service,String(row.id),intent))for(const id of intent.runIds)blocked.add(id);}
  catch{for(const id of intent.runIds)blocked.add(id);}finally{await lock?.release();}
 }
 for(const row of store.db.prepare("SELECT id FROM runs ORDER BY rowid").all()) {
  const runId=String(row.id);
  // Execution driver spec §4: with a driver present, a Web work run is the driver's to reconcile, run by run.
  if(options.driverOwnsWebRuns && isWebWorkRun(store,runId)) continue;
  let run=readRun(store,runId);
  try {
   if(run.checkpointId) await verifyCandidateArtifacts(store,await readCommittedCheckpoint(store,runId));
   if(run.state==="settled") {await repairAcceptedWork(store,runId);continue;}
   if(!store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='start'").get("start:"+runId)) {blocked.add(runId);continue;}
   await reconcileStart(store,port,runId);run=readRun(store,runId);
   if(run.state==="unknown") {blocked.add(runId);continue;}
   const report=await collectControlled(service,runId);
   if(!report.terminal) {blocked.add(runId);continue;}
   await disposeControlled(service,{runId,workdir:report.terminal.sourceDir,outcome:report.terminal.outcome,attemptSha:report.terminal.attemptSha},
    {keepBecause:"recovery preserves source unless cleanup was durably authorized"});
   if(readRun(store,runId).state!=="settled")blocked.add(runId);
  }catch(error){
   blocked.add(runId);
   store.transaction(()=>store.db.prepare("INSERT INTO outbox VALUES (?, 'recovery-error', ?, 0) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run("recovery-error:"+runId,JSON.stringify({runId,error:error instanceof Error?error.message:String(error)})));
  }
 }
 const pending=store.db.prepare("SELECT id,body FROM outbox WHERE kind='projection' AND delivered=0").all();
 try{await publishPending(store);}catch{for(const row of pending)blocked.add(JSON.parse(String(row.body)).runId);}
 const replayedProjectionIds=pending.filter(row=>store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(String(row.id))?.delivered===1).map(row=>String(row.id));
 for(const row of store.db.prepare("SELECT body FROM outbox WHERE kind='cleanup' AND delivered=0").all()) {
  const input=JSON.parse(String(row.body));
  if(blocked.has(input.runId))continue;
  try{await cleanupCommittedRun(store,input.runId,input.sourceDir);}catch{blocked.add(input.runId);}
 }
 store.dispatchBlocked=blocked.size>0;
 // Pending wakes are the durable record of an intent the crashed scheduler never
 // carried out; they are drained only after this process owns the store and the
 // run walk has decided whether dispatch is safe.
 const delivery=wakes?await deliverSchedulerWakes(store,wakes.handlers):{deferred:[] as string[]};
 return {blockedRunIds:[...blocked].sort(),replayedProjectionIds,pendingWakeIds:delivery.deferred};
 } finally {release();}
}
