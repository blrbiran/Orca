import { z } from "zod";
import { amountSchema, canonicalTimestampSchema, idSchema, safeInteger } from "./schema.js";
import type { Amount } from "./types.js";

/** N1 spec §4.2, §5.2, §7, §8 and H4/H7: the requirement's records, as pure zod. No store, no webProtocol import. */
export const ROUND_STATES = ["drafting", "awaiting-answers", "answered", "interrupted", "failed"] as const;
export const DRAFT_STATES = ["drafting", "awaiting-review", "accepted", "rejected", "invalid", "interrupted", "failed"] as const;
export const MAX_AUTO_RETRIES = 2;
export const MAX_QUESTIONS = 5;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+){0,7}$/;
export const IDEA_MAX_BYTES = 32 * 1024;
export const REQUIREMENT_LIMIT_DEFAULT: Amount = Object.freeze({ tokens: 10_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40 });
export const REQUIREMENT_CALL_GRANT: Amount = Object.freeze({ tokens: 1_000_000, activeMs: 1_200_000, attempts: 1, sessions: 1 });

const nonempty = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const positive = safeInteger.positive();
const retries = z.number().int().min(0).max(MAX_AUTO_RETRIES);

export const questionIdSchema = z.string().regex(/^R[1-9]\d*\.Q[1-9]\d*$/);
export const questionSchema = z.object({ id: questionIdSchema, key: nonempty, question: nonempty, recommendedAnswer: nonempty, why: nonempty, dependsOn: z.array(nonempty) }).strict();
export const criterionSchema = z.object({ id: nonempty, text: nonempty }).strict();
export const glossaryEntrySchema = z.object({ id: z.string().regex(/^R[1-9]\d*\.G[1-9]\d*$/), term: nonempty, definition: nonempty }).strict();
export const adrSchema = z.object({ id: z.string().regex(/^R[1-9]\d*\.ADR[1-9]\d*$/), title: nonempty, context: nonempty, decision: nonempty, consequences: nonempty }).strict();
/** A round's classified output (spec §7.3): ids assigned by code, the slug decided by code. */
export const clarifyResultSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN).nullable(), statement: nonempty, acceptanceCriteria: z.array(criterionSchema),
  questions: z.array(questionSchema).max(MAX_QUESTIONS), frontierEmpty: z.boolean(), openBranches: z.array(nonempty),
  glossary: z.array(glossaryEntrySchema), adrs: z.array(adrSchema),
}).strict();
/** One call of a round or draft (spec §4.2 "the run ids and usage of the round's calls, the overview hash and commit"). */
export const callRecordSchema = z.object({
  runId: idSchema, overviewHash: hash.nullable(), commit: commit.nullable(), usage: amountSchema.nullable(),
  outcome: z.enum(["valid", "invalid", "failed", "interrupted"]), reason: z.string().nullable(),
}).strict();
export const answerSchema = z.object({ id: questionIdSchema, kind: z.enum(["recommended", "text"]), text: nonempty }).strict();
export const decisionSchema = z.object({ id: nonempty, accept: z.boolean() }).strict();
export const roundBodySchema = z.object({
  roundNo: positive, state: z.enum(ROUND_STATES), retries, lastInvalidReason: z.string().nullable(),
  waiting: z.literal("requirement-budget-exhausted").nullable(), result: clarifyResultSchema.nullable(),
  answers: z.array(answerSchema).nullable(), glossaryDecisions: z.array(decisionSchema).nullable(), adrDecisions: z.array(decisionSchema).nullable(),
  answeredAt: canonicalTimestampSchema.nullable(), closedByConsensus: z.boolean(),
  reasonCode: z.literal("clarify-output-invalid").nullable(), calls: z.array(callRecordSchema),
}).strict();

/** Spec §8.1: one task of a split, as the model writes it (validated in code, requirementSplit.ts). */
export const splitTaskSchema = z.object({
  taskId: nonempty, title: nonempty, labels: z.array(z.string()), loopPlan: nonempty.optional(), goal: nonempty, successCondition: nonempty,
  targetPaths: z.array(nonempty).min(1), checks: z.array(nonempty).min(1), dependsOn: z.array(nonempty), traces: z.array(nonempty),
}).strict();
export const splitOutputSchema = z.object({ tasks: z.array(splitTaskSchema).min(1), notes: z.string() }).strict();
/** Spec §8.4: an implicit edge, with the write-set conflict behind it (graph.ts buildGraph). */
export const implicitEdgeSchema = z.object({ from: nonempty, to: nonempty, conflicts: z.array(z.object({ a: nonempty, b: nonempty }).strict()).min(1) }).strict();
export const draftBodySchema = z.object({
  draftNo: positive, state: z.enum(DRAFT_STATES), autoRetry: retries, waiting: z.literal("requirement-budget-exhausted").nullable(),
  feedback: z.string().nullable(), output: splitOutputSchema.nullable(), plan: z.record(z.unknown()).nullable(), draftHash: hash.nullable(),
  reasons: z.array(nonempty), layers: z.array(z.array(nonempty)).nullable(), implicitEdges: z.array(implicitEdgeSchema).nullable(),
  reasonCode: z.enum(["split-output-invalid", "split-validation-exhausted"]).nullable(), calls: z.array(callRecordSchema),
}).strict();
export const requirementExportSchema = z.object({
  state: z.enum(["not-due", "pending", "done", "conflict"]), path: z.string().nullable(), commit: commit.nullable(), parent: commit.nullable(), detail: z.string().nullable(),
}).strict();

export type RoundBody = z.infer<typeof roundBodySchema>;
export type DraftBody = z.infer<typeof draftBodySchema>;
export type ClarifyResult = z.infer<typeof clarifyResultSchema>;
export type SplitOutput = z.infer<typeof splitOutputSchema>;
export type CallRecord = z.infer<typeof callRecordSchema>;
export type RequirementExport = z.infer<typeof requirementExportSchema>;
