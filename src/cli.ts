import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkAppendOnly } from "./ledger/appendOnly.js";
import { validateFile } from "./ledger/validateFile.js";
import { buildGraph } from "./scheduler/graph.js";
import { loadPlan } from "./scheduler/planFile.js";
import { emptyRequiredChecksPairs, renderPlanReport } from "./scheduler/planReport.js";
import { preflight } from "./scheduler/preflight.js";

const execFileAsync = promisify(execFile);

const USAGE = `usage:
  orca validate <path...>        validate ledger file(s) or directory (directory scans top-level *.jsonl only)
  orca check-append-only         read a git diff from stdin, reject if it contains any deleted line
  orca plan <path> [--verbose]   print the plan's write sets, conflicts, and layering; execute nothing
`;

async function collectLedgerFiles(paths: string[]): Promise<{ files: string[]; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];

  for (const path of paths) {
    let info;
    try {
      info = await stat(path);
    } catch {
      errors.push(`cannot stat: ${path}`);
      continue;
    }
    if (info.isDirectory()) {
      // Top-level only: spec §3.0 says .decisions/ has no subdirectories, and
      // §3.7.1's archive/ should not be scanned by default.
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(path, entry.name));
        }
      }
    } else {
      files.push(path);
    }
  }

  return { files, errors };
}

async function runValidate(paths: string[]): Promise<number> {
  if (paths.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  const { files, errors } = await collectLedgerFiles(paths);
  for (const error of errors) {
    process.stderr.write(`${error}\n`);
  }

  let sawRejected = errors.length > 0;
  let sawDowngraded = false;

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const verdict = validateFile(text.split("\n"));

    for (const line of verdict.lines) {
      if (line.result.verdict === "rejected") {
        process.stderr.write(`${file}:${line.lineNumber}: rejected: ${line.result.reasons.join("; ")}\n`);
      } else if (line.result.verdict === "downgraded") {
        process.stderr.write(
          `${file}:${line.lineNumber}: downgraded to tier 0: ${line.result.reasons.join("; ")}\n`,
        );
      }
    }

    if (verdict.verdict === "rejected") sawRejected = true;
    if (verdict.verdict === "downgraded") sawDowngraded = true;
  }

  if (sawRejected) return 1;
  if (sawDowngraded) return 2;

  // An empty green is the cardinal sin here (CLAUDE.md Rule 9): validating
  // zero files is not the same claim as validating N files and finding them
  // all fine. Fail loud rather than print "ok" for a check that checked
  // nothing — chosen over rewording the line because a non-zero exit is what
  // CI actually keys off of; a human-only wording fix would still let a
  // silently-empty scan pass a script that gates on exit code.
  if (files.length === 0) {
    process.stderr.write("error: 0 ledger files found — nothing was validated\n");
    return 1;
  }

  process.stdout.write(`ok: ${files.length} ledger file(s)\n`);
  return 0;
}

// Spec §9.2: `plan` reads the target repo's currently checked-out branch
// name to compare against workBranch (loadPlan's work-branch-is-default
// rejection needs it), but never mutates it — `git symbolic-ref` with no
// second argument is a read. A repo with nothing checked out (bare, or a
// fresh --bare clone) has no default to compare against; falling back to ""
// rather than throwing lets every other check still run and get reported,
// instead of a caller fixing exceptions one at a time.
async function resolveDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: repoPath });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function runPlan(args: string[]): Promise<number> {
  const verbose = args.includes("--verbose");
  const planPath = args.find((a) => !a.startsWith("--"));
  if (!planPath) {
    process.stderr.write(USAGE);
    return 1;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(planPath, "utf8"));
  } catch (err) {
    process.stderr.write(`cannot read plan file ${planPath}: ${(err as Error).message}\n`);
    return 1;
  }

  const rawTargetRepo = (raw as { targetRepo?: unknown } | null)?.targetRepo;
  const targetRepo = typeof rawTargetRepo === "string" ? rawTargetRepo : "";
  const defaultBranch = targetRepo ? await resolveDefaultBranch(targetRepo) : "";

  const result = loadPlan(raw, defaultBranch);
  if ("rejections" in result) {
    for (const r of result.rejections) {
      process.stderr.write(`rejected: ${r.code}: ${r.message}\n`);
    }
    return 1;
  }
  const { plan } = result;

  // buildGraph's contracts map is the already-loaded contract per task, not
  // a path to go read one (graph.ts's own doc comment on that parameter) —
  // reading each task's contract file here, in the CLI, is exactly the seam
  // that keeps that layer pure. loadPlan's contract-inside-target-repo
  // rejection guarantees every contract path lives outside targetRepo, so
  // this is not a read against the repo either.
  const contracts = new Map<string, unknown>();
  for (const task of plan.tasks) {
    contracts.set(task.taskId, JSON.parse(await readFile(task.contract, "utf8")));
  }

  const g = buildGraph(plan, contracts);

  // Fix round 1, finding 2: the requiredChecks-union escalation warning
  // (spec §5.3 / §9.1(6)) does not need to wait for a later task — the
  // contracts map above is exactly what it needs, already in hand. Attached
  // onto `g` rather than threaded as a fifth parameter, since PlanGraphExtras
  // is already the seam renderPlanReport reads it from.
  const annotatedGraph = { ...g, emptyRequiredChecksPairs: emptyRequiredChecksPairs(g, contracts) };

  // Ruling 3 (Task 6): the real runtime preflight (work branch already
  // exists, base not a real commit, target worktree dirty) reads a ref and
  // porcelain output against the target repo — spec §9.1(4) says explicitly
  // that reading those does not count as "touching" it, which is what lets
  // `plan` (spec §9.2: zero side effects) call this and print real verdicts
  // instead of a permanent "not evaluated".
  const preflightReport = await preflight(plan, defaultBranch);

  process.stdout.write(
    renderPlanReport(annotatedGraph, plan, preflightReport, { verbose, runtimeChecksEvaluated: true }),
  );
  process.stdout.write("\n");
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(argv: string[], stdinText?: string): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "validate") {
    return runValidate(rest);
  }

  if (command === "plan") {
    return runPlan(rest);
  }

  if (command === "check-append-only") {
    const diffText = stdinText ?? (await readStdin());
    const result = checkAppendOnly(diffText);
    if (result.ok) {
      process.stdout.write("ok: append-only\n");
      return 0;
    }
    for (const reason of result.reasons) {
      process.stderr.write(`${reason}\n`);
    }
    return 1;
  }

  process.stderr.write(USAGE);
  return 1;
}

// Only runs when invoked directly as `tsx src/cli.ts`. Not executed on import.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
