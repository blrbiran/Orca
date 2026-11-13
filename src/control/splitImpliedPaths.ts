import { posix } from "node:path";
import type { MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";

/**
 * Tester #265: a task whose success condition names a file only another task may write. The run then writes it (the
 * condition asks for it) and stops on `allowlist miss`; the README of dogfood-20261111-4 cost 8.9M tokens that way.
 */
export interface ImpliedPathOutsideTargets { taskId: string; path: string; writers: string[] }

type Task = SplitOutput["tasks"][number] | MultiSplitOutput["tasks"][number];
const targetsOf = (task: Task): readonly string[] =>
  "writes" in task ? task.writes.flatMap((write) => write.targetPaths) : task.targetPaths;
const normal = (path: string): string => posix.normalize(path).replace(/\/+$/, "");
/** A target that is a path, not a bare word: it has a directory part or an extension (`README.md`, `src/cli.js`). */
const pathLike = (path: string): boolean => path !== "." && (path.includes("/") || /\.[A-Za-z0-9]+$/.test(path));
const covers = (target: string, path: string): boolean => target === path || target === "." || path.startsWith(`${target}/`);
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The text names the path as a whole token: not inside a longer path or word (`README.md.bak`, `docs/README.md`). */
const mentions = (text: string, path: string): boolean => new RegExp(`(?<![\\w./-])${escaped(path)}(?!\\.?[\\w/-])`).test(text);

/**
 * Tester #265 (Rule 5: code judges, and only hints): each task whose successCondition names, as a whole token, a path
 * that is exactly another task's targetPaths entry (or, tester follow-up K, that path's bare document name when no other
 * listed path shares it), while none of its own targetPaths covers it. Only paths some task
 * lists count, so a prose word is never taken for a file. Multi-directory writes are compared by path alone. It never
 * refuses a draft. In task order, then the order the paths first appear in the tasks.
 */
export function impliedPathsOutsideTargets(output: SplitOutput | MultiSplitOutput): ImpliedPathOutsideTargets[] {
  const tasks = output.tasks as readonly Task[];
  const writers = new Map<string, string[]>();
  for (const task of tasks) for (const target of targetsOf(task).map(normal).filter(pathLike)) {
    const list = writers.get(target) ?? [];
    if (!list.includes(task.taskId)) list.push(task.taskId);
    writers.set(target, list);
  }
  // Tester follow-up K: a document's bare name (`README` for README.md: upper case, its extension dropped) names the one
  // listed path that has it; a name two listed paths share names neither.
  const bareOf = (path: string): string | null => {
    const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.[A-Za-z0-9]+$/, "");
    return /^[A-Z][A-Z0-9_-]{2,}$/.test(name) ? name : null;
  };
  const bareCount = new Map<string, number>();
  for (const path of writers.keys()) { const bare = bareOf(path); if (bare !== null) bareCount.set(bare, (bareCount.get(bare) ?? 0) + 1); }
  const named = (text: string, path: string): boolean => {
    if (mentions(text, path)) return true;
    const bare = bareOf(path);
    return bare !== null && bareCount.get(bare) === 1 && mentions(text, bare);
  };
  const out: ImpliedPathOutsideTargets[] = [];
  for (const task of tasks) {
    const own = targetsOf(task).map(normal);
    for (const [path, owners] of writers) {
      if (owners.includes(task.taskId) || own.some((target) => covers(target, path)) || !named(task.successCondition, path)) continue;
      out.push({ taskId: task.taskId, path, writers: [...owners] });
    }
  }
  return out;
}

/** The warning's one line, as `requirement show` prints it. */
export const impliedPathLine = (entry: ImpliedPathOutsideTargets): string =>
  `implied-path-outside-targets: ${entry.taskId} mentions ${entry.path}, which only ${entry.writers.join(", ")} may write`;
