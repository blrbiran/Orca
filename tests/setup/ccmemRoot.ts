import { existsSync, readdirSync } from "node:fs";

/** Entry names of a ccmem data root, sorted; null when there is no such directory. Reads names only, never opens a file. */
export function ccmemRootNames(root: string): string[] | null {
  if (!existsSync(root)) return null;
  return readdirSync(root).sort();
}

const BACKUP = /^global\.db(-wal)?\.bak\./;

/**
 * Spec §10 D2: only the changes Orca could cause and ccmem's live writers would not. A new migration backup means a
 * migration ran; `global.db` vanishing means something deleted the database; a root from nothing means a ccmem was
 * started against it. Everything else (daemon.wake, -wal, -shm, logs) is ccmem's own business and is not compared.
 */
export function ccmemRootDiff(before: string[] | null, after: string[] | null): string[] {
  if (before === null) return after === null ? [] : ["data root created where there was none"];
  if (after === null) return before.includes("global.db") ? ["global.db disappeared"] : [];
  const had = new Set(before);
  const out = after.filter((name) => BACKUP.test(name) && !had.has(name)).map((name) => `new migration backup: ${name}`);
  if (had.has("global.db") && !after.includes("global.db")) out.push("global.db disappeared");
  return out;
}
