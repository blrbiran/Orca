import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { checkAppendOnly } from "./ledger/appendOnly.js";
import { validateFile } from "./ledger/validateFile.js";
import { preflight } from "./scheduler/preflight.js";
import { loadRound, renderRound, runRound } from "./scheduler/run.js";

const USAGE = `usage:
  orca validate <path...>        validate ledger file(s) or directory (directory scans top-level *.jsonl only)
  orca check-append-only         read a git diff from stdin, reject if it contains any deleted line
  orca plan <path> [--verbose]   print the plan's write sets, conflicts, and layering; execute nothing
  orca run <path> --adapter-config <path> [--adapter scripted|claude] [--keep-workdirs] [--verbose]
                                 print the same report, then run every task and land it on the work branch
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
  const preflightReport = await preflight(round.plan, round.defaultBranch);

  process.stdout.write(`${renderRound(round, preflightReport, verbose)}\n`);
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
  });
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
