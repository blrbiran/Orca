import { budgetEstimateSchema, budgetEstimateTaskSchema } from "./webProtocol.js";

/** Rationales (trimmed, lower-cased) that mean "the model filled the slot without answering". The only judgement in repair. */
export const PLACEHOLDER_RATIONALES: readonly string[] = ["placeholder", "todo", "tbd", "x", "n/a", "...", "-"];

export interface RepairContext { planHash: string; taskIds: readonly string[]; instructionVersion: string }
export type RepairResult = { ok: true; output: unknown; repairs: string[] } | { ok: false; problems: string[] };

const MAX_PROBLEMS = 20, MAX_PROBLEM_CHARS = 200;

/** First 20 problems, each cut to 200 characters. */
export function capProblems(problems: readonly string[]): string[] {
  return problems.slice(0, MAX_PROBLEMS).map(problem => problem.slice(0, MAX_PROBLEM_CHARS));
}

/** The classifier's refusal as problem codes; never empty. */
export function problemsFromRefusal(issues: readonly { path: (string | number)[]; message: string }[], notCanonical: boolean): string[] {
  const problems = issues.map(issue => `field-invalid:${issue.path.join(".")}:${issue.message}`);
  if (notCanonical) problems.push("output-not-canonical");
  return capProblems(problems);
}

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const sameStrings = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const isPlaceholder = (entry: Obj) => typeof entry.rationale === "string" && PLACEHOLDER_RATIONALES.includes(entry.rationale.trim().toLowerCase());

/** Zod issue paths as problem suffixes; an unrecognized-keys issue (empty path) is named by its keys. */
function issuePaths(issues: readonly { path: (string | number)[]; code: string; keys?: string[] }[]): string[] {
  return issues.flatMap(issue => issue.code === "unrecognized_keys" && issue.keys ? issue.keys.map(key => [...issue.path, key].join(".")) : [issue.path.join(".")]);
}

/** Spec §4.2 steps 1-7, in order. Pure, collects every problem, never throws; the classifier still judges the output. */
export function repairEstimateOutput(raw: unknown, ctx: RepairContext): RepairResult {
  try {
    return repair(raw, ctx);
  } catch {
    return { ok: false, problems: ["not-an-object"] };
  }
}

function repair(raw: unknown, ctx: RepairContext): RepairResult {
  if (!isObject(raw)) return { ok: false, problems: ["not-an-object"] };
  const repairs: string[] = [], problems = new Set<string>();
  const planIds = new Set(ctx.taskIds);
  let top: Obj = { ...raw }, entries: unknown[] | null = null;

  // 1. v2 keyed answer -> v1 array, walking the plan's ids (never Object.keys order of the plan).
  if (ctx.instructionVersion === "2" && isObject(raw.tasks)) {
    const keyed = raw.tasks;
    entries = ctx.taskIds.filter(id => Object.hasOwn(keyed, id)).map(id => {
      const entry = keyed[id];
      return isObject(entry) ? { ...entry, taskId: id } : { taskId: id };
    });
    // Keys the plan does not have ride along as entries so step 5 drops (and reports) them.
    for (const key of Object.keys(keyed).sort()) {
      if (planIds.has(key)) continue;
      const entry = keyed[key];
      entries.push(isObject(entry) ? { ...entry, taskId: key } : { taskId: key });
    }
    top = { ...top, schema: "budget-estimate-v1", planHash: typeof raw.planHash === "string" ? raw.planHash : ctx.planHash };
    repairs.push("answer-v2-converted");
  } else if (Array.isArray(raw.tasks)) {
    entries = raw.tasks;
  } else {
    problems.add("field-invalid:tasks");
  }
  // 2-3. Name and hash: nothing the model could add.
  if (top.schema !== "budget-estimate-v1") { top.schema = "budget-estimate-v1"; repairs.push("schema-name-set"); }
  if (top.planHash !== ctx.planHash) { top.planHash = ctx.planHash; repairs.push("plan-hash-copied"); }

  let tasks: Obj[] = [];
  if (entries) {
    // Entries without a string taskId cannot be attributed to a task.
    const attributable: Obj[] = [];
    entries.forEach((entry, index) => {
      if (isObject(entry) && typeof entry.taskId === "string") attributable.push(entry);
      else problems.add(`field-invalid:tasks.${index}.taskId`);
    });
    // 4. Assumptions, in every entry, before any entry is chosen.
    const normalizedIds = new Set<string>();
    const normalized = attributable.map(entry => {
      if (!Array.isArray(entry.assumptions) || !entry.assumptions.every(v => typeof v === "string")) return entry;
      const cleaned = [...new Set((entry.assumptions as string[]).map(v => v.trim()).filter(v => v !== ""))];
      if (sameStrings(cleaned, entry.assumptions)) return entry;
      normalizedIds.add(entry.taskId as string);
      return { ...entry, assumptions: cleaned };
    });
    for (const id of ctx.taskIds) if (normalizedIds.has(id)) repairs.push(`assumptions-normalized:${id}`);
    // 5. Unknown tasks.
    const unknown = [...new Set(normalized.filter(e => !planIds.has(e.taskId as string)).map(e => e.taskId as string))].sort();
    for (const id of unknown) repairs.push(`unknown-task-dropped:${id}`);
    const known = normalized.filter(e => planIds.has(e.taskId as string));
    // 6. Duplicates: the first usable entry wins.
    const kept: Obj[] = [], keptIndex = new Map<string, number>();
    const duplicated: string[] = [];
    for (const id of ctx.taskIds) {
      const group = known.filter(e => e.taskId === id);
      if (group.length === 0) { problems.add(`task-missing:${id}`); continue; }
      const verdicts = group.map(entry => ({ entry, parsed: budgetEstimateTaskSchema.safeParse(entry) }));
      const usable = verdicts.find(v => v.parsed.success && !isPlaceholder(v.entry));
      if (usable) {
        keptIndex.set(id, kept.length); kept.push(usable.entry);
        if (group.length > 1) duplicated.push(id);
      } else if (verdicts.some(v => v.parsed.success)) {
        problems.add(`placeholder-entry:${id}`);
      } else {
        const failure = verdicts[0].parsed;
        if (!failure.success) for (const path of issuePaths(failure.error.issues)) problems.add(`task-invalid:${id}:${path}`);
      }
    }
    for (const id of duplicated) repairs.push(`duplicate-task-dropped:${id}`);
    // 7. Plan order. `kept` is already in plan order; compare it with the order the entries came in.
    const arrivalOrder = known.filter(e => kept.includes(e)).map(e => e.taskId);
    if (!sameStrings(arrivalOrder, kept.map(e => e.taskId))) repairs.push("tasks-reordered");
    tasks = kept;
    // Top-level fields: judged on the repaired shell with no tasks.
    const shell = budgetEstimateSchema.safeParse({ ...top, tasks: [] });
    if (!shell.success) for (const path of issuePaths(shell.error.issues)) problems.add(`field-invalid:${path}`);
  }
  if (problems.size > 0) return { ok: false, problems: capProblems([...problems].sort()) };
  return { ok: true, output: { ...top, tasks }, repairs };
}
