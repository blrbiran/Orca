import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { git } from "../scheduler/gitExec.js";
import { runMeasurement } from "./measure.js";
import { CHAIN_RECORDS_DIR, CHECKPOINT_DIR, type Checkpoint, CheckpointRejection, CheckpointSchema, describeLevel } from "./schema.js";

/**
 * D spec 5 step 4 and 9 item 3: the start-of-session check a person used to paste as a brief.
 * Everything that can have changed since the checkpoint is re-measured here, now.
 * D spec 9 item 3: a measurement's exit code changed => non-zero exit.
 *
 * `opts.git` (plan PC-20, controller ruling on W30): the git runner this function's own read-only calls make
 * (not `runMeasurement`'s `/bin/sh -c`, out of scope). Defaults to the plain `git` wrapper, so `orca resume`'s
 * own behaviour, output and exit codes are unchanged; the chain supervisor passes `chainGit` (`src/chain/git.ts`)
 * so these calls carry the same `-c core.hooksPath=/dev/null -c core.fsmonitor=false` its own git calls do.
 */
export async function resume(opts: { repo: string; checkpointPath?: string; git?: typeof git }): Promise<{ text: string; exitCode: 0 | 2 }> {
  const runGit = opts.git ?? git;
  const repo = (await runGit(opts.repo, ["rev-parse", "--show-toplevel"])).trim();
  // An explicit --checkpoint is read as the file it names. A located checkpoint is read from its commit,
  // so uncommitted edits or residue in the worktree are never presented as the committed checkpoint.
  const located = opts.checkpointPath === undefined ? await latestCheckpoint(repo, runGit) : undefined;
  const path = located === undefined ? (opts.checkpointPath as string) : join(repo, located.file);
  const cp = await readCheckpoint(path, () =>
    located === undefined ? readFile(path, "utf8") : runGit(repo, ["show", `${located.sha}:${located.file}`]),
  );
  const out: string[] = [
    `checkpoint: ${path}`,
    `run ${cp.runId}, session ${cp.sessionRef}, written ${cp.writtenAt}, ${describeLevel(cp.level)}`,
    "next:",
    ...cp.next.map((item, i) => `  ${i + 1}. ${item}`),
    "open:",
    ...(cp.open.length > 0 ? cp.open.map((item) => `  - ${item}`) : ["  (none)"]),
  ];

  const since = await runGit(repo, ["log", "--oneline", `${cp.head}..HEAD`]).catch((err: Error) => `(cannot list: ${err.message.trim()})\n`);
  out.push(`commits since ${cp.head.slice(0, 7)}:`, ...(since.trim() === "" ? ["  (none)"] : since.trimEnd().split("\n").map((l) => `  ${l}`)));

  const changed = await runGit(repo, ["diff", "--name-only", cp.head, "HEAD", "--", ".", `:(exclude)${CHECKPOINT_DIR}`, `:(exclude)${CHAIN_RECORDS_DIR}`]).then(
    (text) => text.split("\n").filter((l) => l !== ""),
    (err: Error) => err,
  );
  const freshness =
    changed instanceof Error ? `unknown (${changed.message.trim()})` : changed.length === 0 ? "fresh" : `stale (${changed.length} file(s) changed since)`;
  out.push(`measurements (${freshness}):`);
  let exitCodeChanged = false;
  if (cp.measurements.length === 0) out.push("  (none)");
  else {
    const outputDir = await mkdtemp(join(tmpdir(), `orca-resume-${cp.runId}-`));
    for (const [index, m] of cp.measurements.entries()) {
      const outputPath = join(outputDir, `${index + 1}.txt`);
      const now = await runMeasurement(repo, m.command, outputPath);
      if (now !== m.exitCode) exitCodeChanged = true;
      out.push(`  ${now === m.exitCode ? "same" : "CHANGED"} exit ${m.exitCode} -> ${now}: ${m.command} (output ${outputPath})`);
    }
  }

  out.push(await publishStatus(repo, runGit));
  out.push("awaiting a human:", ...(cp.awaitingHuman.length > 0 ? cp.awaitingHuman.map((a) => `  - [${a.kind}] ${a.what}`) : ["  (none)"]));
  return { text: `${out.join("\n")}\n`, exitCode: exitCodeChanged ? 2 : 0 };
}

async function latestCheckpoint(repo: string, runGit: typeof git): Promise<{ sha: string; file: string }> {
  const sha = (await runGit(repo, ["log", "-1", "--format=%H", "--", CHECKPOINT_DIR])).trim();
  if (sha === "") throw new CheckpointRejection("no-checkpoint", `no commit reachable from HEAD touches ${CHECKPOINT_DIR}`);
  const files = (await runGit(repo, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha, "--", CHECKPOINT_DIR]))
    .split("\n")
    .filter((l) => l !== "");
  if (files.length !== 1) {
    throw new CheckpointRejection(
      "ambiguous-checkpoint",
      `commit ${sha.slice(0, 7)} touches ${files.length} checkpoint files (${files.join(", ")}); name one with --checkpoint`,
    );
  }
  return { sha, file: files[0] };
}

async function readCheckpoint(path: string, load: () => Promise<string>): Promise<Checkpoint> {
  let raw: unknown;
  try {
    raw = JSON.parse(await load());
  } catch (err) {
    throw new CheckpointRejection("checkpoint-invalid", `${path} cannot be read as JSON: ${(err as Error).message}`);
  }
  const parsed = CheckpointSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CheckpointRejection(
      "checkpoint-invalid",
      `${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

async function publishStatus(repo: string, runGit: typeof git): Promise<string> {
  const branch = (await runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  let line: string;
  try {
    // GIT_TERMINAL_PROMPT=0: a remote that wants credentials fails here instead of waiting on a prompt.
    // Plan PC-20 (review I4): ls-remote stays on the raw execFile, not the injected runner — it is not a
    // supervisor git call, it is spec §2's already-registered residual risk (a session-controlled
    // remote.origin.url/core.sshCommand), unchanged by this controller ruling.
    const { stdout } = await promisify(execFile)("git", ["ls-remote", "origin", `refs/heads/${branch}`], {
      cwd: repo,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    line = stdout.trim();
  } catch (err) {
    return `publish: ls-remote origin failed: ${(err as Error).message.trim()}`;
  }
  if (line === "") return `publish: origin has no ${branch}`;
  const remote = line.split("\t")[0];
  try {
    await runGit(repo, ["cat-file", "-e", `${remote}^{commit}`]);
  } catch {
    return `publish: origin/${branch} is at ${remote}, which this clone does not have: origin has commits not fetched here`;
  }
  const [ahead, behind] = (await runGit(repo, ["rev-list", "--left-right", "--count", `HEAD...${remote}`])).trim().split(/\s+/);
  return `publish: origin/${branch} at ${remote.slice(0, 7)}; local ahead ${ahead}, behind ${behind} (measured now by ls-remote)`;
}

export type ResumeOutcome =
  | { exitCode: 0 | 2; text: string; rejection: null }
  | { exitCode: number; text: ""; rejection: { code: string; message: string } };

/**
 * D-launch spec §2 (review 1): the chain supervisor runs resume inside its own process — never as an `orca` child,
 * which would load code a session may have changed. A named refusal becomes a value the supervisor routes (§4.4);
 * anything else still throws, so the CLI keeps answering it with main()'s exit 3 exactly as before.
 */
export async function resumeOutcome(opts: { repo: string; checkpointPath?: string; git?: typeof git }): Promise<ResumeOutcome> {
  try {
    const result = await resume(opts);
    return { ...result, rejection: null };
  } catch (err) {
    if (err instanceof CheckpointRejection) return { exitCode: err.exitCode, text: "", rejection: { code: err.code, message: err.message } };
    throw err;
  }
}
