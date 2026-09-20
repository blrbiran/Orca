import type { ControlStore } from "./store.js";
import type { ExecutionPort, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { RunView } from "./types.js";
import { assertCapabilities, readRun, saveRun } from "./budget.js";
import { getRun, readGroup, readWork } from "./queries.js";
import { hashPayload } from "./commands.js";
import { assertClaimIdentity } from "./ownership.js";
import { ControlError } from "./errors.js";
import { startEnvelopeSchema } from "./schema.js";
import type { AdmissionGate } from "./admissionGate.js";

function admitted<T>(gate:AdmissionGate|undefined,write:()=>T):T {
 const release=gate?.enter();try{return write();}finally{release?.();}
}
export function readEnvelope(store:ControlStore,runId:string):StartEnvelope {
 const row=store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='start'").get("start:"+runId);
 if(!row) throw new ControlError("start-intent-missing");return JSON.parse(String(row.body));
}
function persistStatus(store:ControlStore,input:StartEnvelope,status:ExecutionStatus,gate?:AdmissionGate):RunView {
 return admitted(gate,()=>store.transaction(()=>{
  assertClaimIdentity(store,input.claim);const run=readRun(store,input.claim.runId);
  if(run.state==="settled") return getRun(store,run.runId);
  if(status.kind==="accepted") {
   if(status.configHash!==run.configHash || !status.executionId || (run.executionId!==null && run.executionId!==status.executionId)) throw new ControlError("execution-identity-conflict");
   run.executionId=status.executionId;run.state="accepted";
  } else if(status.kind==="stopped") {
   if(status.proof.generation!==run.generation || !status.proof.isolated || (run.executionId && run.executionId!==status.proof.executionId)) throw new ControlError("execution-identity-conflict");
   run.executionId=status.proof.executionId;run.state="accepted";
   store.db.prepare("INSERT INTO outbox VALUES (?, 'stop', ?, 0) ON CONFLICT(id) DO NOTHING").run("stop:"+run.runId,JSON.stringify(status.proof));
  } else run.state="unknown";
  saveRun(store,run);return getRun(store,run.runId);
 }));
}
async function send(store:ControlStore,port:ExecutionPort,input:StartEnvelope,gate?:AdmissionGate):Promise<RunView> {
 const current=readGroup(store,input.claim.groupId);
 if(current.stopped) throw new ControlError("group-stopped");
 if(store.dispatchBlocked) throw new ControlError("control-recovery-required");
 if(current.deadlineAt && Date.now()>=Date.parse(current.deadlineAt)) throw new ControlError("group-deadline-expired");
 let status:ExecutionStatus;
 try { status=await port.accept(input); }
 catch {
  try {persistStatus(store,input,{kind:"unknown"},gate);} catch(error) {if(error instanceof ControlError&&error.code==="panel-draining")throw error;throw error;}
  throw new ControlError("start-outcome-unknown");
 }
 return persistStatus(store,input,status,gate);
}
export async function startClaim(store:ControlStore,port:ExecutionPort,input:StartEnvelope,gate?:AdmissionGate):Promise<RunView> {
 input=startEnvelopeSchema.parse(input) as StartEnvelope;
 assertClaimIdentity(store,input.claim);
 if(input.protocol!==1) throw new ControlError("control-protocol-unavailable");
 const group=readGroup(store,input.claim.groupId);
 assertCapabilities(group.budgetMode??"strict",await port.capabilities());
 const existing=store.db.prepare("SELECT body FROM outbox WHERE id=?").get("start:"+input.claim.runId);
 if(existing) {
  if(hashPayload(JSON.parse(String(existing.body)))!==hashPayload(input)) throw new ControlError("start-envelope-conflict");
  return reconcileStart(store,port,input.claim.runId,gate);
 }
 if(store.dispatchBlocked) throw new ControlError("control-recovery-required");
 if(readGroup(store,input.claim.groupId).stopped) throw new ControlError("group-stopped");
 if(input.contractHash!==hashPayload(readWork(store,input.claim.groupId,input.claim.workItemId).contract)) throw new ControlError("start-contract-conflict");
 admitted(gate,()=>store.transaction(()=>{
  assertClaimIdentity(store,input.claim);const run=readRun(store,input.claim.runId);
  if(run.state!=="claimed") throw new ControlError("start-state-conflict");
  store.db.prepare("INSERT INTO outbox VALUES (?, 'start', ?, 0)").run("start:"+run.runId,JSON.stringify(input));
  run.state="starting";saveRun(store,run);
 }));
 return send(store,port,input,gate);
}
export async function reconcileStart(store:ControlStore,port:ExecutionPort,runId:string,gate?:AdmissionGate):Promise<RunView> {
 const input=readEnvelope(store,runId);assertClaimIdentity(store,input.claim);
 if(getRun(store,runId).state==="settled") return getRun(store,runId);
 let status:ExecutionStatus;
 try {status=await port.inspect(input);}catch {status={kind:"unknown"};}
 if(status.kind==="absent") {
  const group=readGroup(store,input.claim.groupId);
  if(!group.stopped && !store.dispatchBlocked) {
   assertCapabilities(group.budgetMode??"strict",await port.capabilities());
   return send(store,port,input,gate);
  }
 }
 return persistStatus(store,input,status,gate);
}

export type SchedulerWakeKind = "start" | "no-start" | "budget-estimate";
export interface SchedulerWake { id: string; groupId: string; kind: SchedulerWakeKind; body: Record<string, unknown> }
/** A handler returns true only when the wake's effect is durably in place; false or a throw keeps it pending. */
export type WakeHandler = (wake: SchedulerWake) => Promise<boolean>;
export type WakeHandlers = Partial<Record<SchedulerWakeKind, WakeHandler>>;

function groupClaimBlocked(store:ControlStore,groupId:string):boolean {
 return store.db.prepare("SELECT id FROM recovery_blockers WHERE group_id=? AND scope='group'").get(groupId)!==undefined;
}

/**
 * Drain `scheduler_wakes` oldest-first through kind handlers. A wake is acknowledged
 * exactly once and only by a delivery that succeeded: a global blocker, a group
 * blocker or a missing handler all leave it durably pending for the next round.
 */
export async function deliverSchedulerWakes(store:ControlStore,handlers:WakeHandlers):Promise<{delivered:string[];deferred:string[]}> {
 const pending=store.db.prepare("SELECT id,group_id,kind,body FROM scheduler_wakes WHERE delivered=0 ORDER BY rowid").all();
 const delivered:string[]=[],deferred:string[]=[];
 for (const row of pending) {
  const id=String(row.id),groupId=String(row.group_id),kind=String(row.kind) as SchedulerWakeKind;
  const handler=handlers[kind];
  if(store.dispatchBlocked||handler===undefined||groupClaimBlocked(store,groupId)){deferred.push(id);continue;}
  let done=false;
  try{done=await handler({id,groupId,kind,body:JSON.parse(String(row.body))});}catch{done=false;}
  if(!done){deferred.push(id);continue;}
  store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=? AND delivered=0").run(id);
  delivered.push(id);
 }
 return {delivered,deferred};
}
