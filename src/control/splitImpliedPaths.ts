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

/**
 * Spec 2026-11-16 (#265): one path the split added to a task because its success condition names it. Tester #345:
 * `source: "goal"` marks a path added because the task's goal names it as a file the base commit does not have; such an
 * entry has no other writer (`writers` is empty). An entry without `source` is a success-condition addition, as before.
 */
export interface ImpliedPathAddition { taskId: string; path: string; writers: string[]; source?: "goal" }

/** Spec 2026-11-16: the line `requirement show` prints for a path the split added, and the serial edge it implies. */
export const impliedPathAddedLine = (entry: ImpliedPathAddition): string => entry.source === "goal"
  ? `implied-path-added: ${entry.taskId} now writes ${entry.path} (its goal names it, the base commit does not have it, and no task listed it)`
  : `implied-path-added: ${entry.taskId} now writes ${entry.path} (its success condition names it; ${entry.writers.join(", ")} also writes it, so they run serially)`;

/** Tester #345: a path a task's goal names that no task's targetPaths cover, and the split did not add. */
export interface GoalPathOutsideTargets { taskId: string; path: string }

/** Tester #345: the hint's one line, as `requirement show` prints it. */
export const goalPathLine = (entry: GoalPathOutsideTargets): string =>
  `goal-path-outside-targets: ${entry.taskId}'s goal names ${entry.path}, which no task may write`;

/**
 * Tester #345: a concrete file path in prose -- at least one directory part and an extension that starts with a letter
 * (`src/board/cli.js`, not `Node.js`, `e.g.` or `1.0/2.5`). Its boundaries are `mentions`'s: not inside a longer path or
 * word, and a sentence's closing `.` is not part of it, so a URL's path (`https://x.org/a.js`) never starts a token.
 * #345 review: nor does a `scheme:` or `node:` specifier's (`node:fs/promises.js`), and the extension is all lower or
 * all upper case, so a missing space in prose (`src/board.Then`) is not a path; a mixed-case one (`.Rmd`) is missed.
 */
const GOAL_PATH = /(?<![\w./:-])(?:[\w@.-]+\/)+[\w@.-]*\.(?:[a-z][a-z0-9]*|[A-Z][A-Z0-9]*)(?!\.?[\w/-])/g;
/** PATH_SHAPES: an exact path has no empty, `.` or `..` segment. */
const exactShape = (path: string): boolean => path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
/** As `covers`, and a target path's glob shapes (PATH_SHAPES): `**` covers every path, `<dir>/**` every path under `<dir>`. */
const coversShape = (target: string, path: string): boolean =>
  target === "**" || (target.endsWith("/**") && covers(target.slice(0, -3), path)) || covers(target, path);

/**
 * Tester #345 (Rule 5: code judges): each concrete file path a single-repository task's goal names, as a whole token,
 * that no task's targetPaths cover (exactly, under a listed directory, or by a `<dir>/**` or `**` glob). Unlike the
 * success-condition hint above it does not need some task to list the path: a goal often names the file it must create.
 * A path some task covers is left alone, since another task already holds it. Multi-directory drafts have none: a
 * goal's path does not say which directory it is in. In task order, then the order the paths appear in the goal.
 */
export function goalPathsOutsideTargets(output: SplitOutput | MultiSplitOutput): GoalPathOutsideTargets[] {
  const tasks = output.tasks as readonly Task[];
  if (tasks.some((task) => "writes" in task)) return [];
  const targets = tasks.flatMap((task) => targetsOf(task).map(normal));
  const out: GoalPathOutsideTargets[] = [];
  for (const task of tasks) {
    const named = [...new Set([...task.goal.matchAll(GOAL_PATH)].map((match) => match[0]))];
    for (const path of named) if (exactShape(path) && !targets.some((target) => coversShape(target, path))) out.push({ taskId: task.taskId, path });
  }
  return out;
}

/** Tester #345: at most this many distinct goal paths are looked up in the base commit per draft (one git read per parent directory). */
export const GOAL_PATH_PROBE_LIMIT = 64;

/** Tester #345: the distinct paths of `entries` to look up in the base commit, the first GOAL_PATH_PROBE_LIMIT of them. */
export const goalPathsToProbe = (entries: readonly GoalPathOutsideTargets[]): string[] =>
  [...new Set(entries.map((entry) => entry.path))].slice(0, GOAL_PATH_PROBE_LIMIT);

/**
 * Tester #345 (controller design, session 4389b15f; reversible): a task's goal is part of its authority as its success
 * condition is, so a goal path no task covers and `creatable` holds -- a new file whose nearest existing ancestor in the
 * base commit is a directory (requirementOverview.ts creatableAt; #351 follow-up: the directory may be new) -- is
 * added to that task's targetPaths and recorded with `source: "goal"`.
 * A path the base commit already has is not added: a goal often names a file it only reads, and widening a write set
 * serialises tasks that could run in parallel. It stays a hint (goalPathsOutsideTargets in the requirement view), as
 * does a path through an existing file (validation would refuse that target path: `path:`). #345 review
 * ruling: a path is added only when exactly one task's goal names it; when several do, which of them creates it is a
 * guess, and giving it to all serialises them, so each keeps a hint. Judged on the draft as given. Returns the same
 * object when nothing is added.
 */
export function applyGoalPaths(output: SplitOutput, creatable: ReadonlySet<string>): { output: SplitOutput; added: ImpliedPathAddition[] } {
  const all = goalPathsOutsideTargets(output);
  const naming = new Map<string, number>();
  for (const hint of all) naming.set(hint.path, (naming.get(hint.path) ?? 0) + 1);
  const hints = all.filter((hint) => naming.get(hint.path) === 1 && creatable.has(hint.path));
  if (hints.length === 0) return { output, added: [] };
  const copy = structuredClone(output);
  for (const hint of hints) copy.tasks.find((task) => task.taskId === hint.taskId)!.targetPaths.push(hint.path);
  return { output: copy, added: hints.map((hint) => ({ taskId: hint.taskId, path: hint.path, writers: [], source: "goal" as const })) };
}

