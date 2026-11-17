import { posix } from "node:path";
import { contains, intersect } from "../scheduler/pathTrie.js";
import { qualifiedWriteSetOf } from "../scheduler/writeSet.js";
import type { MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";

/** Tester #284: two tasks a declared `dependsOn` edge orders though, as far as code can tell, they could run at once. */
export interface ParallelCandidate { before: string; after: string }
/** Tester #335: two tasks no declared dependency orders, which run one after the other because a broad claim overlaps. */
export interface OverlapSerialized { a: string; b: string; paths: string[] }

type Write = { dir: string; targetPaths: readonly string[]; checks: readonly string[] };
const writesOf = (task: SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]): readonly Write[] =>
  "writes" in task ? task.writes : [{ dir: "", targetPaths: task.targetPaths, checks: task.checks }];

/** The paths a write's checks name, qualified as qualifiedWriteSetOf qualifies claims (split as testsOutsideScope splits). */
function checkPaths(write: Write): string[] {
  return write.checks.flatMap((check) => check.split(/&&|\|\||[;|\s]+/)).map((token) => token.replace(/^['"]+|['"]+$/g, ""))
    .filter((token) => token.length > 0).map((token) => `\0${write.dir}/${posix.normalize(token)}`);
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Tester follow-up K: the names a task's text may use for what `task` writes -- each claimed path (a `<dir>/**` claim as
 * its directory), that path without its extension, its last segment, that segment without its extension, and the
 * taskId -- with the directory (`writes[].dir`, "" for one repository) each path is in. A name of two characters or
 * fewer is not one (`a.ts` is not the article `a`).
 */
function namesOf(task: SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]): Array<{ dir: string | null; name: string }> {
  const names: Array<{ dir: string | null; name: string }> = [{ dir: null, name: task.taskId }];
  const bare = (text: string): string => text.replace(/\.[A-Za-z0-9]+$/, "");
  for (const write of writesOf(task)) for (const declared of write.targetPaths) {
    const path = posix.normalize(declared).replace(/\/\*\*$/, "").replace(/\/+$/, "");
    if (path === "**" || path === ".") continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    for (const candidate of new Set([path, bare(path), name, bare(name)])) names.push({ dir: write.dir, name: candidate });
  }
  return names.filter((entry) => entry.name.length > 2);
}
/** The text names `name` as a whole token, case-insensitively: not inside a longer word or path (`searching`, `search.js.bak`). */
const mentions = (text: string, name: string): boolean => new RegExp(`(?<![\\w-])${escaped(name)}(?![\\w-]|\\.\\w)`, "i").test(text);

/**
 * Tester #284 (Rule 5: code judges, and only hints): each declared edge `before -> after` (after.dependsOn names before)
 * that is the only thing ordering the pair -- no other dependency path leads from before to after -- while the two write
 * sets are disjoint, no check of `after` names a path `before` writes, and (tester follow-up K) `after`'s title, goal,
 * success condition and checks name none of `before`'s files nor `before` itself (namesOf): the follow-up I false
 * positive listed `search ∥ cli` though cli was to import search, which at split time only the cli task's words say. When
 * the words are unclear the edge is kept (not listed). Code cannot see that `after` builds on
 * `before`'s output in any other way, so this is a hint for a person or an orchestrating agent to send feedback on; it
 * never refuses a draft. In task order, then dependency order.
 */
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
    const conflicts = intersect(claims[i]!, claims[j]!);
    const broad = conflicts.filter((c) => !(c.kind === "equal" && !c.a.declared.endsWith("**") && c.a.declared === c.b.declared));
    if (broad.length === 0) continue;
    // A one-repository claim is qualified `:<path>`; a multi-directory one keeps its `<dir>:` (writeSet.ts).
    const shown = (declared: string): string => (declared.startsWith(":") ? declared.slice(1) : declared);
    out.push({ a, b, paths: [...new Set(broad.map((c) => `${shown(c.a.declared)} ∩ ${shown(c.b.declared)}`))] });
  }
  return out;
}

export function parallelCandidates(output: SplitOutput | MultiSplitOutput): ParallelCandidate[] {
  const tasks = output.tasks as ReadonlyArray<SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]>;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const claims = new Map(tasks.map((task) => [task.taskId, qualifiedWriteSetOf(writesOf(task))]));
  // Whether `from` is an ancestor of `to` without the direct edge from -> to.
  const reachesOtherwise = (from: string, to: string): boolean => declaredReach(byId, from, to, true);
  const out: ParallelCandidate[] = [];
  for (const after of tasks) for (const before of new Set(after.dependsOn)) {
    const written = claims.get(before);
    if (written === undefined || reachesOtherwise(before, after.taskId)) continue;
    if (intersect(written, claims.get(after.taskId)!).length > 0) continue;
    const read = writesOf(after).flatMap(checkPaths);
    if (read.some((path) => written.some((claim) => contains(claim.normalized, path)))) continue;
    // The prose has no directory, so any of before's names counts there; a check runs in its write's directory, so only
    // the names of before's paths in that directory (and before's taskId) count in it.
    const prose = [after.title, after.goal, after.successCondition].join("\n");
    const names = namesOf(byId.get(before)!);
    if (names.some((entry) => mentions(prose, entry.name))) continue;
    if (writesOf(after).some((write) => names.some((entry) => (entry.dir === null || entry.dir === write.dir) && write.checks.some((check) => mentions(check, entry.name))))) continue;
    out.push({ before, after: after.taskId });
  }
  return out;
}
