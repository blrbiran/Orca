import type { ControlStore } from "./store.js";
import type { ExecutionPort } from "./executionPort.js";
import { productionExecutionPort } from "./executionPort.js";
import type { Claim, Grant, WorkInput, HandoffReason } from "./types.js";
import { assertCapabilities, claimWork, readRun, componentMin, subtract, add } from "./budget.js";
import { allWork, readGroup, readWork } from "./queries.js";
import { ControlError } from "./errors.js";
import type { ApprovedReconcileBudget } from "../scheduler/reconcile.js";
import { grantSchema, handoffRequestSchema } from "./schema.js";
import { hashPayload } from "./commands.js";
import { claimContinuation } from "./continuation.js";
import { exportResumeBundle } from "./resumeBundle.js";
import { readEnvelope, reconcileStart, startClaim } from "./dispatch.js";
import { getRun } from "./queries.js";
import { dirname, join } from "node:path";

export interface ServiceOptions {targetRepo?:string;reconcileGrant?: Grant}
export class ControlService {
  constructor(readonly store: ControlStore, readonly port?: ExecutionPort, readonly options: ServiceOptions = {}) {}
  async run(groupId:string, planPath:string, options: Omit<import("../scheduler/run.js").RunOptions,"adapter"|"adapterConfig"> = {}):Promise<number> {
    const release=this.store.beginOperation();
    try {
    await this.capabilities(groupId);
    const {loadRound,runPreparedRound}=await import("../scheduler/run.js");
    const {makeControlledExecution}=await import("./schedulerBridge.js");
    const loaded=await loadRound(planPath);
    if("rejections" in loaded) throw new ControlError("control-plan-rejected");
    return await runPreparedRound(loaded.round,options,makeControlledExecution(this,groupId));
    } finally {release();}
  }
  executionPort(): ExecutionPort { return this.port ?? productionExecutionPort(); }
  async capabilities(groupId: string) {
    const caps = await this.executionPort().capabilities();
    assertCapabilities(readGroup(this.store,groupId).budgetMode ?? "strict",caps);
    return caps;
  }
  async claim(groupId: string, workItemId: string): Promise<Claim> {
    const capabilities = await this.capabilities(groupId);
    const group = readGroup(this.store,groupId), work = readWork(this.store,groupId,workItemId);
    if(group.stopped) throw new ControlError("group-stopped");
    const previous=this.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId,workItemId);
    if(this.store.dispatchBlocked) throw new ControlError("control-recovery-required");
    if(previous) {
      const run=readRun(this.store,String(previous.id));
      if(run.targetVersion===work.targetVersion && run.graphVersion===group.graphVersion && run.configHash===work.configHash) return run;
    }
    return claimWork(this.store,{groupId,workItemId,capabilities,graphVersion:group.graphVersion,targetVersion:work.targetVersion,
      commandId:`execute-${workItemId}-${work.targetVersion}-${group.graphVersion}`,expectedRevision:group.revision,by:"control-service"});
  }
  async reconcileBudget(groupId: string, taskId: string): Promise<ApprovedReconcileBudget> {
    const capabilities=await this.capabilities(groupId), group=readGroup(this.store,groupId);
    if(group.stopped) throw new ControlError("group-stopped");
    const workItemId=`reconcile-${taskId}`;
    const existing=this.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId,workItemId);
    let claim:Claim;
    if(existing) {
      claim=readRun(this.store,String(existing.id));
      if(claim.graphVersion!==group.graphVersion) throw new ControlError("reconcile-version-conflict");
    }
    else {
      const cap=this.options.reconcileGrant;
      if(!cap) throw new ControlError("reconcile-budget-unapproved");
      grantSchema.parse(cap);
      const free=subtract(group.limit,add(group.used,group.reserved));
      const handoff=componentMin(cap.handoff,free), work=componentMin(cap.work,subtract(free,handoff));
      if(work.tokens===0 || work.activeMs===0 || work.attempts===0 || work.sessions===0) throw new ControlError("group-budget-unavailable");
      const parent=allWork(this.store,groupId).find(w=>w.taskId===taskId && w.kind==="task");
      if(!parent) throw new ControlError("work-not-found");
      const prepared:WorkInput={workItemId,taskId:workItemId,kind:"reconcile",dependsOn:[],contract:{pendingReconciliation:taskId},configHash:parent.configHash,grant:{work,handoff}};
      claim=claimWork(this.store,{groupId,workItemId,capabilities,graphVersion:group.graphVersion,targetVersion:1,
        commandId:`reconcile-${taskId}`,expectedRevision:group.revision,by:"control-service"},prepared);
    }
    return {maxAttempts:claim.grant.work.attempts,perAttemptTimeoutMs:claim.grant.work.activeMs,
      totalRuntimeBudgetMs:claim.grant.work.activeMs,tokenBudget:claim.grant.work.tokens};
  }
  async requestHandoff(groupId:string,runId:string,input:{requestId:string;reason:HandoffReason;deadlineAt:string}) {
    const run=readRun(this.store,runId),group=readGroup(this.store,groupId);
    if(run.groupId!==groupId||run.state==="settled")throw new ControlError("handoff-parent-invalid");
    const work=allWork(this.store,groupId).find(item=>item.kind==="handoff"&&item.parentRunId===runId);
    if(!work)throw new ControlError("handoff-work-not-found");
    const capabilities=await this.capabilities(groupId);
    claimWork(this.store,{groupId,workItemId:work.workItemId,capabilities,graphVersion:group.graphVersion,targetVersion:work.targetVersion,commandId:`claim-${input.requestId}`,expectedRevision:group.revision,by:"control-service"});
    const envelope=readEnvelope(this.store,runId),request=handoffRequestSchema.parse({protocol:1 as const,...input,runId,generation:run.generation});
    const id="handoff-request:"+runId,body={workItemId:work.workItemId,request};const old=this.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id);
    if(old){if(hashPayload(JSON.parse(String(old.body)))!==hashPayload(body))throw new ControlError("handoff-request-conflict");}
    else this.store.transaction(()=>this.store.db.prepare("INSERT INTO outbox VALUES (?, 'handoff-request', ?, 0)").run(id,JSON.stringify(body)));
    try{const ack=await this.executionPort().requestHandoff(envelope,request);if(ack.requestId!==input.requestId)throw new Error("identity");}
    catch{throw new ControlError("handoff-outcome-unknown");}
    const {collectControlled,settleControlledHandoff}=await import("./schedulerBridge.js");const report=await collectControlled(this,runId);await settleControlledHandoff(this,runId,report);
    if(readRun(this.store,runId).state==="settled")this.store.transaction(()=>this.store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run(id));
    return getRun(this.store,runId);
  }
  async continueTask(groupId:string,taskId:string,input:{commandId:string;expectedRevision:number}) {
    const group=readGroup(this.store,groupId);if(group.revision!==input.expectedRevision)throw new ControlError("revision-conflict");
    const rows=this.store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid DESC").all(groupId).map(row=>JSON.parse(String(row.body)) as ReturnType<typeof readRun>);
    const predecessor=rows.find(run=>run.taskId===taskId&&run.state==="settled"&&run.recoverable);if(!predecessor)throw new ControlError("continuation-predecessor-unrecoverable");
    const work=readWork(this.store,groupId,predecessor.workItemId);await this.capabilities(groupId);
    const claim=claimContinuation(this.store,{groupId,predecessorRunId:predecessor.runId,workItemId:work.workItemId,taskId,graphVersion:group.graphVersion,targetVersion:work.targetVersion,commandId:input.commandId,expectedRevision:input.expectedRevision,by:"human"});
    if(this.store.db.prepare("SELECT id FROM outbox WHERE id=?").get("start:"+claim.runId))return reconcileStart(this.store,this.executionPort(),claim.runId);
    const previous=readEnvelope(this.store,predecessor.runId),sourceDir=join(dirname(previous.work.sourceDir),claim.runId);
    const checkpoint=await exportResumeBundle(this.store,{predecessorRunId:predecessor.runId,newSourceDir:sourceDir});
    return startClaim(this.store,this.executionPort(),{protocol:1,claim,contractHash:hashPayload(work.contract),inputCheckpoint:checkpoint,work:{contract:work.contract,targetRepo:previous.work.targetRepo,base:previous.work.base,sourceDir}});
  }
}
