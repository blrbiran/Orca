import { execFile } from "node:child_process";
import { isTerminalRunState } from "../control/budget.js";
import type { DriverRun } from "../control/executionDriver.js";
import { groupRepoId, isDirGroup } from "../control/dirGroup.js";
import { readDriverRun, saveDriverRun, write, type ExecutionDriverDeps } from "../control/executionDriver.js";
import type { ControlStore } from "../control/store.js";

/**
 * Run-outcome writeback spec 2026-11-21 §3: Orca tells ccmem which memories a run actually carried and how it ended —
 * a fact, never a verdict, and never a failure of the run. The queue is an outbox on the drive record, filled by one
 * drain pass (not by each terminal path), frozen on first sight, and sent to `ccmem orca-outcome upsert`.
 *
 * Only a run whose collect echoed `memory` queues anything: the echo is the proof the bundle reached the provider.
 * Phase 1 records only; nothing here reads or moves trust.
 */
export interface MemoryFeedbackPayload {
  version: 1;
  runId: string;
  taskId: string | null;
  attempt: number | null;
  outcome: string;
  abandoned: boolean;
  memoryIds: number[];
  observedAt: number;
}

export type RunCcmem = (args: string[], input: string | null, cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const CCMEM_TIMEOUT_MS = 30_000;
const CCMEM_MAX_BUFFER = 1024 * 1024;

const defaultRunCcmem: RunCcmem = (args, input, cwd) => new Promise((resolve, reject) => {
  const child = execFile(process.env.ORCA_CCMEM_BIN ?? "ccmem", args, {
    cwd, env: process.env, encoding: "utf8", timeout: CCMEM_TIMEOUT_MS, maxBuffer: CCMEM_MAX_BUFFER,
  }, (error, stdout, stderr) => {
    if (error === null) { resolve({ code: 0, stdout, stderr }); return; }
    const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
    resolve({ code, stdout, stderr: String(stderr) });
  });
  child.stdin?.end(input ?? "");
});

/** The queueable outcome of one run, or null when it is not terminal (or blocked with a recorded outcome) / has no echo. */
export function outcomePayloadOf(run: DriverRun, now: number): MemoryFeedbackPayload | null {
  const drive = run.drive;
  if (drive === undefined || drive.memoryReport === undefined) return null;
  const blockedWithOutcome = run.state === "blocked" && typeof drive.outcome === "string" && drive.outcome !== "";
  if (!isTerminalRunState(run.state) && !blockedWithOutcome) return null;
  const abandoned = (run as unknown as { operatorSettlement?: { kind?: unknown } }).operatorSettlement?.kind === "abandoned";
  const outcome = drive.outcome ?? (run.state === "failed-before-provider" ? "not-started" : run.state);
  return {
    version: 1,
    runId: run.runId,
    taskId: run.taskId,
    attempt: drive.finalAttempt ?? null,
    outcome,
    abandoned,
    memoryIds: [...drive.memoryReport.ids],
    observedAt: now,
  };
}

function rowsWithDrive(store: ControlStore): DriverRun[] {
  return store.db.prepare("SELECT id FROM runs ORDER BY id").all()
    .map((row) => readDriverRun(store, String((row as { id: string }).id)));
}

/** Fill the outbox with every eligible run that has none yet, and freeze its payload. Returns the rows written. */
export function queueMemoryOutcomes(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">, now: number): number {
  let queued = 0;
  for (const run of rowsWithDrive(deps.store)) {
    const drive = run.drive;
    if (drive === undefined || drive.memoryReport === undefined || drive.memoryFeedback !== undefined) continue;
    const at = now;
    // A dir project has no ccmem key to write against (spec Q4): one skipped row, no payload, no process.
    if (isDirGroup(deps.store, run.groupId)) {
      write(deps, () => {
        const current = readDriverRun(deps.store, run.runId);
        current.drive = { ...current.drive!, memoryFeedback: { state: "skipped", detail: "dir-project-memory-unsupported", at, attempts: 0 } };
        saveDriverRun(deps.store, current);
      });
      queued += 1;
      continue;
    }
    const payload = outcomePayloadOf(run, now);
    if (payload === null) continue;
    write(deps, () => {
      const current = readDriverRun(deps.store, run.runId);
      if (current.drive?.memoryFeedback !== undefined) return;
      current.drive = { ...current.drive!, memoryFeedback: { state: "pending", payload, at, attempts: 0 } };
      saveDriverRun(deps.store, current);
    });
    queued += 1;
  }
  return queued;
}

/** The sendable rows: pending, or failed with a retry left (spec §3.2: attempts < 2). */
function sendable(run: DriverRun): boolean {
  const feedback = run.drive?.memoryFeedback;
  if (feedback === undefined || feedback.payload === undefined) return false;
  return feedback.state === "pending" || (feedback.state === "failed" && feedback.attempts < 2);
}

/**
 * One drain: queue new rows, probe the ccmem verb once per binary, then send a bounded number of rows. A spawn error,
 * a non-zero exit or an unparseable answer only moves the outbox row — never the run's state, activity or cleanup.
 */
export async function drainMemoryOutcomes(
  deps: Pick<ExecutionDriverDeps, "store" | "admissionGate" | "resolveRepository">,
  memory: { ccmemBin: string; env: NodeJS.ProcessEnv },
  now: number,
  options: { runCcmem?: RunCcmem; limit?: number; probe?: (bin: string) => Promise<boolean> } = {},
): Promise<number> {
  queueMemoryOutcomes(deps, now);
  const runCcmem = options.runCcmem ?? defaultRunCcmem;
  const rows = rowsWithDrive(deps.store).filter(sendable).slice(0, options.limit ?? 8);
  if (rows.length === 0) return 0;
  const supported = await (options.probe ?? probeOutcomeVerb)(memory.ccmemBin);
  let moved = 0;
  for (const run of rows) {
    const feedback = run.drive!.memoryFeedback!;
    const payload = feedback.payload!;
    const at = now;
    if (!supported) {
      write(deps, () => {
        const current = readDriverRun(deps.store, run.runId);
        current.drive = { ...current.drive!, memoryFeedback: { ...current.drive!.memoryFeedback!, state: "unsupported", detail: "orca-outcome-verb-missing", at } };
        saveDriverRun(deps.store, current);
      });
      moved += 1;
      continue;
    }
    let answer: { code: number; stdout: string; stderr: string };
    try {
      answer = await runCcmem(["orca-outcome", "upsert"], JSON.stringify(payload), run.drive!.targetRepo ?? deps.resolveRepository(groupRepoId(deps.store, run.groupId)));
    } catch (error) {
      answer = { code: 1, stdout: "", stderr: (error as Error).message };
    }
    const state = answer.code === 0 ? "sent" : answer.code === 64 ? "refused" : "failed";
    const detail = state === "sent" ? undefined : (answer.stderr.trim() || answer.stdout.trim() || `exit-${answer.code}`).slice(0, 300);
    write(deps, () => {
      const current = readDriverRun(deps.store, run.runId);
      const before = current.drive!.memoryFeedback!;
      current.drive = {
        ...current.drive!,
        memoryFeedback: {
          ...before,
          state,
          ...(detail === undefined ? {} : { detail }),
          at,
          attempts: state === "failed" ? before.attempts + 1 : before.attempts,
        },
      };
      saveDriverRun(deps.store, current);
    });
    moved += 1;
  }
  return moved;
}

/** `ccmem orca-outcome --help` answers 0 and names the verb; cached by binary path + mtime (an in-place upgrade re-probes). */
let probeCache: { identity: string; supported: boolean } | null = null;

export async function probeOutcomeVerb(bin: string): Promise<boolean> {
  const { statSync } = await import("node:fs");
  let identity = bin;
  try { const stat = statSync(bin); identity = `${bin}:${stat.mtimeMs}:${stat.size}`; } catch { /* a missing binary is not supported */ }
  if (probeCache?.identity === identity) return probeCache.supported;
  const answer = await defaultRunCcmem(["--help"], null, process.cwd());
  const supported = answer.code === 0 && /orca-outcome/.test(`${answer.stdout}\n${answer.stderr}`);
  probeCache = { identity, supported };
  return supported;
}