import { z } from "zod";
export const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
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
export const grantSchema = z.object({work:amountSchema,handoff:amountSchema}).strict();
export const commandSchema = z.object({commandId:idSchema,expectedRevision:safeInteger,by:z.string().trim().min(1)}).strict();
export const commandEnvelopeSchema = z.object({
  commandId:idSchema,
  expectedRevision:safeInteger,
  payload:z.custom<unknown>((value)=>value!==undefined,{message:"payload-required"}),
}).strict();
export const groupSchema = z.object({groupId:idSchema,projectKey:z.string().trim().min(1),goal:z.string().trim().min(1),successConditions:z.array(z.string().trim().min(1)).min(1),budgetMode:z.enum(["strict","soft"]).default("strict"),limit:amountSchema,reviewReserve:amountSchema,deadlineAt:z.string().datetime({offset:true}).nullable()}).strict();
// Agent selection spec §3 (`agent-selection-v1`): model and contextWindow are opaque to Orca (I2); ccloop's
// descriptor is the only judge of what a kind can express, so these check shape only.
export const contextWindowSchema = z.union([z.literal("agent-default"),z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]);
export const agentSelectionSchema = z.object({agent:idSchema,model:z.string().min(1).max(200),contextWindow:contextWindowSchema}).strict();
export const partialSelectionSchema = z.object({agent:idSchema.optional(),model:z.string().min(1).max(200).optional(),contextWindow:contextWindowSchema.optional()}).strict();
// Ruling review R7 (human ruling 2026-09-27): a panel layer's field is absent (inherit), a value (override), or null
// (as if the plan had not written that field at this level; see agentSelection.ts levelLayers).
export const panelPartialSelectionSchema = z.object({agent:idSchema.nullable().optional(),model:z.string().min(1).max(200).nullable().optional(),contextWindow:contextWindowSchema.nullable().optional()}).strict();
export const workSchema = z.object({workItemId:idSchema,taskId:idSchema.nullable(),kind:z.enum(["task","decompose","reconcile","handoff","goal-review","memory"]),dependsOn:z.array(idSchema),contract:z.unknown(),configHash:z.string().min(1),agent:agentSelectionSchema,grant:grantSchema,parentRunId:idSchema.optional()}).strict().superRefine((value,ctx)=>{
  if ((value.kind === "handoff") !== (value.parentRunId !== undefined)) ctx.addIssue({code:"custom",message:"handoff-parent-required"});
});

export const artifactSchema=z.object({artifactId:idSchema,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const inputCheckpointSchema=z.object({predecessorRunId:idSchema,checkpointId:idSchema,checkpointHash:z.string().regex(/^[a-f0-9]{64}$/),bundlePath:z.string().min(1)}).strict();
export const handoffRequestSchema=z.object({protocol:z.literal(1),requestId:idSchema,runId:idSchema,generation:safeInteger.positive(),reason:z.enum(["budget","context","human","graph-change","shutdown"]),deadlineAt:z.string().datetime({offset:true})}).strict();
// Agent selection spec §4.6: the claim carries the complete, frozen selection (since StartEnvelopeV2); single-call
// estimate spec §4.1: StartEnvelopeV3 keeps that claim and tags work as a loop or a single call.
// Single-call estimate spec §4.1 (human ruling S7): start envelope protocol 3 only. `work` is a loop -- the four fields
// protocol 2 carried, now tagged -- or one single call whose prompt and response schema Orca assembled (spec §4.2).
const loopWorkSchema=z.object({kind:z.literal("loop"),contract:z.unknown(),targetRepo:z.string().min(1),base:z.string().min(1),sourceDir:z.string().min(1)}).strict();
const singleCallWorkSchema=z.object({kind:z.literal("single-call"),prompt:z.string().min(1),responseSchema:z.record(z.unknown()).refine(schema=>schema.type==="object",{message:"response-schema-not-object"}),maxOutputTokens:safeInteger.positive(),sourceDir:z.string().min(1)}).strict();
export const startEnvelopeSchema=z.object({protocol:z.literal(3),claim:z.object({groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,commandId:idSchema,configHash:z.string().min(1),agent:agentSelectionSchema,grant:grantSchema,ownerToken:idSchema}).strict(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),inputCheckpoint:inputCheckpointSchema.nullable(),work:z.discriminatedUnion("kind",[loopWorkSchema,singleCallWorkSchema])}).strict().superRefine((value,ctx)=>{
  // A single call is never resumed (spec §6.5): an interrupted estimate is re-estimated, not continued.
  if(value.work.kind==="single-call"&&value.inputCheckpoint!==null)ctx.addIssue({code:"custom",path:["inputCheckpoint"],message:"single-call-input-checkpoint"});
});
export const candidateSchema=z.object({
 groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,
 checkpointId:idSchema,usageHighWater:safeInteger,result:z.enum(["complete","partial","failed"]),artifacts:z.array(artifactSchema),snapshot:artifactSchema.nullable(),
 missing:z.array(z.string()),unresolvedRequestIds:z.array(z.string()),terminalOutcome:z.string().min(1),
 stopProof:z.object({executionId:z.string().min(1),generation:safeInteger.positive(),isolated:z.literal(true),source:artifactSchema}).strict().nullable(),handoff:artifactSchema,
}).strict();
