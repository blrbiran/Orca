import type { ControlStore } from "./store.js";
import type { ExecutionPort } from "./executionPort.js";
import { productionExecutionPort } from "./executionPort.js";
import type { Capabilities, Claim, ExecutionProfileBinding, Grant, WorkInput, HandoffReason } from "./types.js";
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
import { createAdmissionGate, type AdmissionGate } from "./admissionGate.js";
import type { ExecutionProfileRouter, FrozenProfile, ObservedProfile } from "./profiles.js";
import type { WebWorkKindV1 } from "./webProtocol.js";

export interface ExecutionProfileSelection { workKind: WebWorkKindV1; profileId: string; profileHash: string }
export interface ServiceOptions {
  targetRepo?:string;
  reconcileGrant?: Grant;
  profileRouter?: ExecutionProfileRouter;
  admissionGate?: AdmissionGate;
}
function sameProfile(left:ExecutionProfileBinding|undefined,right:ExecutionProfileSelection|undefined):boolean {
  return left?.workKind===right?.workKind&&left?.profileId===right?.profileId&&left?.profileHash===right?.profileHash;
}
export class ControlService {
  readonly admissionGate: AdmissionGate;
  constructor(readonly store: ControlStore, readonly port?: ExecutionPort, readonly options: ServiceOptions = {}) {
    this.admissionGate = options.admissionGate ?? createAdmissionGate();
  }
  write<T>(operation:()=>T):T {
    const release=this.admissionGate.enter();try{return operation();}finally{release();}
  }
  async writeAsync<T>(operation:()=>Promise<T>):Promise<T> {
    const release=this.admissionGate.enter();try{return await operation();}finally{release();}
  }
  async run(groupId:string, planPath:string, options: Omit<import("../scheduler/run.js").RunOptions,"adapter"|"adapterConfig"> = {}):Promise<number> {
    const release=this.store.beginOperation();
    try {
    await this.legacyCapabilities(groupId);
    const {loadRound,runPreparedRound}=await import("../scheduler/run.js");
    const {makeControlledExecution}=await import("./schedulerBridge.js");
    const loaded=await loadRound(planPath);
    if("rejections" in loaded) throw new ControlError("control-plan-rejected");
    return await runPreparedRound(loaded.round,options,makeControlledExecution(this,groupId));
    } finally {release();}
  }
  async runProfiled(groupId:string,planPath:string,selection:ExecutionProfileSelection,handoffSelection:ExecutionProfileSelection,options:Omit<import("../scheduler/run.js").RunOptions,"adapter"|"adapterConfig">={}):Promise<number> {
    const release=this.store.beginOperation();
    try {
      const {loadRound,runPreparedRound}=await import("../scheduler/run.js");
      const {makeControlledExecution}=await import("./schedulerBridge.js");
      const loaded=await loadRound(planPath);
      if("rejections" in loaded) throw new ControlError("control-plan-rejected");
      return await runPreparedRound(loaded.round,options,makeControlledExecution(this,groupId,selection,handoffSelection));
    } finally {release();}
  }
  executionProfile(selection: ExecutionProfileSelection): FrozenProfile {
    if (!this.options.profileRouter) throw new ControlError("control-protocol-unavailable");
    return this.options.profileRouter.resolve(selection.workKind, selection.profileId, selection.profileHash);
  }
  async probeExecutionProfile(selection: ExecutionProfileSelection): Promise<ObservedProfile> {
    const profile = this.executionProfile(selection);
    return this.options.profileRouter!.probe(profile);
  }
  legacyExecutionPort():ExecutionPort { return this.port ?? productionExecutionPort(); }
  executionPort(selection?: ExecutionProfileSelection): ExecutionPort { return selection ? this.executionProfile(selection).port : this.legacyExecutionPort(); }
  executionPortForRun(runId:string):ExecutionPort {
    const binding=readRun(this.store,runId).executionProfile;
    return binding ? this.executionProfile(binding).port : this.legacyExecutionPort();
  }
  async legacyCapabilities(groupId: string):Promise<Capabilities> {
    const caps = await this.legacyExecutionPort().capabilities();
    assertCapabilities(readGroup(this.store,groupId).budgetMode ?? "strict",caps);
    return caps;
  }
  capabilities(groupId:string):Promise<Capabilities> { return this.legacyCapabilities(groupId); }
  async profiledCapabilities(groupId:string,selection:ExecutionProfileSelection):Promise<{profile:FrozenProfile;capabilities:Capabilities}> {
    const profile=this.executionProfile(selection),observation=await this.options.profileRouter!.probe(profile);
    const observed=observation.observed,mode=readGroup(this.store,groupId).budgetMode??"strict";
    // Ruling R5: the router turns every probe throw into a failure code, which is right for a
    // genuine probe failure and wrong for "there is no port at all" -- those need different fixes,
    // so the named one is re-raised rather than folded into the capability answer.
    if(observation.probeFailureCode==="control-port-unconfigured")throw new ControlError("control-port-unconfigured");
    if(observation.probeFailureCode!==null||observed.usageObservation==="unavailable"||observed.budgetEnforcement==="unavailable"||observed.handoffControl!=="durable"||observed.handoffExecution===null||(mode==="strict"&&(observed.budgetEnforcement!=="bounded"||observed.requestBoundProof===null||!observed.requestBoundProof.workDimensions.includes("tokens"))))throw new ControlError("control-capability-unsupported");
    const capabilities=await profile.port.capabilities();assertCapabilities(mode,capabilities);return {profile,capabilities};
  }
  private claimWithCapabilities(groupId:string,workItemId:string,capabilities:Capabilities,executionProfile?:ExecutionProfileSelection,handoffProfile?:ExecutionProfileSelection):Claim {
    return this.write(()=>{
      const group=readGroup(this.store,groupId),work=readWork(this.store,groupId,workItemId);
      if(group.stopped)throw new ControlError("group-stopped");
      const previous=this.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId,workItemId);
      if(this.store.dispatchBlocked)throw new ControlError("control-recovery-required");
      if(previous){const run=readRun(this.store,String(previous.id));if(run.targetVersion===work.targetVersion&&run.graphVersion===group.graphVersion&&run.configHash===work.configHash){if(!sameProfile(run.executionProfile,executionProfile)||!sameProfile(run.handoffProfile,handoffProfile))throw new ControlError("profile-changed");return run;}}
      return claimWork(this.store,{groupId,workItemId,capabilities,executionProfile,handoffProfile,graphVersion:group.graphVersion,targetVersion:work.targetVersion,commandId:`execute-${workItemId}-${work.targetVersion}-${group.graphVersion}`,expectedRevision:group.revision,by:"control-service"});
    });
  }
  async claimLegacy(groupId:string,workItemId:string):Promise<Claim>{return this.claimWithCapabilities(groupId,workItemId,await this.legacyCapabilities(groupId));}
  claim(groupId:string,workItemId:string):Promise<Claim>{return this.claimLegacy(groupId,workItemId);}
  async claimProfiled(groupId:string,workItemId:string,selection:ExecutionProfileSelection,handoffSelection:ExecutionProfileSelection):Promise<Claim>{
    if(selection.workKind!=="task"||handoffSelection.workKind!=="handoff")throw new ControlError("profile-changed");
    const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection),this.profiledCapabilities(groupId,handoffSelection)]);
    return this.claimWithCapabilities(groupId,workItemId,capabilities,selection,handoffSelection);
  }
  private reconcileWithCapabilities(groupId:string,taskId:string,capabilities:Capabilities,executionProfile?:ExecutionProfileSelection,handoffProfile?:ExecutionProfileSelection):ApprovedReconcileBudget {
    return this.write(()=>{
      const group=readGroup(this.store,groupId);if(group.stopped)throw new ControlError("group-stopped");
      const workItemId=`reconcile-${taskId}`,existing=this.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId,workItemId);let claim:Claim;
      if(existing){const run=readRun(this.store,String(existing.id));claim=run;if(run.graphVersion!==group.graphVersion)throw new ControlError("reconcile-version-conflict");if(!sameProfile(run.executionProfile,executionProfile)||!sameProfile(run.handoffProfile,handoffProfile))throw new ControlError("profile-changed");}
      else {
        const cap=this.options.reconcileGrant;if(!cap)throw new ControlError("reconcile-budget-unapproved");grantSchema.parse(cap);
        const free=subtract(group.limit,add(group.used,group.reserved)),handoff=componentMin(cap.handoff,free),work=componentMin(cap.work,subtract(free,handoff));
        if(work.tokens===0||work.activeMs===0||work.attempts===0||work.sessions===0)throw new ControlError("group-budget-unavailable");
        const parent=allWork(this.store,groupId).find(item=>item.taskId===taskId&&item.kind==="task");if(!parent)throw new ControlError("work-not-found");
        const prepared:WorkInput={workItemId,taskId:workItemId,kind:"reconcile",dependsOn:[],contract:{pendingReconciliation:taskId},configHash:parent.configHash,grant:{work,handoff}};
        claim=claimWork(this.store,{groupId,workItemId,capabilities,executionProfile,handoffProfile,graphVersion:group.graphVersion,targetVersion:1,commandId:`reconcile-${taskId}`,expectedRevision:group.revision,by:"control-service"},prepared);
      }
      return {maxAttempts:claim.grant.work.attempts,perAttemptTimeoutMs:claim.grant.work.activeMs,totalRuntimeBudgetMs:claim.grant.work.activeMs,tokenBudget:claim.grant.work.tokens};
    });
  }
  async reconcileBudgetLegacy(groupId:string,taskId:string):Promise<ApprovedReconcileBudget>{return this.reconcileWithCapabilities(groupId,taskId,await this.legacyCapabilities(groupId));}
  reconcileBudget(groupId:string,taskId:string):Promise<ApprovedReconcileBudget>{return this.reconcileBudgetLegacy(groupId,taskId);}
  async reconcileBudgetProfiled(groupId:string,taskId:string,selection:ExecutionProfileSelection,handoffSelection:ExecutionProfileSelection):Promise<ApprovedReconcileBudget>{
    if(selection.workKind!=="task"||handoffSelection.workKind!=="handoff")throw new ControlError("profile-changed");
    const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection),this.profiledCapabilities(groupId,handoffSelection)]);
    return this.reconcileWithCapabilities(groupId,taskId,capabilities,selection,handoffSelection);
  }
  async startProfiled(selection:ExecutionProfileSelection,input:import("./executionPort.js").StartEnvelope){if(selection.workKind!=="task")throw new ControlError("profile-changed");const {profile}=await this.profiledCapabilities(input.claim.groupId,selection);if(!sameProfile(readRun(this.store,input.claim.runId).executionProfile,selection))throw new ControlError("profile-changed");return startClaim(this.store,profile.port,input,this.admissionGate);}
  startLegacy(input:import("./executionPort.js").StartEnvelope){return startClaim(this.store,this.legacyExecutionPort(),input,this.admissionGate);}
  async reconcileStartForRun(runId:string){
    const run=readRun(this.store,runId);
    if(run.executionProfile&&run.executionProfile.workKind!=="task")throw new ControlError("profile-changed");
    const selected=run.executionProfile ? await this.profiledCapabilities(run.groupId,run.executionProfile) : undefined;
    return reconcileStart(this.store,selected?.profile.port??this.legacyExecutionPort(),runId,this.admissionGate);
  }
  async requestHandoff(groupId:string,runId:string,input:{requestId:string;reason:HandoffReason;deadlineAt:string}) {
    const run=readRun(this.store,runId),group=readGroup(this.store,groupId);
    if(run.groupId!==groupId||run.state==="settled")throw new ControlError("handoff-parent-invalid");
    const work=allWork(this.store,groupId).find(item=>item.kind==="handoff"&&item.parentRunId===runId);
    if(!work)throw new ControlError("handoff-work-not-found");
    const binding=run.handoffProfile;
    if(run.executionProfile&&(!binding||binding.workKind!=="handoff"))throw new ControlError("profile-changed");
    const selected=binding ? await this.profiledCapabilities(groupId,binding) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId)};
    const envelope=readEnvelope(this.store,runId),request=handoffRequestSchema.parse({protocol:1 as const,...input,runId,generation:run.generation});
    const id="handoff-request:"+runId,body={workItemId:work.workItemId,request};const old=this.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id);
    this.write(()=>{
      claimWork(this.store,{groupId,workItemId:work.workItemId,capabilities:selected.capabilities,executionProfile:binding,handoffProfile:binding,graphVersion:group.graphVersion,targetVersion:work.targetVersion,commandId:`claim-${input.requestId}`,expectedRevision:group.revision,by:"control-service"});
      if(old){if(hashPayload(JSON.parse(String(old.body)))!==hashPayload(body))throw new ControlError("handoff-request-conflict");}
      else this.store.transaction(()=>this.store.db.prepare("INSERT INTO outbox VALUES (?, 'handoff-request', ?, 0)").run(id,JSON.stringify(body)));
    });
    const port=selected.profile?.port??this.legacyExecutionPort();
    try{const ack=await port.requestHandoff(envelope,request);if(ack.requestId!==input.requestId)throw new Error("identity");}
    catch{throw new ControlError("handoff-outcome-unknown");}
    const {collectControlled,settleControlledHandoff}=await import("./schedulerBridge.js");const report=await collectControlled(this,runId,port);await settleControlledHandoff(this,runId,report);
    if(readRun(this.store,runId).state==="settled")this.write(()=>this.store.transaction(()=>this.store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run(id)));
    return getRun(this.store,runId);
  }
  async continueTask(groupId:string,taskId:string,input:{commandId:string;expectedRevision:number}) {
    const group=readGroup(this.store,groupId);if(group.revision!==input.expectedRevision)throw new ControlError("revision-conflict");
    const rows=this.store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid DESC").all(groupId).map(row=>JSON.parse(String(row.body)) as ReturnType<typeof readRun>);
    const predecessor=rows.find(run=>run.taskId===taskId&&run.state==="settled"&&run.recoverable);if(!predecessor)throw new ControlError("continuation-predecessor-unrecoverable");
    const work=readWork(this.store,groupId,predecessor.workItemId),binding=predecessor.executionProfile,handoffBinding=predecessor.handoffProfile;
    const selected=binding ? await this.profiledCapabilities(groupId,binding) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId)};
    if(binding) {
      if(binding.workKind!=="task"||!handoffBinding||handoffBinding.workKind!=="handoff")throw new ControlError("profile-changed");
      await this.profiledCapabilities(groupId,handoffBinding);
    }
    const claim=this.write(()=>claimContinuation(this.store,{groupId,predecessorRunId:predecessor.runId,workItemId:work.workItemId,taskId,graphVersion:group.graphVersion,targetVersion:work.targetVersion,commandId:input.commandId,expectedRevision:input.expectedRevision,by:"human",executionProfile:binding,handoffProfile:handoffBinding}));
    const port=selected.profile?.port??this.legacyExecutionPort();
    if(this.store.db.prepare("SELECT id FROM outbox WHERE id=?").get("start:"+claim.runId))return reconcileStart(this.store,port,claim.runId,this.admissionGate);
    const previous=readEnvelope(this.store,predecessor.runId),sourceDir=join(dirname(previous.work.sourceDir),claim.runId);
    const checkpoint=await exportResumeBundle(this.store,{predecessorRunId:predecessor.runId,newSourceDir:sourceDir},{admit:operation=>this.writeAsync(operation)});
    return startClaim(this.store,port,{protocol:1,claim,contractHash:hashPayload(work.contract),inputCheckpoint:checkpoint,work:{contract:work.contract,targetRepo:previous.work.targetRepo,base:previous.work.base,sourceDir}},this.admissionGate);
  }
}
