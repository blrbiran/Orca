import {createHash} from 'node:crypto';
import {savedDispatchSchema,savedNoDispatchSchema,savedRecoverySchema} from './savedResultProtocol.js';
import {settlementArtifact,settlementSame} from './usageSettlement.js';
import {sha256Canonical} from './canonicalJson.js';
import {readCanonicalRecord} from './snapshot.js';
import {readBudgetProposal,readWork} from './queries.js';
import {readFundedAllowance} from './fundedAllowance.js';
import type {ControlStore} from './store.js';
import {ControlError} from './errors.js';

/** A positive owner submission record plus an actual absent inspection, never a missing entry inference. */
export function validSavedNoDispatch(store:ControlStore,run:any,requireUnconsumed=true):boolean {
 try {
  if(run.mode!=='verify-saved-result'||run.recoveryOf===undefined||run.state!=='settled-restartable'||run.executionId!==null||(requireUnconsumed&&run.savedNoDispatchConsumedBy!==undefined))return false;
  const header=store.db.prepare('SELECT group_id,work_item_id,generation FROM runs WHERE id=?').get(run.runId);if(!header||header.group_id!==run.groupId||header.work_item_id!==run.workItemId||Number(header.generation)!==run.generation)return false;
  const marker=savedDispatchSchema.parse(run.savedDispatch),proof=savedNoDispatchSchema.parse(JSON.parse(settlementArtifact(store,run.savedNoDispatch).toString())),recovery=savedRecoverySchema.parse(run.savedRecovery);
  const current=store.db.prepare('SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1').get(run.groupId,run.workItemId),work=readWork(store,run.groupId,run.workItemId) as any;
  if(current?.id!==run.runId||work.currentRunId!==run.runId||work.status!=='ready'||work.pendingRunId!=null||work.continuation!=null||Number(store.db.prepare('SELECT active FROM runs WHERE id=?').get(run.runId)?.active)!==0
   ||run.unknown.work||run.unknown.handoff||run.highWater!==0||store.db.prepare('SELECT seq FROM usage_events WHERE run_id=?').get(run.runId)||!settlementSame(run.remaining,run.grant)
   ||['work','handoff'].some(b=>Object.values(run.cumulative[b]).some(v=>v!==0))||!settlementSame(work.grant,run.grant))return false;
  if(marker.state!=='never-submitted'||marker.envelopeHash!==run.drive?.envelopeHash||marker.admissionHash!==recovery.admission.hash||marker.fundingHash!==sha256Canonical(recovery.funding)||marker.revision!==recovery.revision)return false;
  if(!settlementSame(proof,{schema:'orca-saved-result-no-dispatch-v1',groupId:run.groupId,workItemId:run.workItemId,taskId:run.taskId,runId:run.runId,generation:run.generation,commandId:run.commandId,ownerTokenHash:createHash('sha256').update(run.ownerToken).digest('hex'),admission:recovery.admission,fundingHash:marker.fundingHash,revision:marker.revision,envelopeHash:run.drive.envelopeHash,handoffRequestId:proof.handoffRequestId,inspection:'absent',controllerState:'never-submitted',observedAt:proof.observedAt}))return false;
  if(sha256Canonical(JSON.parse(readCanonicalRecord(store,proof.envelopeHash)))!==proof.envelopeHash)return false;
  const request=store.db.prepare('SELECT state,body FROM handoff_requests WHERE group_id=? AND run_id=? AND id=?').get(run.groupId,run.runId,proof.handoffRequestId);
  if(request?.state!=='settled-restartable'||JSON.parse(String(request.body)).failureCode!==null)return false;
  const allocations=readBudgetProposal(store,run.groupId).allocations.filter(a=>a.ownerKind==='task'&&a.ownerId===run.taskId);
  if(allocations.length!==2||allocations.some(a=>a.state!=='confirmed'||!settlementSame(a.amount,run.grant[a.bucket as 'work'|'handoff'])))return false;
  readFundedAllowance(store,run);return true;
 }catch{return false;}
}
/** Only the command ledger can consume the proof as a new ordinary plan/execute intent. */
export function hasSavedOrdinaryRetryAuthorization(store:ControlStore,run:any):boolean {
 const id=run.savedNoDispatchConsumedBy;if(typeof id!=='string'||run.state!=='settled-failed'||run.drive?.outcome!=='not-started')return false;
 const row=store.db.prepare("SELECT verb,body_json FROM commands WHERE group_id=? AND id=?").get(run.groupId,id);
 if(row?.verb!=='retry-task')return false;
 try{const result=JSON.parse(String(row.body_json)).result;return result.kind==='task-retried'&&result.taskId===run.taskId&&result.fromRunId===run.runId;}catch{return false;}
}
