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
export const workSchema = z.object({workItemId:idSchema,taskId:idSchema.nullable(),kind:z.enum(["task","decompose","reconcile","handoff","goal-review","memory"]),dependsOn:z.array(idSchema),contract:z.unknown(),configHash:z.string().min(1),grant:grantSchema,parentRunId:idSchema.optional()}).strict().superRefine((value,ctx)=>{
  if ((value.kind === "handoff") !== (value.parentRunId !== undefined)) ctx.addIssue({code:"custom",message:"handoff-parent-required"});
});

export const artifactSchema=z.object({artifactId:idSchema,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const inputCheckpointSchema=z.object({predecessorRunId:idSchema,checkpointId:idSchema,checkpointHash:z.string().regex(/^[a-f0-9]{64}$/),bundlePath:z.string().min(1)}).strict();
export const handoffRequestSchema=z.object({protocol:z.literal(1),requestId:idSchema,runId:idSchema,generation:safeInteger.positive(),reason:z.enum(["budget","context","human","graph-change","shutdown"]),deadlineAt:z.string().datetime({offset:true})}).strict();
export const startEnvelopeSchema=z.object({protocol:z.literal(1),claim:z.object({groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,commandId:idSchema,configHash:z.string().min(1),grant:grantSchema,ownerToken:idSchema}).strict(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),inputCheckpoint:inputCheckpointSchema.nullable(),work:z.object({contract:z.unknown(),targetRepo:z.string().min(1),base:z.string().min(1),sourceDir:z.string().min(1)}).strict()}).strict();
export const candidateSchema=z.object({
 groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,
 checkpointId:idSchema,usageHighWater:safeInteger,result:z.enum(["complete","partial","failed"]),artifacts:z.array(artifactSchema),snapshot:artifactSchema.nullable(),
 missing:z.array(z.string()),unresolvedRequestIds:z.array(z.string()),terminalOutcome:z.string().min(1),
 stopProof:z.object({executionId:z.string().min(1),generation:safeInteger.positive(),isolated:z.literal(true),source:artifactSchema}).strict().nullable(),handoff:artifactSchema,
}).strict();
