import {createHash} from 'node:crypto';
import {canonicalBytes,sha256Canonical} from './canonicalJson.js';
import {ControlError} from './errors.js';
import {applyWebCommand,preflightWebCommand} from './commandLedger.js';
import {readArchivedPlan,readGroup,readWork,saveWork,readBudgetProposal} from './queries.js';
import {readCanonicalRecord} from './snapshot.js';
import {readConfirmedTaskExecution} from './executionSnapshot.js';
import {createStartingRun,readFrozenSnapshot,probeBlocksDispatch} from './webDispatch.js';
import {readStopIntent,readRunBody,saveRunBody,releaseCommitment,reserveCommitment,setAllocationStates,commandSuccess,latestRequestForRun,ADOPTABLE_STATES} from './stopIntent.js';
import {hasValidUsageSettlement,settlementProof,settlementArtifact,settlementSame} from './usageSettlement.js';
import {hasOptionalTaskPolicy,decideFundedAllowance,readFundedAllowance} from './fundedAllowance.js';
import {finiteCommitment} from './tokenPolicy.js';
import {groupUsageUnknown,add} from './budget.js';
import {zero,dimensions} from './commands.js';
import {claimCapBlocking} from './spendCaps.js';
import {frozenWorkAgent} from './agentFreeze.js';
import {isGroupArchived} from './archivedMark.js';
import {amountSchema,startEnvelopeSchema,artifactSchema} from './schema.js';
import {savedResultAdmissionSchema,recoveryFundingSchema,savedRecoverySchema,savedSourceSchema,interruptedSavedResultSchema,type SavedResultSourceEligibility,type SavedRecovery} from './savedResultProtocol.js';
import {prepareRecoverySource,persistRecoveryArtifact,recoveryClosure} from './savedResultRecoveryPackage.js';
import type {ControlStore} from './store.js';
import type {ExecutionPort,StartEnvelope} from './executionPort.js';
import type {StopDeps} from './stopIntent.js';
import type {RawAuthorityCommandV1,CommandLookupV1} from './webProtocol.js';
import type {ArtifactRef,Amount} from './types.js';

export type VerifySavedResultCommand=Extract<RawAuthorityCommandV1,{verb:'verify-saved-result'}>;
const unavailable=(reason:string):SavedResultSourceEligibility=>({status:'unavailable',reason});
const sourceEnvelope=(store:ControlStore,run:any):StartEnvelope=>{
 if(!run.drive?.envelopeHash)throw Error('saved-result-evidence-unavailable');
 const source=startEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(store,run.drive.envelopeHash))) as StartEnvelope;
 if(source.work.kind!=='loop'||source.mode!==undefined||source.claim.runId!==run.runId||sha256Canonical(source)!==run.drive.envelopeHash)throw Error('saved-result-source-stale');return source;
};
function sourceRecord(store:ControlStore,run:any){
 if(run.savedSourceUnavailable)throw Error(run.savedSourceUnavailable);
 if(run.savedSource?.authorityKind==='execution-format-failure-v1')return savedSourceSchema.parse(run.savedSource);
 const rows=store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid DESC").all(run.runId);
 for(const row of rows){const value=JSON.parse(String(row.body));const root=value.artifacts?.find((r:ArtifactRef)=>r?.artifactId.startsWith('archive-'));if(root&&value.snapshot&&value.missing?.length===0){
  const archive=JSON.parse(settlementArtifact(store,artifactSchema.parse(root)).toString());const stateRef=archive.logs.find((e:any)=>e.path==='run/loop-state.json')?.ref;if(!stateRef)continue;
  const state=JSON.parse(settlementArtifact(store,stateRef).toString());return savedSourceSchema.parse({authorityKind:'legacy-published-candidate-v1',source:root,attempt:state.currentAttempt});
 }}throw Error('saved-result-evidence-unavailable');
}
/** Re-read every current owner fact at GET completion, command admission and immediately before start. */
export function currentSavedResultSource(store:ControlStore,sourceRunId:string){
 const header=store.db.prepare('SELECT id,group_id,work_item_id,generation FROM runs WHERE id=?').get(sourceRunId);
 const raw=readRunBody(store,sourceRunId) as any;if(!header||raw.runId!==sourceRunId||header.group_id!==raw.groupId||header.work_item_id!==raw.workItemId||Number(header.generation)!==raw.generation)throw Error('saved-result-source-stale');
 const run=raw,work=readWork(store,run.groupId,run.workItemId) as any,group=readGroup(store,run.groupId) as any;
 const latest=store.db.prepare('SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1').get(run.groupId,run.workItemId);
 const current=typeof work.currentRunId==='string'?readRunBody(store,work.currentRunId) as any:null;
 const predecessor=current?.runId!==run.runId&&current?.savedRecovery!==undefined?savedRecoverySchema.parse(current.savedRecovery):null;
 if(work.kind!=='task'||run.taskId!==work.taskId||run.workItemId!==work.workItemId||work.currentRunId!==latest?.id||!work.lineageRunIds?.includes(run.runId)
  ||!current||work.pendingRunId!=null||work.continuation!=null||work.status==='ready'||work.status==='done'||!['blocked','held','running'].includes(work.status)
  ||run.targetVersion!==work.targetVersion||current.targetVersion!==work.targetVersion||!settlementSame(frozenWorkAgent(run),frozenWorkAgent(work)))throw Error('saved-result-source-stale');
 if(predecessor&&current.state==='blocked')assertKnown(store,current);
 if(predecessor){
  if(predecessor.recoveryOf.sourceRunId!==run.runId||!current.savedInterruption||!['blocked','settled-failed','settled-recoverable'].includes(current.state)
   ||!['saved-result-verification-interrupted','saved-result-before-entry-interrupted'].includes(current.drive?.stopReason))throw Error('saved-result-source-stale');
  interruptedSavedResultSchema.parse(JSON.parse(settlementArtifact(store,current.savedInterruption).toString()));
 }else if(current.runId!==run.runId)throw Error('saved-result-source-stale');
 if(!['blocked','settled-failed','settled-recoverable'].includes(run.state)||run.drive?.outcome!=='failed'||run.drive?.blockedAt!=='C'&&run.state==='blocked')throw Error('saved-result-source-stale');
 const graph=(()=>{try{return readArchivedPlan(store,run.groupId);}catch{throw Error('saved-result-source-stale');}})(),task=graph.plan.tasks.find(t=>t.taskId===run.taskId);
 if(!task||!settlementSame(work.dependsOn,task.dependencyTaskIds)||Number(store.db.prepare('SELECT graph_version FROM groups WHERE id=?').get(run.groupId)?.graph_version)!==run.graphVersion||Number(store.db.prepare('SELECT target_version FROM work_items WHERE group_id=? AND id=?').get(run.groupId,run.taskId)?.target_version)!==run.targetVersion)throw Error('saved-result-source-stale');
 const source=sourceEnvelope(store,run);let confirmed:ReturnType<typeof readConfirmedTaskExecution>,snapshot:ReturnType<typeof readFrozenSnapshot>;
 try{confirmed=readConfirmedTaskExecution(store,run.groupId,run.taskId);snapshot=readFrozenSnapshot(store,run.groupId);}catch{throw Error('saved-result-source-stale');}
 if(source.claim.groupId!==run.groupId||source.claim.workItemId!==run.workItemId||source.claim.taskId!==run.taskId||source.claim.generation!==run.generation
  ||source.claim.graphVersion!==snapshot.graphVersion||source.claim.graphVersion!==current.graphVersion||source.claim.targetVersion!==work.targetVersion
  ||source.contractHash!==confirmed.derivedContractHash||source.contractHash!==(work.derivedContractHash??null))throw Error('saved-result-source-stale');
 if(isGroupArchived(store,run.groupId)||group.stopped||readStopIntent(store,run.groupId)||store.dispatchBlocked||group.status==='blocked')throw Error('saved-result-source-stale');
 for(const row of store.db.prepare('SELECT body FROM runs WHERE group_id=? AND work_item_id=? AND active=1').all(run.groupId,run.workItemId)){
  const active=JSON.parse(String(row.body));if(active.runId!==current.runId||active.state!=='blocked')throw Error('saved-result-source-stale');
 }
 const request=latestRequestForRun(store,run.groupId,current.runId);if(request&&ADOPTABLE_STATES.includes(request.state))throw Error('saved-result-source-stale');
 assertKnown(store,run);if(current.runId!==run.runId)assertKnown(store,current);
 if(groupUsageUnknown(store,run.groupId))throw Error('saved-result-usage-unsettled');
 return {run,work,current,group,source,confirmed,snapshot,predecessor};
}
function assertKnown(store:ControlStore,run:any):void {
 if(run.unknown.work||run.unknown.handoff||store.db.prepare('SELECT seq FROM usage_events WHERE run_id=? AND seq>?').get(run.runId,run.highWater))throw Error('saved-result-usage-unsettled');
 if(run.usageSettlement!==undefined&&!hasValidUsageSettlement(store,run))throw Error('saved-result-usage-unsettled');
 const proof=settlementProof(store,run),bytes=JSON.parse(settlementArtifact(store,proof.stopProof.source).toString());
 if(bytes.ownerLeaseReleased!==true||bytes.workerSealed!==true)throw Error('saved-result-process-authority-invalid');
 for(const bucket of ['work','handoff'] as const)amountSchema.parse(run.cumulative[bucket]);
}
export function savedRecoveryAccounting(store:ControlStore,run:any){
 assertKnown(store,run);const proof=settlementProof(store,run);let settlement:ArtifactRef|null=null,receipt:ArtifactRef|null=null;
 if(run.usageSettlement!==undefined){
  settlement=persistRecoveryArtifact(store,run.usageSettlement);const row=store.db.prepare('SELECT principal,client,verb,body_json FROM commands WHERE group_id=? AND id=?').get(run.groupId,run.usageSettlement.commandId)!;
  receipt=persistRecoveryArtifact(store,{principal:row.principal,client:row.client,verb:row.verb,commandId:run.usageSettlement.commandId,result:JSON.parse(String(row.body_json)).result});
 }
 return {work:run.cumulative.work,handoff:run.cumulative.handoff,highWater:run.highWater,report:proof.report,stopProof:proof.stopProof.source,settlement,receipt};
}
const sourcePort=(deps:StopDeps,run:any):ExecutionPort=>deps.profileRouter.resolve('task',run.executionProfile.profileId,run.executionProfile.profileHash).port;
export async function readSavedResultEligibility(deps:StopDeps,runId:string):Promise<SavedResultSourceEligibility>{
 let prepared:ReturnType<typeof prepareRecoverySource>|undefined;
 try {
  const current=currentSavedResultSource(deps.store,runId),port=sourcePort(deps,current.run);
  if((await port.readFeatures?.())?.savedResultRecovery!=='v1'||!port.savedResultSourceEligibility)return unavailable('control-saved-result-unsupported');
  const source=sourceRecord(deps.store,current.run);prepared=prepareRecoverySource(deps.store,source.source,source.authorityKind);
  const answer=await port.savedResultSourceEligibility({source:current.source,sourceAttempt:source.attempt,...prepared});
  const again=currentSavedResultSource(deps.store,runId);
  if(!settlementSame(sourceRecord(deps.store,again.run),source))return unavailable('saved-result-source-stale');
  if(answer.status==='eligible'&&(answer.sourceIdentity.envelopeHash!==again.run.drive.envelopeHash||answer.recoveryOf.capsuleHash!==source.source.hash))return unavailable('saved-result-source-stale');
  return answer;
 }catch(error){return unavailable(error instanceof ControlError?error.code:error instanceof Error&&error.message.startsWith('saved-result-')?error.message:'saved-result-evidence-unavailable');}
 finally{prepared?.dispose();}
}
/** Async evidence/capability preparation never publishes authorization; all facts are read again in the ledger transaction. */
type RecoveryCommandResult=CommandLookupV1["body"];
export async function applyVerifySavedResult(deps:StopDeps,command:VerifySavedResultCommand):Promise<RecoveryCommandResult>{
 const replay=preflightWebCommand<RecoveryCommandResult>(deps.store,command);if(replay)return replay.body;
 const release=deps.admissionGate?.enter();
 try {
  const evidence=await readSavedResultEligibility(deps,command.payload.sourceRunId);
  let probes:Awaited<ReturnType<StopDeps['profileRouter']['probe']>>[]=[];
  if(evidence.status==='eligible'){
   const initial=currentSavedResultSource(deps.store,command.payload.sourceRunId),slot=frozenWorkAgent(initial.work);
   probes=await Promise.all(['worker','handoff'].map(role=>{const binding=initial.snapshot.profiles[role as 'worker'|'handoff'];return deps.profileRouter.probe(deps.profileRouter.resolve(role==='worker'?'task':'handoff',binding.profileId,binding.profileHash),slot.agent);}));
  }
  return applyWebCommand<RecoveryCommandResult>(deps.store,{rawCommand:command,expand:()=>({...command,schema:'orca-authority-command-v1'}),apply:context=>{
   const current=currentSavedResultSource(deps.store,command.payload.sourceRunId);
   if(command.target.groupId!==current.run.groupId||command.target.taskId!==current.run.taskId)throw new ControlError('saved-result-source-stale');
   if(evidence.status!=='eligible')throw new ControlError('saved-result-unavailable',evidence.reason);
   const source=sourceRecord(deps.store,current.run),of=evidence.recoveryOf;
   if(command.payload.sourceAttempt!==source.attempt||command.payload.capsuleHash!==source.source.hash||of.sourceRunId!==current.run.runId||of.sourceAttempt!==source.attempt
    ||evidence.sourceIdentity.envelopeHash!==current.run.drive.envelopeHash||evidence.sourceIdentity.executionId!==current.run.executionId)throw new ControlError('saved-result-source-stale');
   // Rehash the entire source closure in the authoritative transaction after the asynchronous probe.
   recoveryClosure(deps.store,[source.source]);
   const inheritedBase=add(current.source.tokenPolicy?.inheritedUsage??zero(),current.run.cumulative.work);
   let inherited=inheritedBase;
   if(current.predecessor){if(!settlementSame(current.predecessor.recoveryOf,of))throw new ControlError('saved-result-source-stale');inherited=add(current.predecessor.funding.inheritedUsage,current.current.cumulative.work);}
   const originalAccounting=savedRecoveryAccounting(deps.store,current.run);
   const old=current.current;
   if(Number(deps.store.db.prepare('SELECT active FROM runs WHERE id=?').get(old.runId)?.active)===1){
    saveRunBody(deps.store,{...old,state:'settled-failed',recoverable:false},false);releaseCommitment(deps.store,old.groupId,add(finiteCommitment(old.remaining.work),old.remaining.handoff));
   }
   const work={...current.work,status:'ready',fundingReleased:true};saveWork(deps.store,current.run.groupId,work);
   const optional=hasOptionalTaskPolicy(deps.store,current.run.groupId,work.workItemId);
   const decision=optional?decideFundedAllowance(deps.store,current.run.groupId,work.workItemId,(deps.now?.()??new Date()).getTime()):null;
   const grant=decision?.allowance?.grant??(optional?null:structuredClone(work.grant));
   if(!grant||dimensions.some(d=>grant.work[d]===0))throw new ControlError('saved-result-unavailable','saved-result-authored-budget-exhausted');
   const reserve=readBudgetProposal(deps.store,current.run.groupId).explicitUnallocatedReserve;
   const total=add(finiteCommitment(grant.work),grant.handoff);
   for(const d of dimensions)if(reserve[d]!==null&&total[d]>reserve[d]!)throw new ControlError('group-reserve-insufficient',d);
   if(claimCapBlocking(deps.store,current.run.groupId,grant.work.tokens===null?null:grant.work.tokens+grant.handoff.tokens,(deps.now?.()??new Date()).getTime()))throw new ControlError('saved-result-unavailable','spend-cap-reached');
   if(probes.length!==2||probes.some((p,i)=>probeBlocksDispatch(p,current.snapshot.budgetMode,i===0?grant.work.tokens:p.observed.handoffExecution==='mechanical-in-run-v1'?null:grant.handoff.tokens,i===0?'work':'handoff'))||current.snapshot.budgetMode==='strict')throw new ControlError('claim-capability-unavailable');
   reserveCommitment(deps.store,current.run.groupId,total);setAllocationStates(deps.store,current.run.groupId,work.workItemId,'confirmed',optional?undefined:grant);
   const policy=persistRecoveryArtifact(deps.store,{schema:'ccloop-recovery-policy-authority-v1',groupId:current.run.groupId,workItemId:work.workItemId,taskId:work.taskId,sourceRunId:current.run.runId,contractHash:current.source.contractHash,accountingMode:optional?'optional-v1':'finite-legacy',authoredWork:current.confirmed.grant.work});
   const allocations=readBudgetProposal(deps.store,current.run.groupId).allocations.filter(a=>a.ownerKind==='task'&&a.ownerId===work.taskId);
   if(allocations.length!==2||allocations.some(a=>!settlementSame(a.amount,(optional?work.grant:grant)[a.bucket as 'work'|'handoff'])||a.state!=='confirmed'))throw new ControlError('recovery-blocked','saved-result-reservation');
   const run=createStartingRun(deps.store,current.run.groupId,work,current.snapshot,context.nextCommandRevision!,undefined,undefined,{commandId:command.commandId,grant,initialize:newRun=>{
    if(optional)newRun.tokenPolicy={authoredTokenCeiling:work.grant.work.tokens,bindingCauses:decision!.allowance!.bindingCauses,inheritedUsage:inherited};
    const fundedTotal={...grant.work};for(const d of dimensions)fundedTotal[d]=grant.work[d]===null?null:inherited[d]+grant.work[d]!;
    const funding=recoveryFundingSchema.parse({kind:optional?'optional-cumulative-v1':'legacy-fresh-grant-v1',historicalPolicy:{accountingMode:optional?'optional-v1':'finite-legacy',authoredWork:current.confirmed.grant.work,contractHash:current.source.contractHash,authority:policy},inheritedUsage:inherited,freshGrant:grant,fundedTotal,reservation:{runId:newRun.runId,revision:context.nextCommandRevision,workAllocationId:`allocation-${sha256Canonical({runId:newRun.runId,revision:context.nextCommandRevision,groupId:current.run.groupId,taskId:work.taskId,bucket:'work',grant:grant.work})}`,handoffAllocationId:`allocation-${sha256Canonical({runId:newRun.runId,revision:context.nextCommandRevision,groupId:current.run.groupId,taskId:work.taskId,bucket:'handoff',grant:grant.handoff})}`}});
    const predecessor=current.predecessor?{runId:old.runId,recoveryOf:of,outcome:'interrupted' as const,record:old.savedInterruption}:null;
    const admission=savedResultAdmissionSchema.parse({schema:'ccloop-saved-result-admission-v1',revision:context.nextCommandRevision,source:evidence.sourceIdentity,recoveryOf:of,contractHash:current.source.contractHash,claim:{runId:newRun.runId,generation:newRun.generation,commandId:newRun.commandId,ownerToken:newRun.ownerToken,configHash:newRun.configHash},currentRunId:old.runId,predecessor,accounting:originalAccounting,funding});
    const ref=persistRecoveryArtifact(deps.store,admission),sourceRef=persistRecoveryArtifact(deps.store,current.source);
    newRun.mode='verify-saved-result';newRun.recoveryOf=of;newRun.savedDispatch={state:'never-submitted',admissionHash:ref.hash,fundingHash:sha256Canonical(funding),revision:context.nextCommandRevision,envelopeHash:null};
    newRun.savedRecovery=savedRecoverySchema.parse({recoveryOf:of,source,sourceEnvelope:sourceRef,admission:ref,funding,currentRunId:old.runId,predecessor,artifacts:[sourceRef,...(predecessor?[predecessor.record]:[])],revision:context.nextCommandRevision});
   }});
   return commandSuccess(context,{kind:'saved-result-verification-started',taskId:work.taskId,runId:run.runId,recoveryOf:of});
  }}).body;
 }catch(error){if(error instanceof Error&&error.message.startsWith('saved-result-')){
  return applyWebCommand<RecoveryCommandResult>(deps.store,{rawCommand:command,expand:()=>({...command,schema:'orca-authority-command-v1'}),apply:()=>{throw new ControlError(error.message==='saved-result-source-stale'?'saved-result-source-stale':'saved-result-unavailable',error.message);}}).body;
 }throw error;}finally{release?.();}
}

/** The active run remains under the exact owner transaction that admitted it. */
export function assertCurrentSavedRecovery(store:ControlStore,run:any,at:number):SavedRecovery {
 readFundedAllowance(store,run);
 const record=savedRecoverySchema.parse(run.savedRecovery),work=readWork(store,run.groupId,run.workItemId) as any,source=readRunBody(store,record.recoveryOf.sourceRunId) as any;
 const admission=savedResultAdmissionSchema.parse(JSON.parse(settlementArtifact(store,record.admission).toString()));
 const current=store.db.prepare('SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1').get(run.groupId,run.workItemId),revision=store.db.prepare('SELECT revision FROM groups WHERE id=?').get(run.groupId)?.revision;
 const confirmed=readConfirmedTaskExecution(store,run.groupId,run.taskId),group=readGroup(store,run.groupId);
 if(run.mode!=='verify-saved-result'||!settlementSame(run.recoveryOf,record.recoveryOf)||work.currentRunId!==run.runId||current?.id!==run.runId||Number(revision)!==record.revision
  ||confirmed.derivedContractHash!==admission.contractHash||confirmed.derivedContractHash!==(work.derivedContractHash??null)||source.drive.envelopeHash!==admission.source.envelopeHash
  ||Number(store.db.prepare('SELECT graph_version FROM groups WHERE id=?').get(run.groupId)?.graph_version)!==run.graphVersion||Number(store.db.prepare('SELECT target_version FROM work_items WHERE group_id=? AND id=?').get(run.groupId,run.taskId)?.target_version)!==run.targetVersion||work.targetVersion!==run.targetVersion||run.graphVersion!==readFrozenSnapshot(store,run.groupId).graphVersion||work.pendingRunId!=null||work.continuation!=null
  ||group.stopped||readStopIntent(store,run.groupId)||isGroupArchived(store,run.groupId)||store.dispatchBlocked||groupUsageUnknown(store,run.groupId))throw new ControlError('saved-result-source-stale');
 assertKnown(store,source);if(!settlementSame(source.cumulative.work,admission.accounting.work)||!settlementSame(source.cumulative.handoff,admission.accounting.handoff)||source.highWater!==admission.accounting.highWater)throw new ControlError('saved-result-usage-unsettled');
 if(!settlementSame(admission.claim,{runId:run.runId,generation:run.generation,commandId:run.commandId,ownerToken:run.ownerToken,configHash:run.configHash})||!settlementSame(record.funding.freshGrant,run.grant))throw new ControlError('saved-result-source-stale');
 recoveryClosure(store,[record.source.source,record.admission,...record.artifacts]);
 if(claimCapBlocking(store,run.groupId,0,at))throw new ControlError('saved-result-unavailable','spend-cap-reached');
 for(const d of dimensions)if(group.limit[d]!==null&&group.used[d]+group.reserved[d]>group.limit[d]!)throw new ControlError('saved-result-unavailable','group-reserve-insufficient');
 return record;
}
