import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { correct } from "./corrections/correct.js";
import { correctionsDir } from "./corrections/paths.js";
import { collect } from "./metrics/collect.js";
import { computeMetrics } from "./metrics/compute.js";
import { renderJson, renderTable, renderTiming } from "./metrics/report.js";
import { MetricsRejection } from "./metrics/rejection.js";
import { CorrectRejection } from "./corrections/rejection.js";
import { checkAppendOnly } from "./ledger/appendOnly.js";
import { validateFile } from "./ledger/validateFile.js";
import { preflight } from "./scheduler/preflight.js";
import { loadRound, renderRound, runRound } from "./scheduler/run.js";

const USAGE = `usage:
  orca validate <path...>        validate ledger file(s) or directory (directory scans top-level *.jsonl only)
  orca check-append-only         read a git diff from stdin, reject if it contains any deleted line
  orca plan <path> [--verbose]   print the plan's write sets, conflicts, and layering; execute nothing
  orca run <path> --adapter-config <path> [--adapter scripted|claude] [--keep-workdirs] [--serial] [--verbose]
                                 print the same report, then run every task and land it on the work branch
                                 (--serial: spec §3.5 — turn parallelism off entirely; a v1 criterion, not
                                 a performance knob)
  orca correct --decision <run-id>/<n> --kind wrong|not_my_taste|stale --because <text>
               [--repo <path>] [--by <who>] [--again]
               [--chose-instead <text> --undo-how <text> [--undo-cost <text>] [--undo-blast-radius <text>]]
                                 record a human's correction; giving either closing argument means
                                 closing the loop, which also writes the two ledger rows and commits them
  orca correct --close <correctionId> --undo-how <text> [--repo <path>] [--chose-instead <text>]
                                 finish (or re-try) the closing half of a correction already recorded
  orca metrics [--root <dir>] [--repo <key>=<path>]... [--as-of <ISO8601>] [--json]
                                 read-only: the correction rate, the repair rate and the backlog.
                                 Writes nothing and takes no lock. --as-of filters the input set to
                                 what existed at that instant; without it, a row dated in the future
                                 is refused by name. Exit 6 means the report printed in full and some
                                 lines were malformed.
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

  // Two passes, not one. An overturned references the decision it overturns,
  // and that decision lives in the run that made it -- while the fix agent
  // overturning it is a later run writing a different file. Validating file by
  // file can never resolve that. The first pass collects every decision id in
  // whatever this invocation was pointed at; the second validates against it,
  // so "could not resolve" means precisely "not in what was scanned", and the
  // rejection message says so.
  const texts = new Map<string, string>();
  const allDecisionIds = new Set<string>();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    texts.set(file, text);
    for (const raw of text.split("\n")) {
      if (raw.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(raw) as { ev?: unknown; id?: unknown };
        if (parsed.ev === "decision" && typeof parsed.id === "string") allDecisionIds.add(parsed.id);
      } catch {
        // A line that does not parse is the second pass's problem, not this one's.
      }
    }
  }

  for (const file of files) {
    const text = texts.get(file) as string;
    const verdict = validateFile(text.split("\n"), { externalDecisionIds: allDecisionIds });

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

async function runPlan(args: string[]): Promise<number> {
  const verbose = args.includes("--verbose");
  const planPath = args.find((a) => !a.startsWith("--"));
  if (!planPath) {
    process.stderr.write(USAGE);
    return 1;
  }

  // spec §9.4: `plan` is not a sibling implementation of `run`'s front half,
  // it IS that front half — loadRound and renderRound are the same two calls
  // `orca run` makes before it spawns anything. Two implementations of "read
  // → validate → compute write sets → build the graph → layer it" would drift,
  // and the drift's direction is the worst one: the picture a person approved
  // stops being the graph that runs.
  const loaded = await loadRound(planPath);
  if ("rejections" in loaded) {
    for (const r of loaded.rejections) {
      process.stderr.write(`rejected: ${r.code}: ${r.message}\n`);
    }
    return 1;
  }
  const { round } = loaded;

  // Ruling 3 (Task 6): the real runtime preflight (work branch already
  // exists, base not a real commit, target worktree dirty) reads a ref and
  // porcelain output against the target repo — spec §9.1(4) says explicitly
  // that reading those does not count as "touching" it, which is what lets
  // `plan` (spec §9.2: zero side effects) call this and print real verdicts
  // instead of a permanent "not evaluated".
  const preflightReport = await preflight(round.plan, round.baseBranch);

  process.stdout.write(`${renderRound(round, preflightReport, verbose)}\n`);

  // spec §9.3 (final review, Important 2): `plan` answers "is this plan legal
  // and how would it run". §4.2's three runtime checks are up-front
  // REJECTIONS, and §9.3 gives a rejected plan exit 1 — so `orca plan` on a
  // dirty worktree printing `[fail] dirty-worktree: …` and then exiting 0 was
  // a broken contract, not a warning. §9.3's "warnings do not affect the exit
  // code" carve-out is about DEGRADATION (a fully serial plan is legal; a
  // person may want it), not about a check that failed.
  //
  // Printed first, then the code: a caller who only reads the exit status
  // still gets the report on stdout.
  if (preflightReport.rejections.length > 0) return 1;
  return 0;
}

async function runRun(args: string[]): Promise<number> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const flagValue = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  // The flag values are positional arguments too, so they have to come off
  // the positional list before the plan path is picked out of it — otherwise
  // `orca run --adapter-config cfg.json plan.json` runs cfg.json as the plan.
  const consumed = new Set([flagValue("--adapter-config"), flagValue("--adapter")]);
  const planPath = positional.find((a) => !consumed.has(a));
  if (!planPath) {
    process.stderr.write(USAGE);
    return 1;
  }

  const adapter = flagValue("--adapter");
  if (adapter !== undefined && adapter !== "scripted" && adapter !== "claude") {
    process.stderr.write(`orca run: unknown adapter ${JSON.stringify(adapter)}\n`);
    return 1;
  }

  return runRound(planPath, {
    verbose: args.includes("--verbose"),
    keepWorkdirs: args.includes("--keep-workdirs"),
    adapter,
    adapterConfig: flagValue("--adapter-config"),
    serial: args.includes("--serial"),
  });
}

async function runCorrect(args: string[]): Promise<number> {
  try {
    return await correct(args);
  } catch (err) {
    // A named refusal answers with its own exit code (spec §14.14). Anything
    // else is not this handler's to diagnose — it falls through to the
    // top-level arm, which answers 3.
    if (err instanceof CorrectRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

/**
 * spec §5, §7. Read-only: no file is written, no lock is taken.
 *
 * The exit code is NOT simply "were there bad lines". spec §5.2 exempts a torn
 * LAST line — that is the expected race of reading an append-only file while
 * someone appends — so 6 fires only when at least one bad line is NOT torn. A
 * flag per read could not express that; `torn` therefore lives on each line.
 *
 * ⚠️ The report is printed BEFORE the code is decided. A read-only reporting
 * tool that gives a person nothing because one line is bad is out of
 * proportion, and a criterion that only asserts the exit code would stay green
 * if this were reordered — so the criterion asserts stdout is non-empty too.
 */
async function runMetrics(args: string[]): Promise<number> {
  const flagValue = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const repos: Array<{ projectKey: string; path: string }> = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--repo") continue;
    const pair = args[i + 1] ?? "";
    const split = pair.indexOf("=");
    if (split <= 0) {
      process.stderr.write(`orca metrics: --repo wants <projectKey>=<path>, got ${JSON.stringify(pair)}\n`);
      return 1;
    }
    repos.push({ projectKey: pair.slice(0, split), path: pair.slice(split + 1) });
  }

  const started = performance.now();
  try {
    const observations = await collect({
      root: flagValue("--root"),
      repos,
      // Read-time evaluation, so ORCA_CORRECTIONS_DIR is honoured (Rule 17):
      // every criterion in this subsystem points it at a throwaway directory,
      // and a module-level constant would have frozen the real ~/.orca in.
      correctionsDir: correctionsDir(process.env),
      asOf: flagValue("--as-of"),
    });
    const report = computeMetrics(observations, { bucket: "month" });
    process.stdout.write(args.includes("--json") ? renderJson(report) : renderTable(report));
    // spec §4.1 / §6 item 3: the one quantity that varies every run goes to
    // stderr, never into --json, or no golden could ever be diffed.
    process.stderr.write(renderTiming(performance.now() - started));

    return report.malformed_lines.some((line) => !line.torn) ? 6 : 0;
  } catch (err) {
    if (err instanceof MetricsRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
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

  if (command === "run") {
    return runRun(rest);
  }

  if (command === "correct") {
    return runCorrect(rest);
  }

  if (command === "metrics") {
    return runMetrics(rest);
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
  void main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    // Fix round 1, finding 2. Without this arm a rejection out of main() is an
    // unhandled promise rejection: node decides the exit code, not this
    // program, and the error text lands in node's own crash format. 3 is spec
    // §6.3's escalation code and is the honest answer for an exception no
    // handler anticipated — 1 would claim "the input was rejected", which is a
    // diagnosis this arm has no way to make.
    (err: unknown) => {
      process.stderr.write(`orca: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exitCode = 3;
    },
  );
}
