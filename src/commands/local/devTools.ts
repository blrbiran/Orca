import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * CLI v2 plan Task 7: the ledger and dev tools, moved verbatim out of src/cli.ts so the registry rows
 * (`orca decision validate|metrics|compact-reviews`, `orca plan preview`, `orca dev …`) call this code; the old
 * top-level arms are gone (plan Task 14). Each loads its modules on demand (Review Focus 1).
 */
export async function collectLedgerFiles(paths: string[]): Promise<{ files: string[]; errors: string[] }> {
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

export async function runValidate(paths: string[]): Promise<number> {
  if (paths.length === 0) {
    process.stderr.write("usage: orca decision validate <path...>\n");
    return 1;
  }

  const { validateFile } = await import("../../ledger/validateFile.js");
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

export async function runPlan(args: string[]): Promise<number> {
  const verbose = args.includes("--verbose");
  const planPath = args.find((a) => !a.startsWith("--"));
  if (!planPath) {
    process.stderr.write("usage: orca plan preview <path> [--verbose]\n");
    return 1;
  }

  // spec §9.4: `plan` is not a sibling implementation of `run`'s front half,
  // it IS that front half — loadRound and renderRound are the same two calls
  // `orca run` makes before it spawns anything. Two implementations of "read
  // → validate → compute write sets → build the graph → layer it" would drift,
  // and the drift's direction is the worst one: the picture a person approved
  // stops being the graph that runs.
  // *** ERRATUM (consolidation step 3, 2026-10-01, Orca session be653b22, controller ruling C-1) -- `orca run` is
  // deleted; loadRound and renderRound are now the calls the control path's `runPreparedRound` round makes. ***
  const { loadRound, renderRound } = await import("../../scheduler/run.js");
  const { preflight } = await import("../../scheduler/preflight.js");
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
  // REJECTIONS, and §9.3 gives a rejected plan exit 1 — so `orca plan preview` on a
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

export async function runCorrect(args: string[]): Promise<number> {
  const { correct } = await import("../../corrections/correct.js");
  const { CorrectRejection } = await import("../../corrections/rejection.js");
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
export async function runMetrics(args: string[]): Promise<number> {
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

  const { collect } = await import("../../metrics/collect.js");
  const { computeMetrics } = await import("../../metrics/compute.js");
  const { renderJson, renderTable, renderTiming } = await import("../../metrics/report.js");
  const { MetricsRejection } = await import("../../metrics/rejection.js");
  const { correctionsDir } = await import("../../corrections/paths.js");
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


/**
 * reviews compaction spec section 3. Repositories come from collect() -- the
 * same --root/--repo flags as `metrics` and `panel`, so "which repositories
 * are here" has one definition -- and collect()'s refusals pass through by
 * name (section 1.7): a store key nothing resolves means nothing is touched.
 */
export async function runCompactReviews(args: string[]): Promise<number> {
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
    process.stderr.write(`orca compact-reviews: unknown argument ${JSON.stringify(arg)}\n`);
    return 1;
  }

  const { correctionsDir } = await import("../../corrections/paths.js");
  const { collect } = await import("../../metrics/collect.js");
  const { MetricsRejection } = await import("../../metrics/rejection.js");
  const { applyCompaction, dryRunCompaction, renderCompactionReport } = await import("../../panel/compactReviews.js");
  const { buildLedgerViews, wantedDecisions } = await import("../../panel/ledgerViews.js");
  const { reviewsFile } = await import("../../panel/paths.js");
  const { PanelRejection } = await import("../../panel/rejection.js");
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
export function flagValues(command: string, args: string[], allowed: string[]): Map<string, string> | string {
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

export async function runCheckpoint(args: string[]): Promise<number> {
  const [sub, ...flags] = args;
  const values = sub === "write" ? flagValues("checkpoint write", flags, ["--repo", "--session", "--transcript", "--draft"]) : "orca checkpoint: only write is supported";
  if (typeof values === "string") {
    process.stderr.write(`${values}\n`);
    return 1;
  }
  const sessionRef = values.get("--session");
  const transcriptPath = values.get("--transcript");
  const draftPath = values.get("--draft");
  if (sessionRef === undefined || draftPath === undefined) {
    process.stderr.write(`orca dev checkpoint write: --session and --draft are required\n`);
    return 1;
  }
  const { CheckpointRejection, describeLevel } = await import("../../checkpoint/schema.js");
  const { writeCheckpoint } = await import("../../checkpoint/write.js");
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

export async function runResume(args: string[]): Promise<number> {
  const values = flagValues("resume", args, ["--repo", "--checkpoint"]);
  if (typeof values === "string") {
    process.stderr.write(`${values}\n`);
    return 1;
  }
  const { resumeOutcome } = await import("../../checkpoint/resume.js");
  const outcome = await resumeOutcome({ repo: values.get("--repo") ?? process.cwd(), checkpointPath: values.get("--checkpoint") });
  if (outcome.rejection !== null) {
    process.stderr.write(`rejected: ${outcome.rejection.code}: ${outcome.rejection.message}\n`);
    return outcome.exitCode;
  }
  process.stdout.write(outcome.text);
  return outcome.exitCode;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
