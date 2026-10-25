import { recoveryOfSchema } from "./savedResultProtocol.js";
import { z } from "zod";
export const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/**
 * The longest delay a Node timer holds: setTimeout turns anything above 2^31 - 1 ms (about 24.8 days) into 1 ms, and
 * ccloop hands a contract's phase timeout to setTimeout. A phase timeout Orca derives never exceeds it.
 */
export const MAX_TIMER_MS = 2_147_483_647;
export const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const canonicalTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
export const canonicalTimestampSchema = z.string().regex(canonicalTimestampPattern).superRefine((value,ctx) => {
  const match=canonicalTimestampPattern.exec(value);
  if(!match) return;
  const [,yearText,monthText,dayText,hourText,minuteText,secondText]=match;
  const year=Number(yearText),month=Number(monthText),day=Number(dayText);
  const hour=Number(hourText),minute=Number(minuteText),second=Number(secondText);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const monthDays=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>monthDays[month-1]||hour>23||minute>59||second>59) {
    ctx.addIssue({code:"custom",message:"invalid-canonical-timestamp"});
  }
});
export const amountSchema = z.object({tokens:safeInteger,activeMs:safeInteger,attempts:safeInteger,sessions:safeInteger}).strict();
export const budgetAmountSchema = amountSchema.extend({tokens:safeInteger.nullable()}).strict();
export const tokenPolicySchema = z.object({authoredTokenCeiling:safeInteger.nullable(),bindingCauses:z.array(z.enum(["task","group","spend-cap"])),inheritedUsage:amountSchema}).strict();
export const finiteGrantSchema = z.object({work:amountSchema,handoff:amountSchema}).strict();
export const grantSchema = z.object({work:budgetAmountSchema,handoff:amountSchema}).strict();
export const commandSchema = z.object({commandId:idSchema,expectedRevision:safeInteger,by:z.string().trim().min(1)}).strict();
export const commandEnvelopeSchema = z.object({
  commandId:idSchema,
  expectedRevision:safeInteger,
  payload:z.custom<unknown>((value)=>value!==undefined,{message:"payload-required"}),
}).strict();
export const groupSchema = z.object({groupId:idSchema,projectKey:z.string().trim().min(1),goal:z.string().trim().min(1),successConditions:z.array(z.string().trim().min(1)).min(1),budgetMode:z.enum(["strict","soft"]).default("strict"),limit:budgetAmountSchema,reviewReserve:amountSchema,deadlineAt:z.string().datetime({offset:true}).nullable()}).strict();
// Agent selection spec §3 (`agent-selection-v1`): model and contextWindow are opaque to Orca (I2); ccloop's
// descriptor is the only judge of what a kind can express, so these check shape only.
export const contextWindowSchema = z.union([z.literal("agent-default"),z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]);
export const agentSelectionSchema = z.object({agent:idSchema,model:z.string().min(1).max(200),contextWindow:contextWindowSchema}).strict();
export const partialSelectionSchema = z.object({agent:idSchema.optional(),model:z.string().min(1).max(200).optional(),contextWindow:contextWindowSchema.optional()}).strict();
// Ruling review R7 (human ruling 2026-09-27): a panel layer's field is absent (inherit), a value (override), or null
// (as if the plan had not written that field at this level; see agentSelection.ts levelLayers).
export const panelPartialSelectionSchema = z.object({agent:idSchema.nullable().optional(),model:z.string().min(1).max(200).nullable().optional(),contextWindow:contextWindowSchema.nullable().optional()}).strict();
export const workSchema = z.object({workItemId:idSchema,taskId:idSchema.nullable(),kind:z.enum(["task","decompose","reconcile","handoff","goal-review","memory"]),dependsOn:z.array(idSchema),contract:z.unknown(),configHash:z.string().min(1),agent:agentSelectionSchema,grant:grantSchema,parentRunId:idSchema.optional()}).strict().superRefine((value,ctx)=>{
  if(value.kind!=="task"&&value.grant.work.tokens===null)ctx.addIssue({code:"custom",message:"finite-auxiliary-grant-required"});
  if ((value.kind === "handoff") !== (value.parentRunId !== undefined)) ctx.addIssue({code:"custom",message:"handoff-parent-required"});
});

export const artifactSchema=z.object({artifactId:idSchema,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const inputCheckpointSchema=z.object({predecessorRunId:idSchema,checkpointId:idSchema,checkpointHash:z.string().regex(/^[a-f0-9]{64}$/),bundlePath:z.string().min(1)}).strict();
export const handoffRequestSchema=z.object({protocol:z.literal(1),requestId:idSchema,runId:idSchema,generation:safeInteger.positive(),reason:z.enum(["budget","context","human","graph-change","shutdown"]),deadlineAt:z.string().datetime({offset:true})}).strict();
// Agent selection spec §4.6: the claim carries the complete, frozen selection (since StartEnvelopeV2); single-call
// estimate spec §4.1: StartEnvelopeV3 keeps that claim and tags work as a loop or a single call.
// Single-call estimate spec §4.1 (human ruling S7): start envelope protocol 3 only. `work` is a loop -- the four fields
// protocol 2 carried, now tagged -- or one single call whose prompt and response schema Orca assembled (spec §4.2).
// Syncskill integration spec §10.3 / §10.6: the run's skill snapshot directory, present only for a run with skills.
// ccloop priorFailures spec 2026-10-21 §2.1: the failures of earlier runs of the same task, 1..3 oldest first, bounded in
// UTF-8 bytes (not UTF-16 units: `.max` would admit what ccloop refuses). Absent keeps the envelope's bytes and hash.
const utf8Bounded=(max:number)=>z.string().min(1).refine(text=>Buffer.byteLength(text,"utf8")<=max,{message:`over-${max}-utf8-bytes`});
export const PRIOR_FAILURE_BOUNDS={entries:3,rejectCategory:200,failingCommand:4096,evidenceEntries:16,evidenceEntry:4096,failureCause:64} as const;
export const priorFailureSchema=z.object({runId:idSchema,rejectCategory:utf8Bounded(PRIOR_FAILURE_BOUNDS.rejectCategory),failingCommand:utf8Bounded(PRIOR_FAILURE_BOUNDS.failingCommand).nullable(),evidence:z.array(utf8Bounded(PRIOR_FAILURE_BOUNDS.evidenceEntry)).min(1).max(PRIOR_FAILURE_BOUNDS.evidenceEntries).nullable(),failureCause:utf8Bounded(PRIOR_FAILURE_BOUNDS.failureCause).optional()}).strict();
export type PriorFailure=z.infer<typeof priorFailureSchema>;
// Live transcript spec 2026-10-23 §10.2.6 (ccloop f4de340 src/control/protocol.ts): the person's note for plan and execute,
// text 1-4096 UTF-8 bytes. Optional and never defaulted, so an envelope without it keeps its exact bytes and hash.
export const operatorNoteSchema=z.object({text:utf8Bounded(4096),scope:z.enum(["next-attempt","remaining-attempts"])}).strict();
export type OperatorNote=z.infer<typeof operatorNoteSchema>;
// Multi-directory projects spec §7.1 / §11.1: the written directories beyond the primary, in the contract's order. Absent
// for every single-repository envelope, so its bytes and hash are unchanged.
const additionalRepoKeySchema=z.string().regex(/^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_])?$/);
const additionalRepoWorkSchema=z.object({key:additionalRepoKeySchema,targetRepo:z.string().min(1),base:z.string().min(1)}).strict();
const loopWorkSchema=z.object({kind:z.literal("loop"),contract:z.unknown(),targetRepo:z.string().min(1),base:z.string().min(1),sourceDir:z.string().min(1),skillPluginDir:z.string().min(1).optional(),codexSkillsDir:z.string().min(1).optional(),ompSkillsDir:z.string().min(1).optional(),priorFailures:z.array(priorFailureSchema).min(1).max(PRIOR_FAILURE_BOUNDS.entries).optional(),operatorNote:operatorNoteSchema.optional(),additionalRepos:z.array(additionalRepoWorkSchema).min(1).max(7).optional()}).strict();
const singleCallWorkSchema=z.object({kind:z.literal("single-call"),prompt:z.string().min(1),responseSchema:z.record(z.unknown()).refine(schema=>schema.type==="object",{message:"response-schema-not-object"}),maxOutputTokens:safeInteger.positive(),sourceDir:z.string().min(1)}).strict();
export const startEnvelopeSchema=z.object({protocol:z.union([z.literal(3),z.literal(4)]),mode:z.literal("verify-saved-result").optional(),savedResultRecovery:z.object({packagePath:z.string().min(1),packageHash:z.string().regex(/^[a-f0-9]{64}$/),admissionHash:z.string().regex(/^[a-f0-9]{64}$/),recoveryOf:recoveryOfSchema}).strict().optional(),tokenPolicy:tokenPolicySchema.optional(),claim:z.object({groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,commandId:idSchema,configHash:z.string().min(1),agent:agentSelectionSchema,grant:grantSchema,ownerToken:idSchema}).strict(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),inputCheckpoint:inputCheckpointSchema.nullable(),work:z.discriminatedUnion("kind",[loopWorkSchema,singleCallWorkSchema])}).strict().superRefine((value,ctx)=>{
  if((value.mode!==undefined)!==(value.savedResultRecovery!==undefined)||value.mode!==undefined&&(value.protocol!==4||value.inputCheckpoint!==null||value.work.kind!=="loop"))ctx.addIssue({code:"custom",message:"invalid-saved-result-mode"});
  if(value.protocol===3&&(value.tokenPolicy!==undefined||value.claim.grant.work.tokens===null))ctx.addIssue({code:"custom",message:"token-policy-requires-protocol4"});
  if(value.protocol===4&&(value.work.kind!=="loop"||value.claim.grant.work.sessions===0))ctx.addIssue({code:"custom",message:"invalid-token-policy-work"});
  // ccloop priorFailures spec §2.1: a saved-result recovery re-verifies a saved result and builds no prompt.
  if(value.mode!==undefined&&value.work.kind==="loop"&&value.work.priorFailures!==undefined)ctx.addIssue({code:"custom",path:["work","priorFailures"],message:"prior-failures-with-saved-result"});
  // ccloop f4de340 (live transcript spec §10.2.6): nor an operator note, for the same reason.
  if(value.mode!==undefined&&value.work.kind==="loop"&&value.work.operatorNote!==undefined)ctx.addIssue({code:"custom",path:["work","operatorNote"],message:"operator-note-with-saved-result"});
  if(value.work.kind==="loop"&&[value.work.skillPluginDir,value.work.codexSkillsDir,value.work.ompSkillsDir].filter(dir=>dir!==undefined).length>1)ctx.addIssue({code:"custom",path:["work","codexSkillsDir"],message:"skills-directories-mutually-exclusive"});
  // Multi-directory projects spec §7.1: the work entry names exactly the contract's extra directories, in its order --
  // absent on both sides, or present on both with the same keys.
  if(value.work.kind==="loop"){
    const repos=value.work.additionalRepos,context=(value.work.contract as {context?:{additionalRepos?:unknown}}|null|undefined)?.context;
    const contractKeys=Array.isArray(context?.additionalRepos)?context.additionalRepos.map(entry=>typeof (entry as {key?:unknown}).key==="string"?(entry as {key:string}).key:null):null;
    if(repos!==undefined){
      if(new Set(repos.map(repo=>repo.key)).size!==repos.length)ctx.addIssue({code:"custom",path:["work","additionalRepos"],message:"duplicate-additional-repo-key"});
      if(contractKeys===null||contractKeys.join("\0")!==repos.map(repo=>repo.key).join("\0"))ctx.addIssue({code:"custom",path:["work","additionalRepos"],message:"additional-repos-contract-mismatch"});
    }
    else if(contractKeys!==null&&contractKeys.length>0)ctx.addIssue({code:"custom",path:["work","additionalRepos"],message:"additional-repos-contract-mismatch"});
  }
  // A single call is never resumed (spec §6.5): an interrupted estimate is re-estimated, not continued.
  if(value.work.kind==="single-call"&&value.inputCheckpoint!==null)ctx.addIssue({code:"custom",path:["inputCheckpoint"],message:"single-call-input-checkpoint"});
});
export const candidateSchema=z.object({
 groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,
 checkpointId:idSchema,usageHighWater:safeInteger,result:z.enum(["complete","partial","failed"]),artifacts:z.array(artifactSchema),snapshot:artifactSchema.nullable(),
 missing:z.array(z.string()),unresolvedRequestIds:z.array(z.string()),terminalOutcome:z.string().min(1),
 stopProof:z.object({executionId:z.string().min(1),generation:safeInteger.positive(),isolated:z.literal(true),source:artifactSchema}).strict().nullable(),handoff:artifactSchema,
}).strict();
// Labels and progress spec §2.6 / §3.2 (§8 R17): ccloop's latest loop-state snapshot as collect answers it -- the status,
// every step and terminal included, the attempt numbers from that same snapshot, and when it last moved.
export const runProgressSchema=z.object({status:z.enum(["queued","planning","executing","verifying","succeeded","blocked_waiting_human","exhausted","cancelled","failed"]),currentAttempt:safeInteger,attemptsUsed:safeInteger,attemptsRemaining:safeInteger,lastTransitionAt:z.string().min(1)}).strict();
export type RunProgress=z.infer<typeof runProgressSchema>;
// Live transcript spec 2026-10-23 §10.2.4 (ccloop f4de340 src/control/command.ts): one agent call's transcript as collect
// lists it. Strict, so an entry of the wrong shape refuses the whole answer.
export const transcriptEntrySchema=z.object({attempt:safeInteger.positive(),phase:z.string().min(1),seq:safeInteger.positive(),path:z.string().min(1).nullable(),bytes:safeInteger,final:z.boolean(),truncatedAt:safeInteger.nullable()}).strict();
export type TranscriptEntry=z.infer<typeof transcriptEntrySchema>;
// Live transcript spec §12.3 / plan D1: the last listing a collect answered, kept on the run body.
export const transcriptListingSchema=z.object({sourceDir:z.string().min(1),entries:z.array(transcriptEntrySchema)}).strict();
export type TranscriptListing=z.infer<typeof transcriptListingSchema>;

/**
 * Failure-cause spec 2026-10-21 §3 (ccloop failure-causes spec §5): ccloop's run-level cause, as collect answers it and the
 * drive record keeps it (driveRecord.ts). `cause` is a bounded string, not a closed enum: a cause a newer ccloop adds reads
 * as itself, and the panel words one it does not know as unknown.
 */
export const runFailureCauseSchema = z.object({
  cause: z.string().min(1).max(64),
  phase: z.enum(["plan", "execute", "verify"]).nullable(),
  retries: safeInteger,
  detail: z.string().nullable(),
}).strict();
