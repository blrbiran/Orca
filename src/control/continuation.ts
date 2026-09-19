import { randomUUID } from "node:crypto";
import type { ControlStore } from "./store.js";
import type { Claim, CommandMeta, ExecutionProfileBinding } from "./types.js";
import { applyCommand, dimensions, fits, zero } from "./commands.js";
import { readGroup, readWork, saveGroup, saveWork } from "./queries.js";
import { add, readRun, subtract, type RunRecord } from "./budget.js";
import { ControlError } from "./errors.js";

export interface ContinuationClaimInput extends CommandMeta {groupId:string;predecessorRunId:string;workItemId:string;taskId:string;graphVersion:number;targetVersion:number;executionProfile?:ExecutionProfileBinding}
export function claimContinuation(store:ControlStore,input:ContinuationClaimInput):Claim {
 const {groupId,predecessorRunId,workItemId,taskId,graphVersion,targetVersion,executionProfile,...meta}=input;
 return applyCommand(store,groupId,meta,{verb:"continue",predecessorRunId,workItemId,taskId,graphVersion,targetVersion,executionProfile:executionProfile??null},()=>{
  if(store.dispatchBlocked)throw new ControlError("control-recovery-required");const group=readGroup(store,groupId),work=readWork(store,groupId,workItemId),predecessor=readRun(store,predecessorRunId);
  if(predecessor.state!=="settled"||!predecessor.recoverable||!predecessor.checkpointId)throw new ControlError("continuation-predecessor-unrecoverable");
  if(predecessor.groupId!==groupId||predecessor.workItemId!==workItemId||predecessor.taskId!==taskId||work.taskId!==taskId)throw new ControlError("continuation-identity-conflict");
  if(group.graphVersion!==graphVersion||predecessor.graphVersion!==graphVersion)throw new ControlError("graph-version-conflict");
  if(work.targetVersion!==targetVersion||predecessor.targetVersion!==targetVersion||work.configHash!==predecessor.configHash)throw new ControlError("target-version-conflict");
  if(store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId,workItemId))throw new ControlError("work-already-active");
  const grant={work:subtract(predecessor.grant.work,predecessor.cumulative.work),handoff:subtract(predecessor.grant.handoff,predecessor.cumulative.handoff)};
  if(dimensions.some(key=>grant.work[key]===0))throw new ControlError("continuation-budget-unavailable");
  const total=add(grant.work,grant.handoff),reserved=add(group.reserved,total);if(!fits(group.used,reserved,group.limit))throw new ControlError("group-budget-unavailable");
  group.reserved=reserved;group.budgetVersion++;group.status="running";saveGroup(store,group);
  const claim:Claim={groupId,workItemId,taskId,runId:"run-"+randomUUID(),generation:1,graphVersion,targetVersion,commandId:meta.commandId,configHash:work.configHash,grant,ownerToken:randomUUID()};
  const run:RunRecord={...claim,...(executionProfile?{executionProfile}:{}),executionId:null,state:"claimed",checkpointId:null,recoverable:false,remaining:structuredClone(grant),cumulative:{work:zero(),handoff:zero()},unknown:{work:true,handoff:true},highWater:0,breaches:[],handoffWorkItemId:null,predecessorRunId};
  store.db.prepare("INSERT INTO runs VALUES (?,?,?,?,1,?)").run(claim.runId,groupId,workItemId,1,JSON.stringify(run));work.status="running";saveWork(store,groupId,work);return claim;
 });
}
