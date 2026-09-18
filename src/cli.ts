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
import { levelHookClaudeCode } from "./level/hook.js";
import { gateHookClaudeCode } from "./gate/hook.js";
import { validateFile } from "./ledger/validateFile.js";
import { preflight } from "./scheduler/preflight.js";
import { loadRound, renderRound, runRound } from "./scheduler/run.js";
import { applyCompaction, dryRunCompaction, renderCompactionReport } from "./panel/compactReviews.js";
import { buildLedgerViews, wantedDecisions } from "./panel/ledgerViews.js";
import { reviewsFile } from "./panel/paths.js";
import { PanelRejection } from "./panel/rejection.js";
import { CheckpointRejection, describeLevel } from "./checkpoint/schema.js";
import { writeCheckpoint } from "./checkpoint/write.js";
import { resumeOutcome } from "./checkpoint/resume.js";
import { runChainCommand } from "./chain/command.js";

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
  orca panel --by <who> [--port <n>] [--bind <addr>] [--root <dir>] [--repo <key>=<path>]...
                                 serve the read-only panel on the loopback interface with a
                                 one-time token. --bind opens it to other machines and needs
                                 --i-know-this-is-exposed as well: there is no TLS, the token
                                 travels in the HTML, it cannot be revoked, and one process has
                                 exactly one identity, so external mode suits you across your
                                 own machines and does not suit a team.
  orca compact-reviews [--apply] [--root <dir>] [--repo <key>=<path>]...
                                 dedupe reviews.jsonl and move rows whose decision was archived into
                                 reviews-archive.jsonl. Without --apply it prints the report and writes
                                 nothing. A row is left untouched when its repository is not found, its
                                 ledger has a bad line, or its decision is in neither the ledger nor
                                 .decisions/archive/. It never creates the store directory.
  orca level --hook claude-code  read a Claude Code hook's JSON on stdin and print what the session should be
                                 told about its context window: nothing below T1, a request to write a
                                 checkpoint at T1, a breach past T2, and "no reading" whenever it cannot read
  orca checkpoint write --session <id> --draft <path> [--transcript <path>] [--repo <path>]
                                 write .orca/checkpoints/<run-id>.json from the agent's draft (next, open,
                                 awaitingHuman, measure, and in a chain session chain) plus what this command
                                 measures itself: the context-window level, HEAD, and the exit code of every
                                 measure command. Without --transcript the transcript is found by session id under
                                 ORCA_CLAUDE_PROJECTS_DIR, $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects.
                                 In a chain session (ORCA_CHAIN_SESSION set) --session must equal it.
                                 Refuses a dirty worktree. Commits exactly that one file.
  orca resume [--repo <path>] [--checkpoint <path>]
                                 start a session from the latest checkpoint reachable from HEAD: print its
                                 next steps and open items, the commits since, whether its measurements are
                                 stale, re-run every one of them, report publish state from ls-remote now, and
                                 list what waits for a human. Exit 2 when a measurement's exit code changed.
  orca gate --hook claude-code   read a Claude Code PreToolUse hook's JSON on stdin; exit 2 with one line on stderr
                                 when the Bash command would push, merge into main, delete a branch or remove a
                                 worktree (Tier 0), or when it cannot decide; exit 0 otherwise
  orca chain start --repo <path> --by <who> --goal <text> --max-sessions <n> --max-cost-usd <x>
                   [--session-timeout-min <m>] [--chain-id <chain-xxxxxxxx>] [--via cli|panel]
                                 run unattended Claude Code sessions one after another in <path> — a dedicated
                                 clone or worktree of an Orca checkout with the Tier 0 gate — each starting from
                                 \`orca resume\`, until one writes an exit checkpoint saying done or blocked, or a
                                 limit or an anomaly stops the chain. The cost limit is soft: it is checked after
                                 each session, and a session may overrun its --max-budget-usd. The model and the
                                 default timeout (360 min, a backstop) come from .orca/chain.json. Exit 0 done,
                                 1 refused before anything was written, 2 anomaly, 3 blocked on a person,
                                 4 limit or stop request
  orca chain stop --repo <path> [--chain-id <id>]
                                 ask the running chain to stop after its current session ends
  orca chain unlock --repo <path>
                                 after checking its supervisor is gone: remove a chain's lock and record the
                                 chain as stopped (unlocked-by-human)
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

async function runPanel(args: string[]): Promise<number> {
  try {
    // Argument parsing and the machine-readable line live here; everything the
    // panel actually DOES lives behind createPanelServer, which touches
    // neither argv nor stdout. That is the same seam the correction row got in
    // src/corrections/record.ts, for the same reason: a request handler cannot
    // call something that writes stdout and returns an exit code.
    const { startPanelFromArgs } = await import("./panel/server.js");
    const started = await startPanelFromArgs(args);
    // 🔴 spec §7: ONE machine-readable line on stdout. Without it the success
    // criterion cannot read back the port and the token it needs, and a
    // criterion that cannot read its own subject is exactly the "success
    // criterion that never exits 0" E2 §7.1 caught.
    process.stdout.write(`orca-panel ready url=${started.url} token=${started.token}\n`);
    await started.closed;
    return 0;
  } catch (err) {
    const { PanelRejection } = await import("./panel/rejection.js");
    if (err instanceof PanelRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

/**
 * reviews compaction spec section 3. Repositories come from collect() -- the
 * same --root/--repo flags as `metrics` and `panel`, so "which repositories
 * are here" has one definition -- and collect()'s refusals pass through by
 * name (section 1.7): a store key nothing resolves means nothing is touched.
 */
async function runCompactReviews(args: string[]): Promise<number> {
  let apply = false;
  let root: string | undefined;
  const repos: Array<{ projectKey: string; path: string }> = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--root" && args[i + 1] !== undefined) {
      root = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repo") {
      const pair = args[i + 1] ?? "";
      const split = pair.indexOf("=");
      if (split <= 0) {
        process.stderr.write(`orca compact-reviews: --repo wants <projectKey>=<path>, got ${JSON.stringify(pair)}\n`);
        return 1;
      }
      repos.push({ projectKey: pair.slice(0, split), path: pair.slice(split + 1) });
      i += 1;
      continue;
    }
    process.stderr.write(`orca compact-reviews: unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
    return 1;
  }

  const dir = correctionsDir(process.env);
  try {
    const observations = await collect({ root, repos, correctionsDir: dir });
    const views = await buildLedgerViews(observations.repos, await wantedDecisions(dir));
    if (!apply) {
      process.stdout.write(renderCompactionReport(await dryRunCompaction(dir, views), "dry-run", reviewsFile(dir)));
      return 0;
    }
    const outcome = await applyCompaction(dir, views);
    process.stdout.write(
      renderCompactionReport(outcome.classification, outcome.wrote ? "applied" : "nothing-to-do", reviewsFile(dir)),
    );
    return 0;
  } catch (err) {
    if (err instanceof MetricsRejection || err instanceof PanelRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

/** `--flag value` pairs, each allowed flag at most once. Returns an error text instead of throwing. */
function flagValues(command: string, args: string[], allowed: string[]): Map<string, string> | string {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!allowed.includes(flag) || value === undefined || values.has(flag)) {
      return `orca ${command}: unexpected argument ${JSON.stringify(flag)}`;
    }
    values.set(flag, value);
  }
  return values;
}

async function runCheckpoint(args: string[]): Promise<number> {
  const [sub, ...flags] = args;
  const values = sub === "write" ? flagValues("checkpoint write", flags, ["--repo", "--session", "--transcript", "--draft"]) : "orca checkpoint: only write is supported";
  if (typeof values === "string") {
    process.stderr.write(`${values}\n${USAGE}`);
    return 1;
  }
  const sessionRef = values.get("--session");
  const transcriptPath = values.get("--transcript");
  const draftPath = values.get("--draft");
  if (sessionRef === undefined || draftPath === undefined) {
    process.stderr.write(`orca checkpoint write: --session and --draft are required\n${USAGE}`);
    return 1;
  }
  try {
    const result = await writeCheckpoint({ repo: values.get("--repo") ?? process.cwd(), sessionRef, transcriptPath, draftPath });
    const lines = [`wrote ${result.path}`, `committed ${result.commit}`, describeLevel(result.checkpoint.level)];
    for (const m of result.checkpoint.measurements) lines.push(`exit ${m.exitCode}: ${m.command} (output ${m.outputPath})`);
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } catch (err) {
    if (err instanceof CheckpointRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

async function runResume(args: string[]): Promise<number> {
  const values = flagValues("resume", args, ["--repo", "--checkpoint"]);
  if (typeof values === "string") {
    process.stderr.write(`${values}\n${USAGE}`);
    return 1;
  }
  const outcome = await resumeOutcome({ repo: values.get("--repo") ?? process.cwd(), checkpointPath: values.get("--checkpoint") });
  if (outcome.rejection !== null) {
    process.stderr.write(`rejected: ${outcome.rejection.code}: ${outcome.rejection.message}\n`);
    return outcome.exitCode;
  }
  process.stdout.write(outcome.text);
  return outcome.exitCode;
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

  if (command === "panel") {
    return runPanel(rest);
  }

  if (command === "compact-reviews") {
    return runCompactReviews(rest);
  }

  if (command === "level") {
    if (rest.length !== 2 || rest[0] !== "--hook" || rest[1] !== "claude-code") {
      process.stderr.write(`orca level: only --hook claude-code is supported\n${USAGE}`);
      return 1;
    }
    process.stdout.write(await levelHookClaudeCode(stdinText ?? (await readStdin())));
    return 0;
  }

  if (command === "gate") {
    if (rest.length !== 2 || rest[0] !== "--hook" || rest[1] !== "claude-code") {
      process.stderr.write(`orca gate: only --hook claude-code is supported\n${USAGE}`);
      return 1;
    }
    const result = await gateHookClaudeCode(stdinText ?? (await readStdin()));
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  if (command === "chain") {
    return runChainCommand(rest);
  }

  if (command === "checkpoint") {
    return runCheckpoint(rest);
  }

  if (command === "resume") {
    return runResume(rest);
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
