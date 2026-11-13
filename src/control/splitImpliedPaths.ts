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
 * that is exactly another task's targetPaths entry, while none of its own targetPaths covers it. Only paths some task
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
  const out: ImpliedPathOutsideTargets[] = [];
  for (const task of tasks) {
    const own = targetsOf(task).map(normal);
    for (const [path, owners] of writers) {
      if (owners.includes(task.taskId) || own.some((target) => covers(target, path)) || !mentions(task.successCondition, path)) continue;
      out.push({ taskId: task.taskId, path, writers: [...owners] });
    }
  }
  return out;
}

/** The warning's one line, as `requirement show` prints it. */
export const impliedPathLine = (entry: ImpliedPathOutsideTargets): string =>
  `implied-path-outside-targets: ${entry.taskId} mentions ${entry.path}, which only ${entry.writers.join(", ")} may write`;
