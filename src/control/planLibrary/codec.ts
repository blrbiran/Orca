/**
 * Scheduled flows and groups spec 2026-10-24 §5.2: `orca-plan-v1`, the plan library's document. It is a scheduler plan
 * file without the repository-bound fields and with each contract inline; a loop task keeps its recipe and is expanded at
 * import, with the project's path. Stored as canonical bytes, named by their sha256, at most 2 MiB.
 *
 * Every source (a group, a requirement split, an imported file) goes through `canonicalPlanDoc`, which runs the import's
 * own checks (contract shape and task id, loop expansion, normalizeControlPlan's graph checks) before anything is stored,
 * so the library never holds a plan that cannot be imported (refusal `control-plan-rejected` with today's item codes).
 */
import { z } from "zod";
import { canonicalBytes, sha256Canonical } from "../canonicalJson.js";
import { ControlError } from "../errors.js";
import { inputLabelsSchema } from "../labels.js";
import { expandLoopPlan, loopRecipeSchema, type LoopRecipe } from "../loopPlans.js";
import { normalizeControlPlan } from "../planImport.js";
import { idSchema, partialSelectionSchema, safeInteger } from "../schema.js";
import type { ControlPlanV1 } from "../webProtocol.js";
import { taskContractSchema, type SchedulerControlPlanSource } from "../../scheduler/planFile.js";

export const PLAN_DOC_SCHEMA = "orca-plan-v1" as const;
/** §5.2 (writer's call): the canonical bytes' ceiling. */
export const PLAN_DOC_MAX_BYTES = 2 * 1024 * 1024;

const planDocTaskSchema = z.object({
  taskId: idSchema,
  dependsOn: z.array(idSchema),
  targetVersion: safeInteger.positive(),
  agent: partialSelectionSchema.optional(),
  labels: inputLabelsSchema.optional(),
  // Checked against taskContractSchema and its objective.taskId below (item contract-shape:<taskId>), as a plan file's.
  contract: z.record(z.unknown()).optional(),
  loop: loopRecipeSchema.optional(),
}).strict().superRefine((task, ctx) => {
  if ((task.contract === undefined) === (task.loop === undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly-one-of-contract-or-loop" });
});

export const planDocSchema = z.object({
  schema: z.literal(PLAN_DOC_SCHEMA),
  goal: z.string().min(1).max(2000),
  successConditions: z.array(z.string().min(1)).min(1).max(20),
  agent: partialSelectionSchema.optional(),
  reconcileAgent: partialSelectionSchema.optional(),
  tasks: z.array(planDocTaskSchema).min(1).max(200),
}).strict();

export type PlanDoc = z.infer<typeof planDocSchema>;
export interface CanonicalPlanDoc { doc: PlanDoc; bytes: string; sha256: string; source: SchedulerControlPlanSource }

/** Spec 2026-10-08 §2.2(b)'s item list: one refusal, one item per line (a line break inside an item written as `\n`). */
function rejectItems(items: readonly string[]): never {
  throw new ControlError("control-plan-rejected", items.map((item) => item.replace(/\r/g, "\\r").replace(/\n/g, "\\n")).join("\n"));
}

/**
 * The plan source an import builds from a document (§5.2): each contract parsed by taskContractSchema with its task id,
 * each loop recipe expanded with `repoPath` at its plan's current version (as a plan file's loop task is). Every task's
 * item is collected before refusing.
 */
export function sourceOfDoc(doc: PlanDoc, repoPath: string): SchedulerControlPlanSource {
  const items: string[] = [];
  if (new Set(doc.successConditions).size !== doc.successConditions.length) items.push("duplicate-success-condition");
  const tasks: SchedulerControlPlanSource["tasks"] = [];
  for (const task of doc.tasks) {
    let original: { value: unknown; canonicalJson: string; hash: string; recipe?: LoopRecipe };
    if (task.loop !== undefined) {
      const { planId, inputs, chosenBy, skills } = task.loop;
      const expanded = expandLoopPlan(task.taskId, repoPath, planId, inputs, chosenBy, skills);
      if (!expanded.ok) { items.push(`loop-plan-invalid:${task.taskId}:${expanded.reason}`); continue; }
      original = { value: expanded.contract, canonicalJson: expanded.canonicalJson, hash: expanded.hash, recipe: expanded.recipe };
    } else {
      const parsed = taskContractSchema.safeParse(task.contract);
      if (!parsed.success || parsed.data.objective.taskId !== task.taskId) { items.push(`contract-shape:${task.taskId}`); continue; }
      original = { value: parsed.data, canonicalJson: canonicalBytes(parsed.data).toString("utf8"), hash: sha256Canonical(parsed.data) };
    }
    tasks.push({
      taskId: task.taskId, dependencyTaskIds: [...task.dependsOn], targetVersion: task.targetVersion,
      ...(task.agent ? { agent: task.agent } : {}),
      ...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),
      ...(original.recipe ? { loop: original.recipe } : {}),
      originalContract: original.value, originalContractCanonicalJson: original.canonicalJson, originalContractHash: original.hash,
    });
  }
  if (items.length > 0) return rejectItems(items);
  return {
    goal: doc.goal, successConditions: [...doc.successConditions],
    ...(doc.agent ? { agent: doc.agent } : {}), ...(doc.reconcileAgent ? { reconcileAgent: doc.reconcileAgent } : {}),
    tasks,
  };
}

/**
 * The one door into the library (§5.3, "every source runs the same validation as an import before anything is stored"):
 * the strict schema, every task's contract or loop, normalizeControlPlan's graph checks, then the canonical bytes and the
 * 2 MiB ceiling. A contract is stored as taskContractSchema parsed it, so the bytes are what an import reads back.
 */
export function canonicalPlanDoc(raw: unknown, repoPath: string): CanonicalPlanDoc {
  const parsed = planDocSchema.safeParse(raw);
  if (!parsed.success) return rejectItems(parsed.error.issues.map((issue) => `malformed:${issue.path.join(".") || "<root>"}: ${issue.message}`));
  const source = sourceOfDoc(parsed.data, repoPath);
  // The graph checks (duplicate task, duplicate or dangling dependency, cycle) and the archive schema's own.
  normalizeControlPlan({ ...source, repoId: "plan-library", planId: "plan-library" });
  const contracts = new Map(source.tasks.map((task) => [task.taskId, task.originalContract]));
  const doc: PlanDoc = {
    ...parsed.data,
    tasks: parsed.data.tasks.map((task) => (task.loop !== undefined ? task : { ...task, contract: contracts.get(task.taskId) as Record<string, unknown> })),
  };
  const bytes = canonicalBytes(doc);
  if (bytes.length > PLAN_DOC_MAX_BYTES) throw new ControlError("plan-library-doc-too-large", `${bytes.length} bytes > ${PLAN_DOC_MAX_BYTES}`);
  return { doc, bytes: bytes.toString("utf8"), sha256: sha256Canonical(doc), source };
}

/** §5.3 source (b): a group's archived plan as a document -- a loop task's recipe (not its expansion), else its contract. */
export function docFromArchivedPlan(plan: ControlPlanV1): unknown {
  return {
    schema: PLAN_DOC_SCHEMA, goal: plan.goal, successConditions: [...plan.successConditions],
    ...(plan.agent ? { agent: plan.agent } : {}), ...(plan.reconcileAgent ? { reconcileAgent: plan.reconcileAgent } : {}),
    tasks: plan.tasks.map((task) => ({
      taskId: task.taskId, dependsOn: [...task.dependencyTaskIds], targetVersion: task.targetVersion,
      ...(task.agent ? { agent: task.agent } : {}), ...(task.labels ? { labels: [...task.labels] } : {}),
      ...(task.loop ? { loop: task.loop } : { contract: JSON.parse(task.originalContractCanonicalJson) as unknown }),
    })),
  };
}

/** §5.3 source (a): a plan source (a requirement split's stored plan, read by schedulerControlPlanSourceOf) as a document. */
export function docFromSource(source: SchedulerControlPlanSource): unknown {
  return {
    schema: PLAN_DOC_SCHEMA, goal: source.goal, successConditions: [...source.successConditions],
    ...(source.agent ? { agent: source.agent } : {}), ...(source.reconcileAgent ? { reconcileAgent: source.reconcileAgent } : {}),
    tasks: source.tasks.map((task) => ({
      taskId: task.taskId, dependsOn: [...task.dependencyTaskIds], targetVersion: task.targetVersion,
      ...(task.agent ? { agent: task.agent } : {}), ...(task.labels ? { labels: [...task.labels] } : {}),
      ...(task.loop ? { loop: task.loop } : { contract: task.originalContract }),
    })),
  };
}
