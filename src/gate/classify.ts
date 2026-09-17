// src/gate/classify.ts
import { basename, resolve } from "node:path";
import { parseShell, type SimpleCommand, type Word } from "./shell.js";

export type Action = "push" | "delete a branch" | "remove a worktree" | "outward gh write" | "merge into main" | "this command";
export type Verdict = { kind: "allow" } | { kind: "block"; action: Action; unclear?: string };
export type BranchOf = (absoluteDir: string) => Promise<string>;
type Block = Extract<Verdict, { kind: "block" }>;

const ALLOW: Verdict = { kind: "allow" };
const MAX_DEPTH = 8;
const SHELLS = new Set(["sh", "bash", "zsh"]);
const GLOB = /[*?[]/;
const GIT_FLAGS = new Set(["--no-pager", "-p", "-P", "--paginate", "--bare", "--no-replace-objects", "--no-optional-locks", "--literal-pathspecs"]);
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const GH_FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);

const block = (action: Exclude<Action, "this command">): Verdict => ({ kind: "block", action });
const unclear = (reason: string): Verdict => ({ kind: "block", action: "this command", unclear: reason });

/** Tier 0 gate spec 3.5. */
export function blockMessage(verdict: Block): string {
  const head = `orca gate: ${verdict.action} is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work.`;
  return verdict.unclear === undefined ? head : `${head} Could not decide: ${verdict.unclear}.`;
}

/** Tier 0 gate spec 3: what a Bash tool command would do to the four irreversible moves. */
export function classify(command: string, cwd: string, branchOf: BranchOf): Promise<Verdict> {
  return classifyText(command, cwd, branchOf, 0);
}

interface Context {
  cwd: string;
  branchOf: BranchOf;
  dir: string;
  dirProblem: string | null;
  headChanged: boolean;
  grouping: boolean;
}

async function classifyText(src: string, cwd: string, branchOf: BranchOf, depth: number): Promise<Verdict> {
  if (!/git|gh/.test(src)) return ALLOW;
  if (depth > MAX_DEPTH) return unclear(`nested more than ${MAX_DEPTH} levels deep`);
  const parsed = parseShell(src);
  if (parsed.problem !== null) return unclear(parsed.problem);
  for (const body of parsed.substitutions) {
    const v = await classifyText(body, cwd, branchOf, depth + 1);
    if (v.kind === "block") return v;
  }
  const ctx: Context = { cwd, branchOf, dir: cwd, dirProblem: null, headChanged: false, grouping: parsed.grouping };
  for (const cmd of parsed.commands) {
    const v = await classifyCommand(cmd, ctx, depth);
    if (v.kind === "block") return v;
  }
  return ALLOW;
}

async function classifyCommand(cmd: SimpleCommand, ctx: Context, depth: number): Promise<Verdict> {
  const words = cmd.words;
  const first = words[0]?.text;
  if (first === "cd") {
    const target = words[1];
    if (target === undefined || target.text === "-" || target.text.startsWith("~") || target.dynamic || GLOB.test(target.text)) {
      ctx.dirProblem = `cannot resolve the directory of ${words.map((w) => w.text).join(" ")}`;
    } else ctx.dir = resolve(ctx.dir, target.text);
    return ALLOW;
  }
  if (first === "pushd" || first === "popd") {
    ctx.dirProblem = `cannot resolve the directory of ${first}`;
    return ALLOW;
  }
  if (first !== undefined && SHELLS.has(basename(first)) && !words.some((w) => /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text))) {
    for (const heredoc of cmd.heredocs) {
      const v = await classifyText(heredoc.body, ctx.cwd, ctx.branchOf, depth + 1);
      if (v.kind === "block") return v;
    }
  }
  const assignments = new Set<string>();
  for (const w of words) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(w.text);
    if (m === null) break;
    assignments.add(m[1]);
  }
  for (let k = 0; k < words.length; k++) {
    const name = basename(words[k].text);
    if (words[k].dynamic) continue;
    if (SHELLS.has(name)) {
      const option = words.findIndex((w, j) => j > k && /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text));
      if (option >= 0 && words[option + 1] !== undefined) {
        const v = await classifyText(words[option + 1].text, ctx.cwd, ctx.branchOf, depth + 1);
        if (v.kind === "block") return v;
      }
    } else if (name === "eval") {
      const v = await classifyText(words.slice(k + 1).map((w) => w.text).join(" "), ctx.cwd, ctx.branchOf, depth + 1);
      if (v.kind === "block") return v;
    } else if (name === "git") {
      const v = await classifyGit(words.slice(k + 1), assignments, ctx);
      if (v.kind === "block") return v;
    } else if (name === "gh") {
      const v = classifyGh(words.slice(k + 1));
      if (v.kind === "block") return v;
    }
  }
  return ALLOW;
}

function shortLetters(args: Word[]): Set<string> {
  const letters = new Set<string>();
  for (const w of args) if (/^-[A-Za-z]+$/.test(w.text)) for (const c of w.text.slice(1)) letters.add(c);
  return letters;
}

async function classifyGit(args: Word[], assignments: Set<string>, ctx: Context): Promise<Verdict> {
  let i = 0;
  const cPaths: Word[] = [];
  let otherRepository = assignments.has("GIT_DIR") || assignments.has("GIT_WORK_TREE");
  while (i < args.length && args[i].text.startsWith("-")) {
    const t = args[i].text;
    if (GIT_VALUE_OPTIONS.has(t)) {
      if (t === "-C" && args[i + 1] !== undefined) cPaths.push(args[i + 1]);
      if (t === "--git-dir" || t === "--work-tree") otherRepository = true;
      i += 2;
    } else if (t.startsWith("--git-dir=") || t.startsWith("--work-tree=")) {
      otherRepository = true;
      i++;
    } else if (t.startsWith("--namespace=") || GIT_FLAGS.has(t)) i++;
    else return unclear(`unknown git option ${t} before the subcommand`);
  }
  if (i >= args.length) return ALLOW;
  if (args[i].dynamic) return unclear("the git subcommand is not a literal word");
  const sub = args[i].text;
  const rest = args.slice(i + 1);
  const dashdash = rest.findIndex((w) => w.text === "--");
  const beforeDashdash = dashdash < 0 ? rest : rest.slice(0, dashdash);
  const positionals = beforeDashdash.filter((w) => !w.text.startsWith("-")).map((w) => w.text);
  const letters = shortLetters(beforeDashdash);
  const longs = new Set(beforeDashdash.filter((w) => w.text.startsWith("--")).map((w) => w.text.split("=")[0]));

  const byBranch = async (): Promise<Verdict> => {
    if (ctx.headChanged) return unclear("an earlier git call in this command may have switched branches");
    if (otherRepository) return unclear("--git-dir, --work-tree, GIT_DIR or GIT_WORK_TREE names another repository");
    if (ctx.grouping) return unclear("the command has a subshell or a group");
    if (ctx.dirProblem !== null) return unclear(ctx.dirProblem);
    let dir = ctx.dir;
    for (const p of cPaths) {
      if (p.dynamic || p.text.startsWith("~") || GLOB.test(p.text)) return unclear(`cannot resolve the directory of -C ${p.text}`);
      dir = resolve(dir, p.text);
    }
    let branch: string;
    try {
      branch = await ctx.branchOf(dir);
    } catch (err) {
      return unclear(`cannot read the current branch of ${dir}: ${(err as Error).message}`);
    }
    return branch === "main" ? block("merge into main") : ALLOW;
  };

  switch (sub) {
    case "push":
      return block("push");
    case "branch":
      if (letters.has("d") || letters.has("D") || longs.has("--delete")) return block("delete a branch");
      if (["f", "M", "m", "C", "c"].some((l) => letters.has(l)) || longs.has("--force") || longs.has("--move") || longs.has("--copy")) {
        if (positionals.includes("main")) return block("merge into main");
      }
      return ALLOW;
    case "update-ref":
      if (letters.has("d") && positionals.some((p) => p.startsWith("refs/heads/"))) return block("delete a branch");
      if (positionals.some((p) => p === "refs/heads/main" || p === "main")) return block("merge into main");
      return ALLOW;
    case "worktree":
      return positionals[0] === "remove" || positionals[0] === "prune" ? block("remove a worktree") : ALLOW;
    case "checkout":
      if (letters.has("B") && positionals.includes("main")) return block("merge into main");
      ctx.headChanged = true;
      return ALLOW;
    case "switch":
      if ((letters.has("C") || longs.has("--force-create")) && positionals.includes("main")) return block("merge into main");
      ctx.headChanged = true;
      return ALLOW;
    case "fetch":
      return positionals.some((p) => ["main", "refs/heads/main"].includes(p.split(":")[1] ?? "")) ? block("merge into main") : ALLOW;
    case "rebase": {
      if (positionals[1] === "main") return block("merge into main");
      const v = await byBranch();
      if (positionals.length > 0) ctx.headChanged = true;
      return v;
    }
    case "merge":
    case "pull":
      return byBranch();
    case "reset": {
      const movesHead = !(positionals.length === 0 || (positionals.length === 1 && positionals[0] === "HEAD"));
      return movesHead ? byBranch() : ALLOW;
    }
    default:
      return ALLOW;
  }
}

function classifyGh(args: Word[]): Verdict {
  const texts = args.map((w) => w.text);
  const positionals: string[] = [];
  for (let j = 0; j < texts.length; j++) {
    const t = texts[j];
    if (t === "-R" || t === "--repo") j++;
    else if (t.startsWith("--repo=")) continue;
    else if (!t.startsWith("-")) positionals.push(t);
  }
  if (positionals[0] === "pr" && positionals[1] === "merge") return block("outward gh write");
  if (positionals[0] === "repo" && positionals[1] === "sync") return block("outward gh write");
  if (positionals[0] !== "api") return ALLOW;
  let method: string | undefined;
  texts.forEach((t, j) => {
    if (t === "-X" || t === "--method") method = texts[j + 1];
    else if (t.startsWith("--method=")) method = t.slice("--method=".length);
    else if (/^-X./.test(t)) method = t.slice(2);
  });
  if (method !== undefined) return method.toUpperCase() === "GET" ? ALLOW : block("outward gh write");
  const hasFields = texts.some((t) => GH_FIELD_FLAGS.has(t) || /^-[fF]./.test(t) || /^--(field|raw-field|input)=/.test(t));
  return hasFields ? block("outward gh write") : ALLOW;
}
