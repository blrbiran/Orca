import type { DecisionEvent } from "../ledger/schema.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../scheduler/gitExec.js";
import type { DispatchedAs } from "./commandClient.js";
import { exitsZero, restoreWorkspace, runSetup, snapshotWorkspace, type WorkspaceSnapshot } from "./debugRepro.js";
import { gitChild, oneLine } from "./integrationGit.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Protect-acceptance-criteria spec 2026-10-21 §3-§4 (human: test changes are allowed; when the checks only pass because
 * they changed, or assertions were deleted or weakened, "可以先落地，不要block住，但是需要标红提醒人 review"; a change that
 * only adds tests: "不用提示"). Detection is code (Rule 5): the files that define the task's checks, what the attempt did
 * to them, and the weakening signals. Nothing here blocks or reverts; the landing writes a major `criteria` decision and
 * flags it (kanban spec §9a's flagged state). As-built §9: a `modified` change is re-run with the base versions of its
 * checks first (`runChecksAtBase`; passing there gives no notice), and a red flag is judged by Orca's reviewer
 * (criteriaReview.ts) before it is the person's.
 */
export type CriteriaChangeKind = "none" | "additive" | "modified" | "weakening";
export interface CriteriaChange { kind: CriteriaChangeKind; files: string[]; signals: string[] }

/** Test files by shape (spec §3.2's defaults; no repository's own test configuration is read in this version). */
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.[^/]+$/;
const WORKFLOW = /^\.github\/workflows\//;
/** An assertion call in JS/TS (and the common Python/Node `assert` forms); the count is per file, base vs attempt. */
const ASSERTION = /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(|\bassert\s+\S/g;
/** A test switched off or narrowed: skipped, focused or left as a todo. */
const SKIP = /\b(?:it|test|describe)\.(?:skip|only|todo)\b|\bx(?:it|describe|test)\s*\(|@pytest\.mark\.skip|\bt\.skip\s*\(/g;
/** A script that can no longer fail. */
const NO_OP = /^\s*(?:exit\s+0|true|:|echo(?:\s.*)?)\s*;?\s*$/;

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/** Paths run as check/setup code, not files merely read by a check (issue #198: `grep ... README.md`). */
const INTERPRETERS = new Set(["node", "nodejs", "bun", "deno", "tsx", "ts-node", "python", "python3", "ruby", "perl", "php", "bash", "sh", "zsh", "fish"]);
const WRAPPERS = new Set(["npx", "bunx"]);
const SHELLS = new Set(["bash", "sh", "zsh", "fish"]);
const CONFIG_FLAGS = new Set(["--config", "--config-file", "--project", "-p"]);
const INLINE_CODE = new Set(["-e", "--eval", "-p", "--print", "-c", "-lc", "-m"]);
const VALUE_OPTIONS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const sourceToken = (word: string): string => word.replace(/^['"]+|['"]+$/g, "").replace(/^\.\//, "");
const pathLike = (word: string): boolean => (word.includes("/") || /\.[A-Za-z0-9]+$/.test(word)) && !word.startsWith("-") && !word.includes("://");

/** Split only literal shell words and operators; never execute or expand a command. */
function commandSegments(command: string): string[][] {
  const segments: string[][] = [[]];
  let word = "", quote: "'" | '"' | null = null, escaped = false;
  const push = (): void => { if (word !== "") segments.at(-1)!.push(word); word = ""; };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (escaped) { word += char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote !== null) { if (char === quote) quote = null; else word += char; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/.test(char)) { push(); continue; }
    if (char === ";" || char === "|" || char === "&") {
      push();
      if (command[i + 1] === char) i += 1;
      if (segments.at(-1)!.length > 0) segments.push([]);
      continue;
    }
    word += char;
  }
  push();
  return segments.filter((segment) => segment.length > 0);
}

function scanCheckCommand(command: string, out: Set<string>, depth = 0): void {
  if (depth > 2) return;
  for (const words of commandSegments(command)) {
    let i = 0;
    while (ASSIGNMENT.test(words[i] ?? "")) i += 1;
    if (words[i] === "env") {
      i += 1;
      while (words[i]?.startsWith("-")) i += words[i] === "-u" || words[i] === "--unset" ? 2 : 1;
      while (ASSIGNMENT.test(words[i] ?? "")) i += 1;
    }
    let program = sourceToken(words[i] ?? "");
    if (WRAPPERS.has(program) || ((program === "npm" || program === "pnpm") && words[i + 1] === "exec")) {
      i += program === "npm" || program === "pnpm" ? 2 : 1;
      while (words[i]?.startsWith("-")) i += words[i] === "-p" || words[i] === "--package" ? 2 : 1;
      program = sourceToken(words[i] ?? "");
    }
    const basename = program.split("/").at(-1)!;
    if (program === "source" || program === ".") {
      const script = sourceToken(words[i + 1] ?? "");
      if (pathLike(script)) out.add(script);
    } else if (INTERPRETERS.has(basename)) {
      let j = i + 1;
      if ((basename === "bun" || basename === "deno") && words[j] === "run") j += 1;
      while (j < words.length) {
        const option = words[j]!;
        if (SHELLS.has(basename) && (option === "-c" || option === "-lc")) {
          scanCheckCommand(words[j + 1] ?? "", out, depth + 1);
          break;
        }
        if (INLINE_CODE.has(option)) break;
        if (VALUE_OPTIONS.has(option)) {
          const preload = sourceToken(words[j + 1] ?? "");
          if (pathLike(preload)) out.add(preload);
          j += 2;
          continue;
        }
        if (option === "--") { j += 1; continue; }
        if (option.startsWith("-")) { j += 1; continue; }
        const script = sourceToken(option);
        if (pathLike(script)) out.add(script);
        break;
      }
    } else if (pathLike(program)) out.add(program);
    for (let j = i + 1; j < words.length; j += 1) {
      if (!CONFIG_FLAGS.has(words[j - 1]!)) continue;
      if (words[j - 1] === "-p" && basename !== "tsc") continue;
      const config = sourceToken(words[j]!);
      if (pathLike(config)) out.add(config);
    }
  }
}

/** Task setup commands count too: their own script can change the meaning of the checks. */
export function checkPaths(requiredChecks: readonly string[], setupCommands: readonly string[] = []): Set<string> {
  const out = new Set<string>();
  for (const command of [...requiredChecks, ...setupCommands]) scanCheckCommand(command, out);
  return out;
}

/** §3: the check-defining files -- a required check's own file, a test file, `package.json`, a CI workflow. */
export function definesChecks(path: string, fromChecks: ReadonlySet<string>): boolean {
  return fromChecks.has(path) || TEST_PATH.test(path) || path === "package.json" || path.endsWith("/package.json") || WORKFLOW.test(path);
}

async function show(repo: string, rev: string, path: string): Promise<string> {
  return git(repo, [...QUIET_GIT, "show", `${rev}:${path}`]);
}

function scriptsOf(text: string): Record<string, string> {
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    return typeof scripts === "object" && scripts !== null ? Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  } catch { return {}; }
}

/**
 * §4.1: what the attempt (base..attempt) did to the files that define its checks. `additive` -- only new files or only
 * added lines, no new skip; `weakening` -- a deleted test or check file, fewer assertions, a new skip/only/todo, a
 * script removed or made a no-op; otherwise `modified`. A `package.json` whose `scripts` did not change does not count.
 */
export async function classifyCriteriaChange(repo: string, base: string, attempt: string, requiredChecks: readonly string[], setupCommands: readonly string[] = []): Promise<CriteriaChange> {
  const fromChecks = checkPaths(requiredChecks, setupCommands);
  const listed = (await git(repo, [...QUIET_GIT, "diff", "--no-renames", "--name-status", "-z", base, attempt])).split("\0").filter((part) => part !== "");
  const files: string[] = [], signals: string[] = [];
  let modified = false, additive = false;
  for (let i = 0; i + 1 < listed.length; i += 2) {
    const status = listed[i]!, path = listed[i + 1]!;
    if (!definesChecks(path, fromChecks)) continue;
    if (path === "package.json" || path.endsWith("/package.json")) {
      if (status === "A") continue; // a new package's scripts are new, not changed checks
      const before = scriptsOf(await show(repo, base, path)), after = status === "D" ? {} : scriptsOf(await show(repo, attempt, path));
      const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((name) => before[name] !== after[name]);
      if (names.length === 0) continue;
      files.push(path);
      for (const name of names) {
        if (before[name] !== undefined && after[name] === undefined) signals.push(`script-removed:${path}#${name}`);
        else if (after[name] !== undefined && NO_OP.test(after[name]!) && !(before[name] !== undefined && NO_OP.test(before[name]!))) signals.push(`script-no-op:${path}#${name}`);
        else if (before[name] !== undefined) modified = true;
        else additive = true;
      }
      continue;
    }
    files.push(path);
    if (status === "A") { additive = true; continue; }
    if (status === "D") { signals.push(`deleted:${path}`); continue; }
    const [before, after] = [await show(repo, base, path), await show(repo, attempt, path)];
    const assertions = [count(before, ASSERTION), count(after, ASSERTION)] as const;
    if (assertions[1] < assertions[0]) signals.push(`fewer-assertions:${path}:${assertions[0]}->${assertions[1]}`);
    if (count(after, SKIP) > count(before, SKIP)) signals.push(`skip-added:${path}`);
    const numstat = (await git(repo, [...QUIET_GIT, "diff", "--no-renames", "--numstat", base, attempt, "--", path])).trim().split("\t");
    if (Number(numstat[1] ?? 0) > 0 || numstat[1] === "-") modified = true; else additive = true;
  }
  const kind: CriteriaChangeKind = signals.length > 0 ? "weakening" : modified ? "modified" : additive ? "additive" : "none";
  return { kind, files, signals };
}

/** §4.3: what is flagged -- a weakening or a modification; additions and untouched checks give no notice. */
export const flagged = (change: CriteriaChange): boolean => change.kind === "weakening" || change.kind === "modified";

/** §4.3: the major `criteria` decision the landing writes in the run's own ledger (code-authored; flagged at landing). */
export function criteriaDecision(runId: string, groupId: string, base: string, change: CriteriaChange, at: string): DecisionEvent {
  const what = change.kind === "weakening" ? `weakened (${change.signals.join("; ")})`
    : change.signals.length > 0 ? `changed so that only the changed checks pass (${change.signals.join("; ")})` : "changed (not only added to)";
  return {
    ev: "decision", id: `${runId}/orca-criteria`, at, run: runId,
    question: `the attempt ${what} the files that define this task's checks: ${change.files.join(", ")}. May it land?`,
    chose: "land it and flag it for a person to review (protect-acceptance-criteria spec §4: never block)",
    alternatives: [{ option: "refuse the landing until a person looks", why_not: "the human ruled the change lands first and is flagged red for review, so no group waits on it" }],
    because: "a task that cannot make its checks pass could change the checks instead; whether the change was justified is judged by Orca's reviewer first when it is on (spec §5), else by a person",
    undo: { how: `restore ${change.files.join(", ")} from the run's base commit ${base} on orca/${groupId} and land that`, cost: "one task's checks", blast_radius: "the listed files" },
    scope: "task", kind: "criteria", importance: "major",
    evidence: [...change.signals, ...change.files.map((file) => `changed: ${file}`)].slice(0, 32),
  };
}

/**
 * §4.2: what the required checks did with the base versions of the changed check-defining files. Task setup spec
 * 2026-11-04 §4.6: a setup command that failed first is its own verdict, never a check's.
 */
export type CriteriaBaseVerdict = { kind: "base-passed" } | { kind: "base-failed"; command: string } | { kind: "base-setup-failed"; command: string };

async function gitOk(workdir: string, args: string[]): Promise<void> {
  const answer = await gitChild(workdir, args);
  if (answer.code !== 0) throw new Error(`criteria-base-git:${args[0]}: ${oneLine(answer.stderr)}`);
}

/**
 * §4.2 and §7a.1/§7a.4: in the run's own workspace at `attemptSha` (its dependencies are installed there), every changed
 * check-defining file goes back to its base version -- a `package.json` only in its `scripts` -- and the required checks
 * run as debugRepro.ts runs a command (`sh -lc`, inherited environment, each bounded by `timeoutMs`). A file the attempt
 * added stays (it has no base version). The workspace is restored to the snapshot whatever happens; a check that throws
 * (an abort) is rethrown after the restore. Failed and could-not-run give the same verdict (§7a.4: flag). Task setup
 * spec 2026-11-04 §4.6: the task's `setupCommands` run first (runSetup, each bounded by `timeoutMs`); one that fails is
 * `base-setup-failed` and no check runs.
 */
export async function runChecksAtBase(input: {
  workdir: string; base: string; attemptSha: string; files: readonly string[]; requiredChecks: readonly string[]; timeoutMs: number;
  snapshot?: WorkspaceSnapshot; signal?: AbortSignal;
  /** The run the checks run as (exitsZero; review I1). */
  as: DispatchedAs;
  /** The task's contract `context.setupCommands`, run before the checks. */
  setupCommands?: readonly string[];
}): Promise<CriteriaBaseVerdict> {
  const { workdir, base, attemptSha, timeoutMs, signal, as } = input;
  const snapshot = input.snapshot ?? await snapshotWorkspace(workdir, input.setupCommands);
  let verdict: CriteriaBaseVerdict = { kind: "base-passed" };
  try {
    for (const path of input.files) {
      if ((await gitChild(workdir, ["cat-file", "-e", `${base}:${path}`])).code !== 0) continue;
      if (path === "package.json" || path.endsWith("/package.json")) {
        const now = (await gitChild(workdir, ["cat-file", "-e", `${attemptSha}:${path}`])).code === 0 ? await show(workdir, attemptSha, path) : await show(workdir, base, path);
        const parsed = JSON.parse(now) as Record<string, unknown>;
        const before = (JSON.parse(await show(workdir, base, path)) as { scripts?: unknown }).scripts;
        if (before === undefined) delete parsed.scripts; else parsed.scripts = before;
        await writeFile(join(workdir, path), `${JSON.stringify(parsed, null, 2)}\n`);
        continue;
      }
      await gitOk(workdir, ["checkout", base, "--", `:(literal)${path}`]);
    }
    const setup = await runSetup(workdir, input.setupCommands ?? [], timeoutMs, as, signal);
    if (!setup.ok) verdict = { kind: "base-setup-failed", command: setup.command };
    else for (const command of input.requiredChecks) {
      if (!(await exitsZero(workdir, command, timeoutMs, as, signal))) { verdict = { kind: "base-failed", command }; break; }
    }
  } catch (error) {
    await restoreWorkspace(workdir, attemptSha, snapshot);
    throw error;
  }
  const restoreFailure = await restoreWorkspace(workdir, attemptSha, snapshot);
  if (restoreFailure !== null) throw restoreFailure;
  return verdict;
}
