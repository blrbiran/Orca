import { z } from "zod";
export const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const amountSchema = z.object({tokens:safeInteger,activeMs:safeInteger,attempts:safeInteger,sessions:safeInteger}).strict();
export const grantSchema = z.object({work:amountSchema,handoff:amountSchema}).strict();
export const commandSchema = z.object({commandId:idSchema,expectedRevision:safeInteger,by:z.string().trim().min(1)}).strict();
export const groupSchema = z.object({groupId:idSchema,projectKey:z.string().trim().min(1),goal:z.string().trim().min(1),successConditions:z.array(z.string().trim().min(1)).min(1),budgetMode:z.enum(["strict","soft"]).default("strict"),limit:amountSchema,reviewReserve:amountSchema,deadlineAt:z.string().datetime({offset:true}).nullable()}).strict();
export const workSchema = z.object({workItemId:idSchema,taskId:idSchema.nullable(),kind:z.enum(["task","decompose","reconcile","handoff","goal-review","memory"]),dependsOn:z.array(idSchema),contract:z.unknown(),configHash:z.string().min(1),grant:grantSchema,parentRunId:idSchema.optional()}).strict().superRefine((value,ctx)=>{
  if ((value.kind === "handoff") !== (value.parentRunId !== undefined)) ctx.addIssue({code:"custom",message:"handoff-parent-required"});
});

export const artifactSchema=z.object({artifactId:idSchema,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const candidateSchema=z.object({
 groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,
 checkpointId:idSchema,usageHighWater:safeInteger,result:z.enum(["complete","partial","failed"]),artifacts:z.array(artifactSchema),snapshot:artifactSchema.nullable(),
 missing:z.array(z.string()),unresolvedRequestIds:z.array(z.string()),terminalOutcome:z.string().min(1),
 stopProof:z.object({executionId:z.string().min(1),generation:safeInteger.positive(),isolated:z.literal(true),source:artifactSchema}).strict().nullable(),
});

export const capabilitiesSchema=z.object({protocol:z.literal(1),durableAccept:z.boolean(),ownershipIsolation:z.boolean(),evidenceRetention:z.boolean(),
 usageObservation:z.enum(["realtime","phase-end","unavailable"]),budgetEnforcement:z.enum(["bounded","soft","unsupported"]),requestBoundEvidence:z.string().trim().min(1).nullable()}).strict();
