import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLevel } from "../level/readLevel.js";
import { bandOf, effectiveThresholds } from "../level/trigger.js";
import { levelOf } from "../level/types.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { runMeasurement } from "./measure.js";
import {
  CHECKPOINT_DIR,
  type Checkpoint,
  CheckpointRejection,
  CheckpointSchema,
  type Draft,
  DraftSchema,
  type LevelRecord,
  describeLevel,
  runIdFor,
} from "./schema.js";

export interface WriteOptions {
  repo: string;
  sessionRef: string;
  transcriptPath: string;
  draftPath: string;
  now?: () => Date;
}

/**
 * D spec 5 step 2 and 9 item 1. The agent supplies judgment only; the level, HEAD and every measurement's
 * exit code are produced here, so a checkpoint cannot carry a number nobody measured (Rule 14).
 */
export async function writeCheckpoint(opts: WriteOptions): Promise<{ path: string; commit: string; checkpoint: Checkpoint }> {
  const now = opts.now ?? (() => new Date());
  const repo = (await git(opts.repo, ["rev-parse", "--show-toplevel"])).trim();
  const runId = runIdFor(opts.sessionRef);
  if (runId === null) {
    throw new CheckpointRejection("session-ref-unusable", `session ${JSON.stringify(opts.sessionRef)} does not start with eight hex digits, so it cannot name a run`);
  }
  const draft = await readDraft(opts.draftPath);
  await refuseDirty(repo, "dirty-worktree", "commit or stash first, and keep the draft outside the repository");

  const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
  const level = await levelRecord(repo, opts.sessionRef, opts.transcriptPath);
  const outputDir = await mkdtemp(join(tmpdir(), `orca-checkpoint-${runId}-`));
  const measurements: Checkpoint["measurements"] = [];
  for (const [index, command] of draft.measure.entries()) {
    const outputPath = join(outputDir, `${index + 1}.txt`);
    const exitCode = await runMeasurement(repo, command, outputPath);
    measurements.push({ command, exitCode, commit: head, observedAt: now().toISOString(), outputPath });
  }
  await refuseDirty(repo, "measurement-dirtied-worktree", "a measurement changed the worktree; nothing was written");
  if ((await git(repo, ["rev-parse", "HEAD"])).trim() !== head) {
    throw new CheckpointRejection("head-moved", "HEAD moved while measuring; nothing was written");
  }

  const checkpoint = CheckpointSchema.parse({
    v: 1,
    runId,
    runtime: "claude-code",
    sessionRef: opts.sessionRef,
    writtenAt: now().toISOString(),
    head,
    level,
    next: draft.next,
    open: draft.open,
    awaitingHuman: draft.awaitingHuman,
    measurements,
  });
  const relPath = join(CHECKPOINT_DIR, `${runId}.json`);
  await mkdir(join(repo, CHECKPOINT_DIR), { recursive: true });
  await writeFile(join(repo, relPath), `${JSON.stringify(checkpoint, null, 2)}\n`);
  try {
    await git(repo, ["add", "--", relPath]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", `chore(checkpoint): ${runId}, ${describeLevel(level)}`, "--", relPath]);
  } catch (err) {
    throw new CheckpointRejection("checkpoint-commit-refused", `${relPath} is written but git refused to commit it: ${(err as Error).message.trim()}`, 5);
  }
  return { path: join(repo, relPath), commit: (await git(repo, ["rev-parse", "HEAD"])).trim(), checkpoint };
}

async function readDraft(path: string): Promise<Draft> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new CheckpointRejection("draft-invalid", `draft ${path} cannot be read as JSON: ${(err as Error).message}`);
  }
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CheckpointRejection("draft-invalid", `draft ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

async function refuseDirty(repo: string, code: string, advice: string): Promise<void> {
  const changed = (await git(repo, ["status", "--porcelain", "--untracked-files=all"]))
    .split("\n")
    .filter((line) => line !== "" && !line.slice(3).startsWith(`${CHECKPOINT_DIR}/`));
  if (changed.length > 0) {
    throw new CheckpointRejection(code, `the worktree has changes (${changed.slice(0, 5).map((l) => l.slice(3)).join(", ")}): ${advice}`);
  }
}

async function levelRecord(repo: string, sessionRef: string, transcriptPath: string): Promise<LevelRecord> {
  const { input, thresholds } = await readLevel(repo, sessionRef, transcriptPath);
  if (input.kind === "no-reading") return { kind: "no-reading", reason: input.reason };
  const effective = effectiveThresholds(input, thresholds);
  const level = levelOf(input);
  return { kind: "reading", level, windowTokens: input.windowTokens, t1: effective.t1, t2: effective.t2, band: bandOf(level, effective) };
}
