import { chmodSync, copyFileSync, renameSync, rmSync, statSync, truncateSync } from "node:fs";

export const LOG_MAX_BYTES = 10 * 1024 * 1024;
export const LOG_KEEP = 3;

/** Spec §6, plan D11: copy-truncate, because launchd holds descriptors it opened before the panel ran. */
export function rotateLogs(files: string[], opts: { maxBytes: number; keep: number }): void {
  for (const file of files) {
    let size: number;
    try { size = statSync(file).size; } catch { continue; }
    if (size <= opts.maxBytes) continue;
    rmSync(`${file}.${opts.keep}`, { force: true });
    for (let n = opts.keep - 1; n >= 1; n -= 1) {
      try { renameSync(`${file}.${n}`, `${file}.${n + 1}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    copyFileSync(file, `${file}.1`);
    chmodSync(`${file}.1`, 0o600);
    truncateSync(file, 0);
  }
}
