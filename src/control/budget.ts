import { controlGraph } from "./graph.js";
import { randomUUID } from "node:crypto";
import type { ControlStore } from "./store.js";
import type { Amount, BudgetMode, Capabilities, Claim, ClaimInput, ExecutionProfileBinding, Grant, RunView, StopProof, WorkInput } from "./types.js";
import { ControlError } from "./errors.js";
import { amountSchema, safeInteger, workSchema, capabilitiesSchema } from "./schema.js";
import { applyCommand, dimensions, fits, zero } from "./commands.js";
import { readGroup, readWork, saveGroup, saveWork, allWork } from "./queries.js";
import { recordProjectionChange } from "./projectionJournal.js";
export interface RunRecord extends Claim, RunView {
  remaining:Grant; cumulative:Grant; highWater:number;
  unknown:{work:boolean;handoff:boolean};breaches:number[];
  handoffWorkItemId:string|null;
  predecessorRunId?:string;
  executionProfile?:ExecutionProfileBinding;
  handoffProfile?:ExecutionProfileBinding;
}
export function readRun(store:ControlStore,id:string):RunRecord {
  const row=store.db.prepare("SELECT body FROM runs WHERE id=?").get(id);
  if(!row) throw new ControlError("run-not-found");return JSON.parse(String(row.body));
}
export function saveRun(store:ControlStore,run:RunRecord):void {
  const body=JSON.stringify(run);
  const changed=store.db.prepare("UPDATE runs SET body=? WHERE id=? AND body<>?").run(body,run.runId,body).changes;
  if(changed===0) {
    if(!store.db.prepare("SELECT id FROM runs WHERE id=?").get(run.runId))throw new ControlError("run-not-found");
    return;
  }
  recordProjectionChange(store,[run.groupId]);
}
export function add(a:Amount,b:Amount):Amount {
  const result={...a};for(const k of dimensions) result[k]=a[k]+b[k];
  if(!amountSchema.safeParse(result).success) throw new ControlError("budget-overflow");return result;
}
export function subtract(a:Amount,b:Amount):Amount {
  const result={...a};for(const k of dimensions) result[k]=a[k]-b[k];
  if(!amountSchema.safeParse(result).success) throw new ControlError("usage-regression");return result;
}
export function componentMin(a:Amount,b:Amount):Amount {
  return {tokens:Math.min(a.tokens,b.tokens),activeMs:Math.min(a.activeMs,b.activeMs),attempts:Math.min(a.attempts,b.attempts),sessions:Math.min(a.sessions,b.sessions)};
}
export function assertCapabilities(mode:BudgetMode,c:Capabilities):void {
  if(!capabilitiesSchema.safeParse(c).success) throw new ControlError("control-capability-unsupported");
  if(c.protocol!==1 || !c.durableAccept || !c.ownershipIsolation || !c.evidenceRetention || c.usageObservation==="unavailable" || c.budgetEnforcement==="unsupported") throw new ControlError("control-capability-unsupported");
  if(mode==="strict" && (c.budgetEnforcement!=="bounded" || !c.requestBoundEvidence)) throw new ControlError("control-capability-unsupported");
}
export function claimWork(store:ControlStore,input:ClaimInput, preparedWork?:WorkInput):Claim {
  const {groupId,workItemId,graphVersion,targetVersion,capabilities,executionProfile,handoffProfile,...meta}=input;
  safeInteger.parse(graphVersion);safeInteger.parse(targetVersion);
  return applyCommand(store,groupId,meta,{verb:"claim",workItemId,graphVersion,targetVersion,capabilities,executionProfile:executionProfile??null,handoffProfile:handoffProfile??null,...(preparedWork?{preparedWork}: {})},()=>{
    if(store.dispatchBlocked) throw new ControlError("control-recovery-required");
    const group=readGroup(store,groupId);
    if(preparedWork) {
      workSchema.parse(preparedWork);
      if(preparedWork.kind!=="reconcile" || preparedWork.workItemId!==workItemId || targetVersion!==1) throw new ControlError("reconcile-registration-invalid");
      controlGraph([...allWork(store,groupId),preparedWork]);
      store.db.prepare("INSERT INTO work_items VALUES (?,?,?,?)").run(groupId,workItemId,1,JSON.stringify({...preparedWork,targetVersion:1,status:"ready"}));
    }
    const work=readWork(store,groupId,workItemId);
    if(group.graphVersion!==graphVersion) throw new ControlError("graph-version-conflict");
    if(work.targetVersion!==targetVersion) throw new ControlError("target-version-conflict");
    assertCapabilities(group.budgetMode??"strict",capabilities);
    if(work.kind==="handoff") {
      const parent=readRun(store,work.parentRunId);
      if(parent.groupId!==groupId || parent.taskId!==work.taskId || parent.state==="settled" || parent.configHash!==work.configHash || parent.handoffWorkItemId) throw new ControlError("handoff-parent-invalid");
      if(!fits(work.grant.handoff,zero(),parent.remaining.handoff) || dimensions.some(k=>work.grant.work[k]!==0)) throw new ControlError("handoff-budget-unavailable");
      parent.handoffWorkItemId=workItemId;saveRun(store,parent);
      return {groupId:parent.groupId,workItemId:parent.workItemId,taskId:parent.taskId,runId:parent.runId,generation:parent.generation,graphVersion:parent.graphVersion,targetVersion:parent.targetVersion,commandId:parent.commandId,configHash:parent.configHash,grant:parent.grant,ownerToken:parent.ownerToken};
    }
    if(group.stopped) throw new ControlError("group-stopped");
    if(group.deadlineAt && Date.now()>=Date.parse(group.deadlineAt)) throw new ControlError("group-deadline-expired");
    if(work.status==="done") throw new ControlError("work-already-done");
    for(const id of work.dependsOn) if(readWork(store,groupId,id).status!=="done") throw new ControlError("dependency-not-done");
    if(store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId,workItemId)) throw new ControlError("work-already-active");
    const total=add(work.grant.work,work.grant.handoff);
    if(work.kind==="goal-review") {
      if(!fits(group.used,group.reserved,group.limit)) throw new ControlError("group-budget-unavailable");
      if(!fits(total,zero(),group.reviewRemaining)) throw new ControlError("group-review-budget-unavailable");
      group.reviewRemaining=subtract(group.reviewRemaining,total);
    } else {
      const reserved=add(group.reserved,total);
      if(!fits(group.used,reserved,group.limit)) throw new ControlError("group-budget-unavailable");
      group.reserved=reserved;
    }
    const claim:Claim={groupId,workItemId,taskId:work.taskId,runId:"run-"+randomUUID(),generation:1,graphVersion,targetVersion,commandId:meta.commandId,configHash:work.configHash,grant:work.grant,ownerToken:randomUUID()};
    const run:RunRecord={...claim,...(executionProfile?{executionProfile}:{}),...(handoffProfile?{handoffProfile}:{}),executionId:null,state:"claimed",checkpointId:null,recoverable:false,remaining:structuredClone(work.grant),cumulative:{work:zero(),handoff:zero()},unknown:{work:true,handoff:true},highWater:0,breaches:[],handoffWorkItemId:null};
    store.db.prepare("INSERT INTO runs VALUES (?,?,?,?,1,?)").run(claim.runId,groupId,workItemId,1,JSON.stringify(run));
    work.status="running";saveWork(store,groupId,work);
    group.status="running";group.budgetVersion++;saveGroup(store,group);return claim;
  });
}
/** Numeric counters begin at zero, but zero consumption must be observed. */
export function hasObservedUsage(store:ControlStore,run:RunRecord):boolean {
 const observed=new Set<string>();
 for(const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<=?").all(run.runId,run.highWater)) {
  const event=JSON.parse(String(row.body));if(event.cumulative!==null)observed.add(event.bucket);
 }
 return observed.has("work") && observed.has("handoff");
}
/** Only call inside the candidate commit transaction, after artifact validation. */
export function releaseRunReserve(store:ControlStore,id:string,proof:StopProof):void {
  const run=readRun(store,id);
  if(run.state==="settled") return;
  if(!proof || proof.isolated!==true || proof.executionId!==run.executionId || proof.generation!==run.generation || run.unknown.work || run.unknown.handoff || !hasObservedUsage(store,run)) throw new ControlError("run-stop-unconfirmed");
  if(store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(id,run.highWater)) throw new ControlError("usage-gap");
  const group=readGroup(store,run.groupId);
  group.reserved=subtract(group.reserved,add(run.remaining.work,run.remaining.handoff));
  group.budgetVersion++;run.remaining={work:zero(),handoff:zero()};run.state="settled";
  saveGroup(store,group);saveRun(store,run);store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(id);
}
