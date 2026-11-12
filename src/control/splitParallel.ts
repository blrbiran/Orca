import { posix } from "node:path";
import { contains, intersect } from "../scheduler/pathTrie.js";
import { qualifiedWriteSetOf } from "../scheduler/writeSet.js";
import type { MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";

/** Tester #284: two tasks a declared `dependsOn` edge orders though, as far as code can tell, they could run at once. */
export interface ParallelCandidate { before: string; after: string }

type Write = { dir: string; targetPaths: readonly string[]; checks: readonly string[] };
const writesOf = (task: SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]): readonly Write[] =>
  "writes" in task ? task.writes : [{ dir: "", targetPaths: task.targetPaths, checks: task.checks }];

/** The paths a write's checks name, qualified as qualifiedWriteSetOf qualifies claims (split as testsOutsideScope splits). */
function checkPaths(write: Write): string[] {
  return write.checks.flatMap((check) => check.split(/&&|\|\||[;|\s]+/)).map((token) => token.replace(/^['"]+|['"]+$/g, ""))
    .filter((token) => token.length > 0).map((token) => `\0${write.dir}/${posix.normalize(token)}`);
}

/**
 * Tester #284 (Rule 5: code judges, and only hints): each declared edge `before -> after` (after.dependsOn names before)
 * that is the only thing ordering the pair -- no other dependency path leads from before to after -- while the two write
 * sets are disjoint and no check of `after` names a path `before` writes. Code cannot see that `after` builds on
 * `before`'s output in any other way, so this is a hint for a person or an orchestrating agent to send feedback on; it
 * never refuses a draft. In task order, then dependency order.
 */
export function parallelCandidates(output: SplitOutput | MultiSplitOutput): ParallelCandidate[] {
  const tasks = output.tasks as ReadonlyArray<SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number]>;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const claims = new Map(tasks.map((task) => [task.taskId, qualifiedWriteSetOf(writesOf(task))]));
  // Whether `from` is an ancestor of `to` without the direct edge from -> to.
  const reachesOtherwise = (from: string, to: string): boolean => {
    const seen = new Set<string>(), stack = (byId.get(to)?.dependsOn ?? []).filter((id) => id !== from);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === from) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(byId.get(id)?.dependsOn ?? []));
    }
    return false;
  };
  const out: ParallelCandidate[] = [];
  for (const after of tasks) for (const before of new Set(after.dependsOn)) {
    const written = claims.get(before);
    if (written === undefined || reachesOtherwise(before, after.taskId)) continue;
    if (intersect(written, claims.get(after.taskId)!).length > 0) continue;
    const read = writesOf(after).flatMap(checkPaths);
    if (read.some((path) => written.some((claim) => contains(claim.normalized, path)))) continue;
    out.push({ before, after: after.taskId });
  }
  return out;
}
