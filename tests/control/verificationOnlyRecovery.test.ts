import {describe,expect,it} from 'vitest';
import {
  recoveryOfSchema,savedResultSourcePackageSchema,savedResultPackageSchema,
  savedResultSourceEligibilitySchema,savedResultEligibilitySchema,
  savedResultAdmissionSchema,savedResultSettlementSchema,savedRecoverySchema,
  ompWithoutFinalCompletionSchema,
} from '../../src/control/savedResultProtocol.js';
import {candidateSchema} from '../../src/control/schema.js';
import {driverHarness} from './fixtures/driverHarness.js';
import {collectInto,readDriverRun,readStartEnvelope} from '../../src/control/executionDriver.js';
import {createHash} from 'node:crypto';
import {settlementArtifact} from '../../src/control/usageSettlement.js';

const hash='a'.repeat(64), ref={artifactId:'saved-result-a',hash};
const identity={sourceRunId:'source',sourceAttempt:1,capsuleHash:hash,snapshotHash:hash};
const verificationOnly={...identity,kind:'verification-only-v1'} as const;
const ordinary={...identity,normalizedExecutionHash:hash};
const sourceIdentity={groupId:'group',workItemId:'work',taskId:'task',runId:'source',generation:1,graphVersion:1,targetVersion:1,executionId:'execution',envelopeHash:hash};
const limitation='published-candidate-only; current membership and settled accounting require controller admission';
const newKind='execution-without-final-v1';

// Removing the verification-only recovery branch rejects the hashless authority at every admission boundary.
describe('verification-only wire',()=>{
 it('keeps the old recovery bytes and refuses a fabricated hash on the new discriminator',()=>{
  expect(recoveryOfSchema.parse(ordinary)).toEqual(ordinary);
  expect(recoveryOfSchema.parse(verificationOnly)).toEqual(verificationOnly);
  expect(recoveryOfSchema.safeParse({...verificationOnly,normalizedExecutionHash:hash}).success).toBe(false);
  expect(recoveryOfSchema.safeParse({...ordinary,kind:'verification-only-v1'}).success).toBe(false);
 });
 it('admits only the distinct source package and eligibility shape',()=>{
  const packageBase={source:ref,artifacts:[{ref,file:'source.bin'}]};
  expect(savedResultSourcePackageSchema.parse({...packageBase,schema:'ccloop-saved-result-source-package-v1',authorityKind:newKind}).authorityKind).toBe(newKind);
  expect(savedResultPackageSchema.parse({...packageBase,schema:'ccloop-saved-result-package-v1',authorityKind:newKind,admission:ref}).authorityKind).toBe(newKind);
  const eligible={status:'eligible',authorityKind:newKind,verificationOnly:true,sourceIdentity,rawExecutionTokens:14,recoveryOf:verificationOnly,limitation};
  expect(savedResultSourceEligibilitySchema.parse(eligible)).toEqual(eligible);
  expect(savedResultSourceEligibilitySchema.safeParse({...eligible,verificationOnly:false}).success).toBe(false);
  expect(savedResultSourceEligibilitySchema.safeParse({...eligible,recoveryOf:ordinary}).success).toBe(false);
  expect(savedResultEligibilitySchema.parse({status:'eligible',authorityKind:newKind,verificationOnly:true})).toEqual({status:'eligible',authorityKind:newKind,verificationOnly:true});
  expect(savedResultEligibilitySchema.safeParse({status:'eligible',authorityKind:newKind,normalizedExecutionHash:hash}).success).toBe(false);
 });
 it('carries a hashless recovery through admission, settlement and saved run without rewriting it',()=>{
  const funding={kind:'legacy-fresh-grant-v1',inheritedUsage:{tokens:14,activeMs:1,attempts:1,sessions:1},reservation:{runId:'recovery',revision:1,workAllocationId:'work-allocation',handoffAllocationId:'handoff-allocation'},historicalPolicy:{contractHash:hash,authority:ref,accountingMode:'finite-legacy',authoredWork:{tokens:100,activeMs:100,attempts:2,sessions:2}},freshGrant:{work:{tokens:100,activeMs:100,attempts:2,sessions:2},handoff:{tokens:10,activeMs:10,attempts:1,sessions:1}},fundedTotal:{tokens:114,activeMs:101,attempts:3,sessions:3}};
  const accounting={work:{tokens:14,activeMs:1,attempts:1,sessions:1},handoff:{tokens:0,activeMs:0,attempts:0,sessions:0},highWater:2,report:ref,stopProof:ref,settlement:null,receipt:null};
  const admission={schema:'ccloop-saved-result-admission-v1',revision:1,funding,source:sourceIdentity,recoveryOf:verificationOnly,contractHash:hash,claim:{runId:'recovery',generation:2,commandId:'verify',ownerToken:'owner',configHash:hash},currentRunId:'source',predecessor:null,accounting};
  expect(savedResultAdmissionSchema.parse(admission).recoveryOf).toEqual(verificationOnly);
  const settlement={schema:'ccloop-saved-result-settlement-v1',identity:{...sourceIdentity,runId:'recovery',generation:2},recoveryOf:verificationOnly,disposition:'complete',usageStatus:'known',state:ref,lifecycle:null,accepted:ref,envelope:ref,usage:ref,stopProof:ref,usageObservations:[]};
  expect(savedResultSettlementSchema.parse(settlement).recoveryOf).toEqual(verificationOnly);
  const run={recoveryOf:verificationOnly,source:{authorityKind:newKind,source:ref,attempt:1},sourceEnvelope:ref,admission:ref,funding,currentRunId:'source',predecessor:null,artifacts:[ref],revision:1};
  expect(savedRecoverySchema.parse(run).recoveryOf).toEqual(verificationOnly);
 });
 it('decodes the published malformed-final capsule without an execution or normalized hash',()=>{
  const capsule={schema:'ccloop-execution-without-final-v1',identity:sourceIdentity,attempt:1,executor:{kind:'omp',configHash:hash},frozenContractHash:hash,
   gate:{stage:'execute-format',decision:'malformed-final'},published:{sha:'b'.repeat(40),base:'c'.repeat(40),ref:'refs/ccloop/source/attempts/1',tree:'d'.repeat(40)},decoder:'strict-execution-v1',
   normalization:{reason:'execution-format-invalid',diagnostic:{method:'none',candidates:0,valid:0,hidden:false,originalBytes:5}},attemptStartHead:'c'.repeat(40),resolvedBase:'c'.repeat(40),
   usage:{tokenUsage:14,highWater:2},process:{reason:'completed',code:0,signal:null,isolated:true},verifier:{entered:false,proof:ref},
   artifacts:{envelope:ref,config:ref,acceptedContract:ref,runtimeContract:ref,plan:ref,outcome:ref,final:ref,events:ref,process:ref,usageLedger:ref,owner:ref,usageObservations:[]},snapshot:ref,
   stop:{executionId:'execution',generation:1,isolated:true},capturedAt:'2026-11-09T00:00:00.000Z'};
  expect(ompWithoutFinalCompletionSchema.parse(capsule)).toEqual(capsule);
  expect(ompWithoutFinalCompletionSchema.safeParse({...capsule,normalizedExecutionHash:hash}).success).toBe(false);
  expect(ompWithoutFinalCompletionSchema.safeParse({...capsule,usage:{tokenUsage:null,highWater:2}}).success).toBe(false);
 });
 it('accepts only literal true on the collect candidate and preserves absence on old candidates',()=>{
  const candidate={groupId:'group',workItemId:'work',taskId:'task',runId:'recovery',generation:2,graphVersion:1,targetVersion:1,checkpointId:'checkpoint',usageHighWater:2,
   result:'complete',artifacts:[ref],snapshot:ref,missing:[],unresolvedRequestIds:[],terminalOutcome:'succeeded',stopProof:null,handoff:ref};
  expect(candidateSchema.parse(candidate)).toEqual(candidate);
  expect(candidateSchema.parse({...candidate,verificationOnly:true})).toEqual({...candidate,verificationOnly:true});
  expect(candidateSchema.safeParse({...candidate,verificationOnly:false}).success).toBe(false);
 });
});

it('keeps a verification-only collect label on the settled candidate and acceptance',async()=>{
 const t=await driverHarness([{taskId:'a'}]);
 try{
  const router=t.deps.router;
  t.deps.router={...router,resolve(kind,profileId,profileHash){const resolved=router.resolve(kind,profileId,profileHash),collect=resolved.port.collect.bind(resolved.port);
   return {...resolved,port:{...resolved.port,collect:async(envelope,afterSeq)=>{const report=await collect(envelope,afterSeq);return {...report,candidate:report.candidate?{...report.candidate,verificationOnly:true as const}:null};}}};
  }};
  const runId=await t.claim();await t.until(t.driver(),()=>t.body(runId).state==='settled');
  const checkpoint=t.h.store.db.prepare('SELECT body FROM checkpoints WHERE run_id=?').get(runId);
  expect(JSON.parse(String(checkpoint!.body)).verificationOnly).toBe(true);
  const row=t.h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='acceptance'").get(`acceptance:${runId}`);
  const proof=JSON.parse(settlementArtifact(t.h.store,JSON.parse(String(row!.body)).source).toString());
  expect(proof.verificationOnly).toBe(true);
 }finally{await t.h.dispose();}
});

it('collects a published OMP without-final capsule and preserves the verification-only candidate label',async()=>{
 const t=await driverHarness([{taskId:'a'}]);
 try{
  const runId=await t.claim();await t.until(t.driver(),()=>t.body(runId).state==='accepted');
  const input=readStartEnvelope(t.h.store,readDriverRun(t.h.store,runId));
  const files=new Map<string,Buffer>();
  const put=(data:unknown)=>{const bytes=Buffer.from(JSON.stringify(data)),digest=createHash('sha256').update(bytes).digest('hex'),reference={artifactId:`saved-result-${digest}`,hash:digest};files.set(digest,bytes);return reference;};
  const evidence=put({proof:true});
  const snapshot=put({schema:'ccloop-execution-snapshot-v1',head:'b'.repeat(40),indexTree:'b'.repeat(40),indexCommit:'b'.repeat(40),bundleRefName:`refs/ccloop/${runId}/attempts/1`,index:evidence,bundle:evidence,status:evidence,rootMode:0o755,files:[],directories:[],deleted:[]});
  const sourceIdentity={groupId:input.claim.groupId,workItemId:input.claim.workItemId,taskId:input.claim.taskId,runId,generation:input.claim.generation,graphVersion:input.claim.graphVersion,targetVersion:input.claim.targetVersion,executionId:`execution-${runId}`,envelopeHash:readDriverRun(t.h.store,runId).drive!.envelopeHash!};
  const artifacts={envelope:evidence,config:evidence,acceptedContract:evidence,runtimeContract:evidence,plan:evidence,outcome:evidence,final:evidence,events:evidence,process:evidence,usageLedger:evidence,owner:evidence,usageObservations:[]};
  const capsule=put({schema:'ccloop-execution-without-final-v1',identity:sourceIdentity,attempt:1,executor:{kind:'omp',configHash:hash},frozenContractHash:hash,gate:{stage:'execute-format',decision:'malformed-final'},published:{sha:'c'.repeat(40),base:'b'.repeat(40),ref:`refs/ccloop/${runId}/attempts/1`,tree:'d'.repeat(40)},decoder:'strict-execution-v1',normalization:{reason:'execution-format-invalid',diagnostic:{method:'none',candidates:0,valid:0,hidden:false,originalBytes:5}},attemptStartHead:'b'.repeat(40),resolvedBase:'b'.repeat(40),usage:{tokenUsage:14,highWater:2},process:{reason:'completed',code:0,signal:null,isolated:true},verifier:{entered:false,proof:evidence},artifacts,snapshot,stop:{executionId:`execution-${runId}`,generation:input.claim.generation,isolated:true},capturedAt:'2026-11-09T00:00:00.000Z'});
  const router=t.deps.router;
  t.deps.router={...router,resolve(kind,profileId,profileHash){const resolved=router.resolve(kind,profileId,profileHash),original=resolved.port.collect.bind(resolved.port);
   return {...resolved,port:{...resolved.port,
    readFeatures:async()=>({protocol:1,savedResultRecovery:'v1' as const}),
    collectSavedResultEvidence:async()=>({schema:'ccloop-saved-result-evidence-v1',identity:sourceIdentity,attempt:1,capsule,reason:null}),
    readSavedResultEvidence:async(_input,_capsule,reference)=>files.get(reference.hash)!,
    collect:async(envelope,afterSeq)=>{const report=await original(envelope,afterSeq);return {...report,candidate:report.candidate?{...report.candidate,verificationOnly:true as const}:null};},
   }};
  }};
  const collected=await collectInto(t.deps,readDriverRun(t.h.store,runId));
  expect(collected.candidate?.verificationOnly).toBe(true);
  const owner=readDriverRun(t.h.store,runId);
  expect(owner.savedSource).toEqual({authorityKind:'execution-without-final-v1',source:capsule,attempt:1});
  expect(settlementArtifact(t.h.store,capsule)).toEqual(files.get(capsule.hash));
 }finally{await t.h.dispose();}
});
