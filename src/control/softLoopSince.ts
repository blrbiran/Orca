/**
 * Spec 2026-11-06 soft-mode loop run settlement §3.6 (human's answer Q1: runs blocked before the release are left for a
 * person). A leaf module, imported by the panel assembly, the pass and the run view, with no runtime imports (the
 * import-cycle rule of session 86352010).
 */
import type { ControlStore } from "./store.js";

const KEY = "softLoopSince";

/** Written once, when the panel first assembles on this version; a later start keeps the first value. */
export function recordSoftLoopSince(store: ControlStore, at: number): void {
  store.db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)").run(KEY, String(at));
}

/** The cutoff, or null when this version never started on the store (then no loop run is settled automatically). */
export function softLoopSince(store: ControlStore): number | null {
  const row = store.db.prepare("SELECT value FROM meta WHERE key=?").get(KEY);
  const at = row === undefined ? NaN : Number(row.value);
  return Number.isSafeInteger(at) ? at : null;
}

/** The deterministic id of orca-auto's one `settle-approximate-usage` command for a run's generation; its row is the record. */
export const approximateCommandId = (runId: string, generation: number): string => `orca-auto-approximate-${runId}-${generation}`;
