import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isDirProjectKey } from "../corrections/projectKey.js";
import type { Correction } from "../corrections/schema.js";
import { describeCorrectionTarget } from "../corrections/target.js";
import type { CorrectionListItemV1 } from "../control/correctionState.js";
import { readLedgerAtRef } from "../control/ledgerAtRef.js";

/**
 * Corrections-to-ccmem spec 2026-10-21 §2 and As-built (session 9ec98639). A person's correction that is closed and not
 * withdrawn is written to the repository's project scope in ccmem through `ccmem orca-correction upsert`; a withdrawn one
 * that was written is archived through `withdraw`. ccmem keys both by `orca:correction:<id>` (ccmem spec
 * 2026-10-21-orca-correction-import-design.md), so a re-send never duplicates. What Orca sent is recorded per correction
 * in `<correctionsDir>/ccmem-exports.json` (Rule 17: under ORCA_CORRECTIONS_DIR, 0600 when created), with the content's
 * hash, so a changed text is sent again and an unchanged one is not. Off unless the panel runs with
 * `--ccmem-corrections`; never blocks anything: every failure is recorded and retried later.
 */
export const EXPORTS_FILE = "ccmem-exports.json";
export const EXPORTS_SCHEMA = "orca-ccmem-exports-v1";
/** ccmem's default `save.max_chars_per_memory` (UTF-16 length, as ccmem measures it). A smaller configured limit is refused (64) and recorded. */
export const MEMORY_MAX_CHARS = 500;
export const CCMEM_CORRECTION_TIMEOUT_MS = 30_000;
/** A failed call (exit 1, timeout, spawn error) is retried after 5 min, doubling, at most 6 h apart. */
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;
/** One pass at most this often: each pass reads every correction's closed state from git. */
export const PASS_INTERVAL_MS = 5 * 60_000;
const DETAIL_CHARS = 500;

export type ExportRow =
  | { state: "exported"; sha256: string; memoryId: number | null; at: number }
  | { state: "refused"; sha256: string; detail: string; at: number }
  | { state: "failed"; sha256: string; detail: string; at: number; attempts: number; nextAttemptAt: number; withdraw: boolean }
  | { state: "withdrawn"; at: number };

export interface ExportsFile { schema: typeof EXPORTS_SCHEMA; rows: Record<string, ExportRow> }

/** Missing file ⇒ empty. A file that does not parse is refused by name: overwriting it would forget what ccmem holds. */
export async function readExports(dir: string): Promise<ExportsFile> {
  let text: string;
  try { text = await readFile(join(dir, EXPORTS_FILE), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: EXPORTS_SCHEMA, rows: {} };
    throw error;
  }
  const value = JSON.parse(text) as Partial<ExportsFile>;
  if (value.schema !== EXPORTS_SCHEMA || typeof value.rows !== "object" || value.rows === null) throw new Error(`${EXPORTS_FILE}: not an ${EXPORTS_SCHEMA} file`);
  return value as ExportsFile;
}

/** Temp file + fsync + rename; a new file is 0600 (Rule 17), an existing one keeps its mode only through the rename's new inode -- so the temp is 0600 too. */
export async function writeExports(dir: string, file: ExportsFile): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, EXPORTS_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  const handle = await open(temp, "w", 0o600);
  try { await handle.writeFile(`${JSON.stringify(file, null, 1)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, target);
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The decision the correction targets, read from the ledger at the ref the correction was found closed on. */
export interface CorrectedDecision { question: string; chose: string }

/**
 * As-built template. Fields are clipped to fixed shares so the person's reason survives a long question: question 100,
 * agent's choice 100, the person's choice 120, the reason whatever is left; the whole text never exceeds MEMORY_MAX_CHARS.
 */
export function correctionMemoryText(correction: Correction, decision: CorrectedDecision | null): string {
  // Flow engine spec §13.4: the head names the target -- a decision (pending or recorded), a run, or the repository.
  const target = describeCorrectionTarget(correction);
  const kind = correction.kind === "wrong" ? "wrong" : correction.kind === "stale" ? "stale" : "not to the person's taste";
  const named = correction.decisionId !== undefined || correction.pendingId !== undefined ? `an agent's ${target}`
    : correction.runId !== undefined ? target : `the work in ${target}`;
  const head = decision === null
    ? `Orca correction: the person ruled ${named} ${kind}.`
    : `Orca correction: for "${clip(oneLine(decision.question), 100)}" an agent chose "${clip(oneLine(decision.chose), 100)}"; the person ruled it ${kind}.`;
  const instead = correction.chose_instead === undefined ? "" : ` Instead: "${clip(oneLine(correction.chose_instead), 120)}".`;
  const tail = ` [${target}; correction ${correction.id}]`;
  const room = MEMORY_MAX_CHARS - head.length - instead.length - tail.length - " Because: .".length;
  const text = `${head}${instead} Because: ${clip(oneLine(correction.because), Math.max(room, 20))}.${tail}`;
  return clip(text, MEMORY_MAX_CHARS);
}

export type CcmemCallResult =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "refused"; detail: string }
  | { kind: "failed"; detail: string };

/** One `ccmem orca-correction <verb>` with one JSON object on stdin. Exit 0 ok, 64 refused (do not resend), anything else failed. */
export function callCcmemCorrection(bin: string, env: NodeJS.ProcessEnv, cwd: string, verb: "upsert" | "withdraw", input: object, timeoutMs = CCMEM_CORRECTION_TIMEOUT_MS): Promise<CcmemCallResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile(bin, ["orca-correction", verb], { cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error === null) {
          try {
            const body = JSON.parse(String(stdout)) as unknown;
            if (typeof body === "object" && body !== null && !Array.isArray(body)) { resolve({ kind: "ok", body: body as Record<string, unknown> }); return; }
          } catch { /* below */ }
          resolve({ kind: "failed", detail: `ccmem orca-correction ${verb}: stdout is not one JSON object` });
          return;
        }
        const code = (error as { code?: unknown }).code;
        const detail = clip(`ccmem orca-correction ${verb} exited ${String(code ?? error.signal ?? "unknown")}: ${String(stderr).trim() || error.message}`, DETAIL_CHARS);
        resolve(code === 64 ? { kind: "refused", detail } : { kind: "failed", detail });
      });
    } catch (error) {
      resolve({ kind: "failed", detail: clip(`ccmem orca-correction ${verb}: ${(error as Error).message}`, DETAIL_CHARS) });
      return;
    }
    child.stdin?.end(JSON.stringify(input));
  });
}

export interface CorrectionExporterDeps {
  ccmemBin: string;
  env: NodeJS.ProcessEnv;
  correctionsDir: string;
  /** readCorrectionList, bound to the control store and the panel's repositories. */
  listCorrections: () => Promise<CorrectionListItemV1[]>;
  /** The repository path of a configured repoId, or null. */
  repositoryPath: (repoId: string) => string | null;
  now?: () => number;
  /** Test seam; the real call by default. */
  call?: typeof callCcmemCorrection;
  log?: (line: string) => void;
}

export interface PassResult { upserted: string[]; withdrawn: string[]; refused: string[]; failed: string[] }

/** The decision row `decisionId` names at `ref`, or null (a pending target, an unreadable ref, a row not there). */
async function correctedDecision(repo: string, ref: string, decisionId: string | undefined): Promise<CorrectedDecision | null> {
  if (decisionId === undefined) return null;
  const lines = await readLedgerAtRef(repo, ref).catch(() => null);
  const row = lines?.find(({ value }) => typeof value === "object" && value !== null && (value as { ev?: unknown }).ev === "decision" && (value as { id?: unknown }).id === decisionId)?.value as { question?: unknown; chose?: unknown } | undefined;
  return typeof row?.question === "string" && typeof row.chose === "string" ? { question: row.question, chose: row.chose } : null;
}

/**
 * One pass over every correction, one ccmem call at a time (ccmem takes its write lock per call). The file is written
 * after each call, so a crash loses at most the one row, and re-sending it is idempotent on ccmem's side.
 */
export async function exportCorrectionsPass(deps: CorrectionExporterDeps): Promise<PassResult> {
  const now = deps.now ?? Date.now;
  const call = deps.call ?? callCcmemCorrection;
  const result: PassResult = { upserted: [], withdrawn: [], refused: [], failed: [] };
  const file = await readExports(deps.correctionsDir);
  for (const item of await deps.listCorrections()) {
    const id = item.correction.id;
    // Flow engine spec §13.1 [BC-B7]: a `dir:` project has no remote identity ccmem could key it by; skipped by name.
    if (isDirProjectKey(item.correction.projectKey)) continue;
    const row = file.rows[id];
    const repo = item.repoId === null ? null : deps.repositoryPath(item.repoId);
    if (repo === null || !isAbsolute(repo)) continue;
    const retryLater = row?.state === "failed" && row.nextAttemptAt > now();
    let outcome: { verb: "upsert" | "withdraw"; sha: string; answer: CcmemCallResult } | null = null;
    if (item.withdrawn !== null) {
      // Only what was (or may have been) written is withdrawn: a refused or never-sent correction holds nothing in ccmem; a
      // failed upsert may still have committed (a timeout after ccmem's COMMIT), so it is withdrawn too.
      const wrote = row?.state === "exported" || row?.state === "failed";
      if (!wrote || retryLater) continue;
      outcome = { verb: "withdraw", sha: "", answer: await call(deps.ccmemBin, deps.env, repo, "withdraw", { version: 1, id }) };
    } else if (item.closed.state === "closed") {
      const content = correctionMemoryText(item.correction, await correctedDecision(repo, item.closed.ref, item.correction.decisionId));
      const sha = sha256(content);
      if ((row?.state === "exported" || row?.state === "refused") && row.sha256 === sha) continue;
      if (retryLater && row?.state === "failed" && row.sha256 === sha) continue;
      outcome = { verb: "upsert", sha, answer: await call(deps.ccmemBin, deps.env, repo, "upsert", { version: 1, id, content }) };
    } else continue;
    const at = now();
    const { verb, sha, answer } = outcome;
    if (answer.kind === "ok") {
      if (verb === "withdraw") { file.rows[id] = { state: "withdrawn", at }; result.withdrawn.push(id); }
      else { file.rows[id] = { state: "exported", sha256: sha, memoryId: typeof answer.body.memoryId === "number" ? answer.body.memoryId : null, at }; result.upserted.push(id); }
    } else if (answer.kind === "refused" && verb === "upsert") {
      file.rows[id] = { state: "refused", sha256: sha, detail: answer.detail, at }; result.refused.push(id);
      deps.log?.(`orca-ccmem: correction ${id} refused by ccmem: ${answer.detail}\n`);
    } else {
      const attempts = (row?.state === "failed" ? row.attempts : 0) + 1;
      const previousSha = row?.state === "exported" || row?.state === "refused" || row?.state === "failed" ? row.sha256 : "";
      file.rows[id] = { state: "failed", sha256: verb === "upsert" ? sha : previousSha, detail: answer.detail, at, attempts,
        nextAttemptAt: at + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS), withdraw: verb === "withdraw" || (row?.state === "failed" && row.withdraw) };
      result.failed.push(id);
      deps.log?.(`orca-ccmem: correction ${id} ${verb} failed (attempt ${attempts}): ${answer.detail}\n`);
    }
    await writeExports(deps.correctionsDir, file);
  }
  return result;
}

/** At most one pass in flight and one per PASS_INTERVAL_MS; `maybeRun` never throws and is never awaited by the pump. */
export function createCorrectionExporter(deps: CorrectionExporterDeps, intervalMs = PASS_INTERVAL_MS): { maybeRun(): Promise<PassResult | null> } {
  const now = deps.now ?? Date.now;
  let inFlight: Promise<PassResult | null> | null = null;
  let lastStart = -Infinity;
  return {
    maybeRun() {
      if (inFlight !== null || now() - lastStart < intervalMs) return Promise.resolve(null);
      lastStart = now();
      inFlight = exportCorrectionsPass(deps).catch((error: unknown) => {
        deps.log?.(`orca-ccmem: correction export pass failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return null;
      }).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
