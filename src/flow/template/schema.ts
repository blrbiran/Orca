/**
 * Flow engine spec §3.1–§3.2: the `orca-flow-v1` template document. zod, `.strict()` at every level, so an unknown key
 * is refused (a typo is never silently ignored, R §6). Names here are frozen (§18); the two `budget` fields are the
 * plan's additions (top-level `budget.tokensPerRun`, step `budget.tokens`). Cross-references (ids, params, assets,
 * variables) are the static checklist's (checklist.ts), not the schema's.
 *
 * Phase-1 kinds only: `clarify`, `draft`, `work`, `check`, `review`, `ask`. A later kind (`effect`, `subflow`,
 * `software-change`, `foreach`, `wait`) is a schema error until its phase lands.
 */
import { z } from "zod";

export const FLOW_FORMAT = "orca-flow-v1";
export const PHASE1_KINDS = ["clarify", "draft", "work", "check", "review", "ask"] as const;
export type StepKind = (typeof PHASE1_KINDS)[number];
export const EFFECT_CLASSES = ["local", "cost", "external", "irreversible", "human-only"] as const;
export const EFFECT_LEVELS = ["apply-flag", "confirm", "stage-only"] as const;
/** Gaps spec §8.1: `image` is additive (a file path whose bytes are an image, copied into the run's store at start). */
export const PARAM_TYPES = ["text", "longtext", "enum", "bool", "int", "path", "slug", "image"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];
/** An ask's form takes a value typed by the person: no `image` (its bytes are read and stored only at start, §8.1). */
export const FORM_FIELD_TYPES = ["text", "longtext", "enum", "bool", "int", "path", "slug"] as const satisfies readonly ParamType[];

/** Step ids, check ids, template ids, param ids, role and effect names: one slug rule. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const slug = z.string().max(64).regex(SLUG, "must match [a-z0-9][a-z0-9-]*");
const IDENT = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const ident = z.string().max(64).regex(IDENT, "must match [a-zA-Z][a-zA-Z0-9_]*");
const text = z.string().min(1);
const scalar = z.union([z.string(), z.number(), z.boolean()]);

const paramSchema = z.object({
  type: z.enum(PARAM_TYPES),
  options: z.array(text).min(1).optional(),
  required: z.boolean().optional(),
  default: scalar.optional(),
  derive: z.enum(["slug-of-idea", "today"]).optional(),
}).strict().superRefine((param, ctx) => {
  if ((param.type === "enum") !== (param.options !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "options belong to (and only to) an enum param" });
});
export type FlowParam = z.infer<typeof paramSchema>;

export type WhenPredicate =
  | { param: string; equals: string | number | boolean }
  | { param: string; in: Array<string | number | boolean> }
  | { param: string; truthy: boolean }
  | { classification: { scope?: string; clarity?: string } }
  | { and: WhenPredicate[] }
  | { or: WhenPredicate[] }
  | { not: WhenPredicate };
export const whenSchema: z.ZodType<WhenPredicate> = z.lazy(() => z.union([
  z.object({ param: ident, equals: scalar }).strict(),
  z.object({ param: ident, in: z.array(scalar) }).strict(),
  z.object({ param: ident, truthy: z.boolean() }).strict(),
  z.object({ classification: z.object({ scope: text.optional(), clarity: text.optional() }).strict() }).strict(),
  z.object({ and: z.array(whenSchema) }).strict(),
  z.object({ or: z.array(whenSchema) }).strict(),
  z.object({ not: whenSchema }).strict(),
]));

const checkSchema = z.object({ id: slug.optional(), run: text, role: z.enum(["gate", "diagnostic"]) }).strict();
export type FlowCheck = z.infer<typeof checkSchema>;
const acceptanceSchema = z.object({ checks: z.array(checkSchema).min(1) }).strict();
const toolsSchema = z.object({
  commands: z.array(z.union([z.object({ exact: text }).strict(), z.object({ prefix: text }).strict()])).optional(),
  network: z.boolean().optional(),
  secrets: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "must be an environment variable name")).optional(),
}).strict();
export type FlowTools = z.infer<typeof toolsSchema>;
const loopSchema = z.object({
  until: z.union([z.object({ check: slug }).strict(), z.object({ verdict: z.literal("pass") }).strict()]),
  max: z.number().int().min(1),
}).strict();
const onFailureSchema = z.object({ retry: z.number().int().min(0), then: z.enum(["ask", "fail"]) }).strict();
const hintsSchema = z.object({ skipWhen: text.optional(), owns: z.array(text).optional(), equals: text.optional() }).strict();
const stepBudgetSchema = z.object({ tokens: z.number().int().positive() }).strict();

/** Fields every kind may carry (§3.2); kind-specific ones are added per kind below. */
const common = {
  id: slug,
  role: slug.optional(),
  executor: z.enum(["agent", "person", "either"]).optional(),
  when: whenSchema.optional(),
  parallelWith: slug.optional(),
  hints: hintsSchema.optional(),
  budget: stepBudgetSchema.optional(),
};
/** A step that runs an agent or a single call with a template prompt. */
const prompted = {
  skills: z.array(text).optional(),
  prompt: text,
  vars: z.record(text).optional(),
};
const effectFields = { effect: slug.optional(), recommendedLevel: z.enum(EFFECT_LEVELS).optional() };

const clarifyStep = z.object({
  ...common, kind: z.literal("clarify"),
  mode: z.enum(["auto", "interactive"]).optional(),
  background: text.optional(), focus: text.optional(), sections: z.array(text).optional(),
}).strict();
const draftStep = z.object({ ...common, ...prompted, kind: z.literal("draft") }).strict();
const workStep = z.object({
  ...common, ...prompted, ...effectFields, kind: z.literal("work"),
  tools: toolsSchema.optional(), acceptance: acceptanceSchema.optional(), loop: loopSchema.optional(), onFailure: onFailureSchema.optional(),
}).strict();
const checkStep = z.object({ ...common, kind: z.literal("check"), acceptance: acceptanceSchema, tools: toolsSchema.optional() }).strict();
const reviewStep = z.object({
  ...common, kind: z.literal("review"),
  reviews: slug, rubric: text.optional(), prompt: text.optional(), skills: z.array(text).optional(), vars: z.record(text).optional(),
  maxRounds: z.number().int().min(1).optional(), loop: loopSchema.optional(),
}).strict();
const formFieldSchema = z.object({
  type: z.enum(FORM_FIELD_TYPES), options: z.array(text).min(1).optional(), required: z.boolean().optional(), default: scalar.optional(),
}).strict();
const askStep = z.object({
  ...common, kind: z.literal("ask"),
  prompt: text.optional(),
  form: z.record(ident, formFieldSchema),
  candidatesFrom: z.object({ step: slug, name: ident }).strict().optional(),
  policy: z.enum(["confirm-before", "review-after"]).optional(),
  writeTo: z.union([z.object({ file: text, frontmatter: text }).strict(), z.object({ file: text, json: text }).strict()]).optional(),
}).strict();

export const flowStepSchema = z.discriminatedUnion("kind", [clarifyStep, draftStep, workStep, checkStep, reviewStep, askStep]);
export type FlowStep = z.infer<typeof flowStepSchema>;

export const flowTemplateSchema = z.object({
  format: z.literal(FLOW_FORMAT),
  id: slug,
  version: z.number().int().positive().optional(),
  title: z.object({ en: text.optional(), zh: text.optional() }).strict().optional(),
  base: text.optional(),
  params: z.record(ident, paramSchema).optional(),
  workspace: z.object({ kind: z.enum(["dir", "repo"]), excludes: z.array(text).optional() }).strict(),
  roles: z.record(slug, z.object({
    tier: z.enum(["low", "mid", "high"]),
    suggest: z.object({ agent: text.optional(), model: text.optional() }).strict().optional(),
    distinctFrom: slug.optional(),
  }).strict()).optional(),
  requires: z.object({
    skills: z.array(z.object({
      source: text, ref: z.string().regex(/^[0-9a-f]{40}$/, "must be a 40-hex commit"), path: text, skills: z.array(text).min(1),
    }).strict()).optional(),
    commands: z.array(z.object({ name: text, check: text }).strict()).optional(),
  }).strict().optional(),
  effects: z.record(slug, z.object({ class: z.enum(EFFECT_CLASSES) }).strict()).optional(),
  budget: z.object({ tokensPerRun: z.number().int().positive() }).strict().optional(),
  steps: z.array(flowStepSchema).min(1),
}).strict();
export type FlowTemplate = z.infer<typeof flowTemplateSchema>;
