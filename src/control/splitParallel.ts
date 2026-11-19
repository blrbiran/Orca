import { buildGraph } from "../scheduler/graph.js";
import { intersect, type PathConflict } from "../scheduler/pathTrie.js";
import { qualifiedWriteSetOf, type ClaimedPath } from "../scheduler/writeSet.js";
import type { PlanFile } from "../scheduler/planFile.js";
import type { MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";

/**
 * Tester #384 (replacing #284's rule): a declared `dependsOn` edge that carries no order of its own -- the pair's write
 * sets overlap broadly, so code orders them whether or not the edge is declared (#268). Dropping the declaration keeps
 * the pair serial, so applying it cannot move a task in front of what it needs.
 */
export interface ParallelCandidate { before: string; after: string }
/** Tester #335: two tasks no declared dependency orders, which run one after the other because a broad claim overlaps. */
export interface OverlapSerialized { a: string; b: string; paths: string[] }

type Write = { dir: string; targetPaths: readonly string[]; checks: readonly string[] };
const writesOf = (task: SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]): readonly Write[] =>
  "writes" in task ? task.writes : [{ dir: "", targetPaths: task.targetPaths, checks: task.checks }];

/**
 * The conflicts of two write sets that make a pair's order code's, not a declaration's: one claim contains the other (a
 * directory claim such as `src/**` covering the other's file). Two tasks naming the same exact file are not one -- they
 * must take turns, and the direction of that turn is the author's -- as in `overlapSerialized`.
 */
function broadConflicts(a: readonly ClaimedPath[], b: readonly ClaimedPath[]): PathConflict[] {
  return intersect([...a], [...b]).filter((c) => !(c.kind === "equal" && !c.a.declared.endsWith("**") && c.a.declared === c.b.declared));
}

/** Whether `from` is an ancestor of `to` through the declared `dependsOn` edges (`skipDirect`: not by the edge from -> to). */
function declaredReach(byId: ReadonlyMap<string, { dependsOn: readonly string[] }>, from: string, to: string, skipDirect: boolean): boolean {
  const seen = new Set<string>(), stack = (byId.get(to)?.dependsOn ?? []).filter((id) => !skipDirect || id !== from);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.dependsOn ?? []));
  }
  return false;
}

/**
 * Tester #335 (Rule 5: code judges, and only hints): each pair of tasks no declared dependency orders (either way, through
 * any path) whose write sets intersect where at least one side claims more than the one file both name -- a directory
 * (`src/**`, `src/report`) containing the other's claim. The write-set rule (#268) orders such a pair, so an authored
 * diamond can run as a chain while every edge is implicit (apply-parallel cannot drop one); the person can narrow a claim
 * (requirement-draft-edit narrow-target-path). Two tasks naming the same file are not listed: they must take turns. `paths`
 * names each overlapping pair of claims as declared, `<a's> ∩ <b's>`. In task order.
 */
export function overlapSerialized(output: SplitOutput | MultiSplitOutput): OverlapSerialized[] {
  const tasks = output.tasks as ReadonlyArray<SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]>;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const claims = tasks.map((task) => qualifiedWriteSetOf(writesOf(task)));
  const out: OverlapSerialized[] = [];
  for (let i = 0; i < tasks.length; i += 1) for (let j = i + 1; j < tasks.length; j += 1) {
    const a = tasks[i]!.taskId, b = tasks[j]!.taskId;
    if (declaredReach(byId, a, b, false) || declaredReach(byId, b, a, false)) continue;
    const broad = broadConflicts(claims[i]!, claims[j]!);
    if (broad.length === 0) continue;
    // A one-repository claim is qualified `:<path>`; a multi-directory one keeps its `<dir>:` (writeSet.ts).
    const shown = (declared: string): string => (declared.startsWith(":") ? declared.slice(1) : declared);
    out.push({ a, b, paths: [...new Set(broad.map((c) => `${shown(c.a.declared)} ∩ ${shown(c.b.declared)}`))] });
  }
  return out;
}

/**
 * Tester #384 (Rule 5: code judges, and only hints): the declared edges that order a pair only through the write-set rule
 * (#268) -- the pair's claims overlap broadly, so dropping the declaration leaves code's own ordering in place. An edge
 * between tasks whose write sets are disjoint is a dependency the author declared for a reason code cannot see (an import,
 * a shared format); #284 listed those from prose, and a live policy draft got `T3 -> T4a/T4b` listed though the CLI
 * imports the engine, so `apply-parallel` would have started them before the engine existed. Declaration alone is never
 * evidence of "ordering only"; the overlap is. Also skipped: an edge another declared path already implies (dropping it
 * changes nothing) and an edge whose removal would reverse the pair -- an implicit edge is oriented along the plan's
 * topological order (#88, buildGraph), so a pair the order would turn around keeps its declaration (the check runs
 * buildGraph on the edited split exactly as the re-validation will). In task order, then dependency order.
 */
export function parallelCandidates(output: SplitOutput | MultiSplitOutput): ParallelCandidate[] {
  const tasks = output.tasks as ReadonlyArray<SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]>;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const claims = new Map(tasks.map((task) => [task.taskId, qualifiedWriteSetOf(writesOf(task))]));
  const out: ParallelCandidate[] = [];
  for (const after of tasks) for (const before of new Set(after.dependsOn)) {
    const written = claims.get(before);
    if (written === undefined || declaredReach(byId, before, after.taskId, true)) continue;
    if (broadConflicts(written, claims.get(after.taskId)!).length === 0) continue;
    if (!keepsOrder(tasks, claims, before, after.taskId)) continue;
    out.push({ before, after: after.taskId });
  }
  return out;
}

/**
 * Whether the pair is still ordered before -> after once the declaration is gone: layering the edited split, as the
 * re-validation lays it (buildGraph orients the implicit edge along the topological order of the remaining edges), puts
 * `before` in an earlier layer than `after`. A pair whose orientation the implicit edge would turn around is not listed.
 */
function keepsOrder(tasks: ReadonlyArray<{ taskId: string; dependsOn: readonly string[] }>, claims: ReadonlyMap<string, ClaimedPath[]>, before: string, after: string): boolean {
  const edited = { tasks: tasks.map((task) => ({ taskId: task.taskId, contract: task.taskId, dependsOn: task.taskId === after ? task.dependsOn.filter((id) => id !== before) : [...task.dependsOn] })) };
  const { layers } = buildGraph(edited as unknown as PlanFile, new Map(), claims as Map<string, ClaimedPath[]>);
  const layerOf = new Map(layers.flatMap((layer, index) => layer.map((id) => [id, index] as const)));
  return (layerOf.get(before) ?? -1) < (layerOf.get(after) ?? -1);
}
