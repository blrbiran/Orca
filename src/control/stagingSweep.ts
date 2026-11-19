/**
 * Tester #364 (b): `<stateDir>/staging` holds an artifact publication's temp files and staged directories (archive.ts
 * `writeArtifact`, `archiveFile`, `publish`; snapshot.ts bundles and blobs). Each publication removes its own in a
 * `finally` (#364 a), which a killed process never runs, so what a SIGKILL left stayed for ever. This removes every
 * entry. It is called only by openControlStore once the store's service lock is this process's (store.ts), so no live
 * operation can own an entry: staging is written only through an open store, a second open of the same state directory
 * is refused while one is open, and a previous owner is proved dead before its lock is retired.
 *
 * Only inside `<stateDir>/staging`: a staging that is not a real directory (a symlink included) is not touched, and an
 * entry is removed with `rmSync`, which removes a symlink itself, never what it points to. Bounded: at most `maxEntries`
 * entries per start; the rest are counted and left for the next. An entry that cannot be removed is counted and left, and
 * a staging that cannot be read is reported, never thrown: the sweep never keeps the panel from starting.
 * Registered per Rule 17 in the issue-fixes spec's Correction (2026-11-19, session 3ba26002).
 */
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface StagingSweep { removed: number; bytes: number; left: number; failed: number; skipped: "staging-not-a-directory" | "staging-unreadable" | null }
export const STAGING_SWEEP_MAX_ENTRIES = 100_000;

/** Bytes of the regular files under `path`, never following a symlink (a link counts 0). */
function bytesOf(path: string): number {
  const stat = lstatSync(path);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return readdirSync(path).reduce((sum, name) => sum + bytesOf(join(path, name)), 0);
}

export function sweepStaging(stateDir: string, maxEntries = STAGING_SWEEP_MAX_ENTRIES): StagingSweep {
  const staging = join(stateDir, "staging");
  const none: StagingSweep = { removed: 0, bytes: 0, left: 0, failed: 0, skipped: null };
  let names: string[];
  try {
    const stat = lstatSync(staging);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { ...none, skipped: "staging-not-a-directory" };
    names = readdirSync(staging).sort();
  } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? none : { ...none, skipped: "staging-unreadable" }; }
  const result = { ...none };
  for (const name of names.slice(0, maxEntries)) {
    const path = join(staging, name);
    try {
      const bytes = bytesOf(path);
      rmSync(path, { recursive: true, force: true });
      result.removed += 1; result.bytes += bytes;
    } catch { result.failed += 1; }
  }
  result.left = names.length - result.removed - result.failed;
  return result;
}

/** The one stderr line the panel writes at start when the sweep did anything; null when there was nothing to say. */
export function stagingSweepLine(staging: string, sweep: StagingSweep): string | null {
  if (sweep.skipped !== null) return `orca-panel: ${staging} ${sweep.skipped === "staging-unreadable" ? "could not be read" : "is not a directory"}; it was not swept\n`;
  if (sweep.removed === 0 && sweep.failed === 0 && sweep.left === 0) return null;
  return `orca-panel: removed ${sweep.removed} entr${sweep.removed === 1 ? "y" : "ies"} (${sweep.bytes} bytes) an interrupted archive left in ${staging}`
    + `${sweep.failed > 0 ? `; ${sweep.failed} could not be removed` : ""}${sweep.left > 0 ? `; ${sweep.left} left for the next start` : ""}\n`;
}
