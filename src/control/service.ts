import type { ControlStore } from "./store.js";
import type { ExecutionPort } from "./executionPort.js";
import { productionExecutionPort } from "./executionPort.js";
import type { Claim, Grant, WorkInput } from "./types.js";
import { assertCapabilities, claimWork, readRun, componentMin, subtract, add } from "./budget.js";
import { allWork, readGroup, readWork } from "./queries.js";
import { ControlError } from "./errors.js";
import type { ApprovedReconcileBudget } from "../scheduler/reconcile.js";
import { grantSchema } from "./schema.js";

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
}
