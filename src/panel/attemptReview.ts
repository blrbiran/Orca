import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { latestRunSnapshot, operatorAcceptanceOf } from "../control/acceptAttempt.js";
import { restoreSnapshotAttempt } from "../control/acceptAttemptDriver.js";
import { readCanonicalRecord } from "../control/snapshot.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import type { ControlStore } from "../control/store.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227 residual): what a person reads before asking Orca to land a failed run's
 * attempt -- the setup and required checks Orca will run on the merged tree (every task's, not only a loop task's; the
 * driver reads them from the confirmed contract, acceptAttemptDriver.ts runAcceptChecks), and what the attempt changed
 * against the run's base. Given only for a run the server could accept (acceptAttempt.ts's preconditions, less the
 * person's role), so a poll pays for nothing else.
 *
 * The diff is read from the same archive snapshot the driver would land (restoreSnapshotAttempt), rebuilt once in a private
 * temporary directory that is removed after, off the poll; until that answer lands the view says `diff: null`. A snapshot
 * is immutable, so its answer -- or its failure, also null -- is kept per snapshot and base.
 */
export interface AttemptReview {
  requiredChecks: string[];
  setupCommands: string[];
  diff: { shortstat: string; stat: string[] } | null;
}

const STAT_LINES_MAX = 60, LINE_MAX = 200, GIT_MAX_BYTES = 256 * 1024;
const run = promisify(execFile);
const diffs = new Map<string, AttemptReview["diff"] | "reading">();
const clip = (line: string): string => (line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX - 1)}…`);

async function gitText(repo: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, "--no-pager", ...args], {
    encoding: "utf8", timeout: 30_000, maxBuffer: GIT_MAX_BYTES, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

async function readDiff(store: ControlStore, snapshot: NonNullable<ReturnType<typeof latestRunSnapshot>>, base: string): Promise<AttemptReview["diff"]> {
  const parent = await mkdtemp(join(tmpdir(), "orca-attempt-diff-"));
  try {
    const dir = join(parent, "attempt");
    const attempt = await restoreSnapshotAttempt(store, snapshot, dir, 0);
    const shortstat = (await gitText(dir, ["diff", "--no-ext-diff", "--no-color", "--shortstat", base, attempt])).trim();
    const stat = (await gitText(dir, ["diff", "--no-ext-diff", "--no-color", "--stat=120", base, attempt])).split("\n").filter((line) => line.length > 0);
    return { shortstat, stat: (stat.length > STAT_LINES_MAX ? [...stat.slice(0, STAT_LINES_MAX - 1), stat.at(-1)!] : stat).map(clip) };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

/** The diff once read; null while it is read, or when it cannot be (no snapshot, no base, a failed rebuild). */
function diffOf(store: ControlStore, runId: string, base: string | null): AttemptReview["diff"] {
  const snapshot = latestRunSnapshot(store, runId);
  if (snapshot === null || base === null) return null;
  const key = `${snapshot.artifactId}\0${snapshot.hash}\0${base}`;
  const known = diffs.get(key);
  if (known !== undefined) return known === "reading" ? null : known;
  if (diffs.size >= 200) diffs.clear();
  diffs.set(key, "reading");
  void readDiff(store, snapshot, base).then((diff) => { diffs.set(key, diff); }, () => { diffs.set(key, null); });
  return null;
}

type ReviewRun = {
  runId: string; groupId: string; taskId: string | null; phase: string; state: string; mode?: unknown; recoveryOf?: unknown;
  drive?: { outcome?: string | null; base?: string | null } | undefined;
};

/** The review facts for a run the server could accept, else undefined (the view then carries no field). */
export function attemptReviewOf(store: ControlStore, value: ReviewRun, work: { currentRunId?: string | null; status: string; derivedContractHash: string | null }): AttemptReview | undefined {
  const outcome = value.drive?.outcome ?? null;
  if (value.phase !== "work" || value.taskId === null || value.mode !== undefined || value.recoveryOf !== undefined || value.state !== "settled-failed"
    || outcome === null || outcome === "succeeded" || work.currentRunId !== value.runId || work.status !== "blocked") return undefined;
  const recorded = operatorAcceptanceOf(value);
  if (recorded !== null && recorded.state !== "refused") return undefined;
  // The work item's derived contract record (orca-derived-contract-record-v1), the one the driver's
  // readConfirmedTaskExecution checks against the confirmed snapshot; read by hash, so the poll reads no work or run row
  // again (tests/panel/controlPollPerformance.test.ts).
  if (work.derivedContractHash === null) return undefined;
  let contract: ReturnType<typeof taskContractSchema.parse>;
  try {
    const record = JSON.parse(readCanonicalRecord(store, work.derivedContractHash)) as { contractCanonicalJson?: unknown };
    contract = taskContractSchema.parse(JSON.parse(String(record.contractCanonicalJson)));
  } catch { return undefined; }
  return {
    requiredChecks: [...contract.verification.requiredChecks],
    setupCommands: [...(contract.context.setupCommands ?? [])],
    diff: diffOf(store, value.runId, value.drive?.base ?? null),
  };
}
