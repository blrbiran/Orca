import {createHash} from 'node:crypto';
import {savedDispatchSchema,savedNoDispatchSchema,savedRecoverySchema} from './savedResultProtocol.js';
import {settlementArtifact,settlementSame} from './usageSettlement.js';
import {canonicalBytes,sha256Canonical} from './canonicalJson.js';
import {lookupWebCommandReplay} from './commandLedger.js';
import {rawAuthorityCommandSchema} from './webProtocol.js';
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
/** A committed explicit retry receipt, never a ready-state inference or a new saved-successor exemption. */
export function hasSavedOrdinaryRetryAuthorization(store:ControlStore,run:any):boolean {
 try{
  if(run.mode!=='verify-saved-result'||!run.recoveryOf||run.state!=='settled-failed'||run.unknown.work||run.unknown.handoff)return false;
  const noDispatch=run.drive?.outcome==='not-started',id=noDispatch?run.savedNoDispatchConsumedBy:run.savedOrdinaryRetryCommandId;
  if(typeof id!=='string'||(!noDispatch&&(typeof run.drive?.outcome!=='string'||run.drive.outcome==='succeeded'||run.savedNoDispatchConsumedBy!==undefined)))return false;
  const header=store.db.prepare('SELECT group_id,work_item_id,generation,active FROM runs WHERE id=?').get(run.runId),latest=store.db.prepare('SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1').get(run.groupId,run.workItemId),work=readWork(store,run.groupId,run.workItemId) as any;
  if(!header||header.group_id!==run.groupId||header.work_item_id!==run.workItemId||Number(header.generation)!==run.generation||Number(header.active)!==0||latest?.id!==run.runId||work.currentRunId!==run.runId||work.taskId!==run.taskId||work.status!=='ready'||work.pendingRunId!=null||work.continuation!=null)return false;
  const row=store.db.prepare('SELECT * FROM commands WHERE group_id=? AND id=?').get(run.groupId,id);
  if(!row||row.ledger_version!==1||row.verb!=='retry-task'||row.scope_kind!=='group'||row.scope_id!==run.groupId)return false;
  const raw=rawAuthorityCommandSchema.parse(JSON.parse(String(row.raw_request_json)));
  if(raw.verb!=='retry-task'||raw.commandId!==id||raw.target.kind!=='group'||raw.target.groupId!==run.groupId||raw.payload.taskId!==run.taskId||row.actor_id!==raw.actorId||Number(row.expected_revision)!==raw.expectedRevision||row.payload_hash!==row.raw_request_hash||String(row.target_json)!==canonicalBytes(raw.target).toString())return false;
  const replay=lookupWebCommandReplay(store,raw);if(!replay||replay.status<200||replay.status>=300)return false;
  const body:any=replay.body;
  if(body.schema!=='orca-command-success-v1'||body.commandId!==id||body.verb!=='retry-task'||body.actorId!==raw.actorId||!settlementSame(body.target,raw.target)||Number(row.command_revision)!==body.commandRevision||String(row.body_json)!==canonicalBytes(body).toString()||String(row.result)!==String(row.body_json)||!Buffer.from(row.response_bytes as Uint8Array).equals(canonicalBytes(body)))return false;
  return body.result.kind==='task-retried'&&body.result.taskId===run.taskId&&body.result.fromRunId===run.runId;
 }catch{return false;}
}
