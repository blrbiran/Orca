/** Strict mirrors of the independent private ccloop recovery channels. Core protocol3 is unchanged. */
import {z} from "zod";
const idSchema=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const number=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const artifactRefSchema=z.object({artifactId:idSchema,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const budgetAmountSchema=z.object({tokens:number.nullable(),activeMs:number,attempts:number,sessions:number}).strict();
export const recoveryOfSchema=z.object({sourceRunId:idSchema,sourceAttempt:number.positive(),capsuleHash:z.string().regex(/^[a-f0-9]{64}$/),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),normalizedExecutionHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const safe=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), positive=safe.refine(n=>n>0), hash=z.string().regex(/^[a-f0-9]{64}$/);
const amount=z.object({tokens:safe,activeMs:safe,attempts:safe,sessions:safe}).strict();
const policyBase={contractHash:hash,authority:artifactRefSchema};
const reservationSchema=z.object({runId:idSchema,revision:safe,workAllocationId:idSchema,handoffAllocationId:idSchema}).strict();
const fundingBase={inheritedUsage:amount,reservation:reservationSchema};
export const recoveryFundingSchema=z.discriminatedUnion("kind",[
 z.object({...fundingBase,kind:z.literal("legacy-fresh-grant-v1"),historicalPolicy:z.object({...policyBase,accountingMode:z.literal("finite-legacy"),authoredWork:amount}).strict(),freshGrant:z.object({work:amount,handoff:amount}).strict(),fundedTotal:amount}).strict(),
 z.object({...fundingBase,kind:z.literal("optional-cumulative-v1"),historicalPolicy:z.object({...policyBase,accountingMode:z.literal("optional-v1"),authoredWork:budgetAmountSchema}).strict(),freshGrant:z.object({work:budgetAmountSchema,handoff:amount}).strict(),fundedTotal:budgetAmountSchema}).strict(),
]);
export type RecoveryFunding=z.infer<typeof recoveryFundingSchema>;
export const recoveryPolicyAuthoritySchema=z.object({schema:z.literal("ccloop-recovery-policy-authority-v1"),groupId:idSchema,workItemId:idSchema,taskId:idSchema,sourceRunId:idSchema,
 contractHash:hash,accountingMode:z.enum(["finite-legacy","optional-v1"]),authoredWork:budgetAmountSchema}).strict();
export const savedResultAdmissionSchema=z.object({
 schema:z.literal("ccloop-saved-result-admission-v1"),revision:safe,funding:recoveryFundingSchema,
 source:z.object({groupId:idSchema,workItemId:idSchema,taskId:idSchema,runId:idSchema,generation:positive,graphVersion:safe,targetVersion:safe,executionId:idSchema,envelopeHash:hash}).strict(),
 recoveryOf:recoveryOfSchema,contractHash:hash,
 claim:z.object({runId:idSchema,generation:positive,commandId:idSchema,ownerToken:idSchema,configHash:hash}).strict(),
 currentRunId:idSchema,
 predecessor:z.object({runId:idSchema,recoveryOf:recoveryOfSchema,outcome:z.literal("interrupted"),record:artifactRefSchema}).strict().nullable(),
 accounting:z.object({work:amount,handoff:amount,highWater:safe,report:artifactRefSchema,stopProof:artifactRefSchema,
  settlement:artifactRefSchema.nullable(),receipt:artifactRefSchema.nullable()}).strict(),
}).strict();
export type SavedResultAdmission=z.infer<typeof savedResultAdmissionSchema>;
export const savedResultPackageSchema=z.object({schema:z.literal("ccloop-saved-result-package-v1"),
 authorityKind:z.enum(["execution-format-failure-v1","legacy-published-candidate-v1"]),source:artifactRefSchema,admission:artifactRefSchema,
 artifacts:z.array(z.object({ref:artifactRefSchema,file:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)}).strict()).max(20000),
}).strict();
export type SavedResultPackage=z.infer<typeof savedResultPackageSchema>;
export const savedResultFenceSchema=z.object({schema:z.literal("ccloop-saved-result-fence-v1"),
 admissionHash:hash,packageHash:hash,runId:idSchema,generation:positive,revision:safe,currentRunId:idSchema,status:z.literal("admitted")}).strict();
export type SavedResultFence=z.infer<typeof savedResultFenceSchema>;

const taskResultIdentitySchema=savedResultAdmissionSchema.shape.source.omit({taskId:true}).extend({taskId:idSchema.nullable()}).strict();
const ref=artifactRefSchema,oid=z.string().regex(/^[a-f0-9]{40,64}$/);
export const savedExecutionSnapshotSchema=z.object({
  schema:z.literal("ccloop-execution-snapshot-v1"),head:oid,indexTree:oid,indexCommit:oid,bundleRefName:z.string().startsWith("refs/ccloop/"),
  index:ref,bundle:ref,status:ref,rootMode:safe.max(0o777),
  files:z.array(z.object({path:z.string().min(1),kind:z.literal("file"),mode:safe,ref}).strict()).max(10000),
  directories:z.array(z.object({path:z.string().min(1),mode:safe}).strict()).max(10000),
  deleted:z.array(z.string()),
}).strict();
export const executionFormatFailureSchema=z.object({
  schema:z.literal("ccloop-execution-format-failure-v1"),identity:taskResultIdentitySchema,attempt:positive,
  executor:z.object({kind:z.literal("codex"),configHash:hash}).strict(), frozenContractHash:hash,
  acceptedBase:z.string().min(1),resolvedBase:oid,attemptStartHead:oid,decoder:z.literal("strict-execution-v1"),classification:z.literal("execution-format-failure-v1"),
  process:z.object({reason:z.literal("completed"),code:z.literal(0),signal:z.null(),isolated:z.literal(true)}).strict(),
  usage:z.object({tokenUsage:positive,highWater:positive}).strict(),
  verifier:z.object({entered:z.literal(false),proof:ref}).strict(),
  artifacts:z.object({envelope:ref,config:ref,acceptedContract:ref,runtimeContract:ref,final:ref,events:ref,schema:ref,decodeError:ref,normalization:ref,outcome:ref,process:ref,plan:ref,usage:ref,usageLedger:ref,usageObservations:z.array(z.object({source:ref,copy:ref}).strict()),owner:ref}).strict(),
  snapshot:ref,completeness:z.object({complete:z.literal(true),parts:z.tuple([z.literal("original-process"),z.literal("original-stream"),z.literal("actual-usage"),z.literal("successful-plan"),z.literal("verifier-not-entered"),z.literal("tree-index-bundle-files")])}).strict(),
  capturedAt:z.string().datetime({offset:true}),captureOwner:z.string().min(1),
}).strict();
export type ExecutionFormatFailureCapsule=z.infer<typeof executionFormatFailureSchema>;
export const savedResultCollectionSchema=z.object({
  schema:z.literal("ccloop-saved-result-evidence-v1"),identity:taskResultIdentitySchema,attempt:safe,capsule:ref.nullable(),reason:z.string().nullable(),
}).strict();

export const savedResultSourcePackageSchema=savedResultPackageSchema.omit({admission:true}).extend({schema:z.literal("ccloop-saved-result-source-package-v1")}).strict();
export type SavedResultSourcePackage=z.infer<typeof savedResultSourcePackageSchema>;
const unavailableSchema=z.object({status:z.literal("unavailable"),reason:z.string().min(1)}).strict();
export const savedResultSourceEligibilitySchema=z.union([unavailableSchema,z.object({status:z.literal("eligible"),authorityKind:savedResultPackageSchema.shape.authorityKind,sourceIdentity:savedResultAdmissionSchema.shape.source,rawExecutionTokens:safe,recoveryOf:recoveryOfSchema,limitation:z.literal("published-candidate-only; current membership and settled accounting require controller admission")}).strict()]);
export type SavedResultSourceEligibility=z.infer<typeof savedResultSourceEligibilitySchema>;
export const savedResultEligibilitySchema=z.union([unavailableSchema,z.object({status:z.literal("eligible"),authorityKind:savedResultPackageSchema.shape.authorityKind,normalizedExecutionHash:hash}).strict()]);
export const interruptedSavedResultSchema=z.object({schema:z.literal("ccloop-saved-result-interrupted-v1"),envelope:ref,accepted:ref,package:ref,admission:ref,state:ref,lifecycle:ref,usage:ref,accounting:savedResultAdmissionSchema.shape.accounting,artifacts:z.array(ref)}).strict();
export const savedResultSettlementSchema=z.object({schema:z.literal("ccloop-saved-result-settlement-v1"),identity:taskResultIdentitySchema,recoveryOf:recoveryOfSchema,disposition:z.enum(["complete","interrupted","terminal"]),usageStatus:z.enum(["known","unknown"]),state:ref,lifecycle:ref.nullable(),accepted:ref,envelope:ref,usage:ref,stopProof:ref,usageObservations:z.array(z.object({source:ref,copy:ref}).strict())}).strict();
export type SavedResultSettlement=z.infer<typeof savedResultSettlementSchema>;
export const savedSourceSchema=z.object({authorityKind:savedResultPackageSchema.shape.authorityKind,source:ref,attempt:positive}).strict();
export const savedRecoverySchema=z.object({recoveryOf:recoveryOfSchema,source:savedSourceSchema,sourceEnvelope:ref,admission:ref,funding:recoveryFundingSchema,currentRunId:idSchema,predecessor: savedResultAdmissionSchema.shape.predecessor,artifacts:z.array(ref),revision:safe}).strict();
export type SavedRecovery=z.infer<typeof savedRecoverySchema>;
export type RecoveryOf=z.infer<typeof recoveryOfSchema>;

export const savedDispatchSchema=z.object({state:z.enum(['never-submitted','submitted']),admissionHash:hash,fundingHash:hash,revision:safe,envelopeHash:hash.nullable()}).strict();
export const savedNoDispatchSchema=z.object({schema:z.literal('orca-saved-result-no-dispatch-v1'),groupId:idSchema,workItemId:idSchema,taskId:idSchema,runId:idSchema,generation:positive,commandId:idSchema,ownerTokenHash:hash,admission:ref,fundingHash:hash,revision:safe,envelopeHash:hash,handoffRequestId:idSchema,inspection:z.literal('absent'),controllerState:z.literal('never-submitted'),observedAt:safe}).strict();
