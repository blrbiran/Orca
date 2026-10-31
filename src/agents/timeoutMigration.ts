import { lstat, readFile } from "node:fs/promises";
import { AGENTS_FILE_MODE, agentsTablePath } from "./paths.js";
import { replace, serializeLike } from "./versionRefresh.js";

/** The wall-clock limit `ccloop agents detect` drafted until 2026-10-21, and the one it drafts now. */
const OLD_DEFAULT_MS = 1_800_000;
const NEW_DEFAULT_MS = 7_200_000;

export const timeoutMigrationMarkerOf = (table: string): string => `${table}.bak-pre-2h-timeout`;

/**
 * Tester round 3 spec §4 (human ruling, session 4ed8eb65, Q2): an installation still on the old drafted 30 minutes moves to
 * 2 hours, once. Long execute phases were being killed at 30 minutes although the 10-minute idle watchdog now catches a call
 * that stopped working. `timeoutMs` is not in the configHash, so frozen groups resolve as before.
 *
 * User data outside any repository (Rule 17): the marker is a copy of the previous bytes (0600), written first whether or not
 * anything changes, and its existence means done -- a person who sets 30 minutes back by hand keeps it. The table keeps its
 * mode and layout. Writes only when the table parses and holds `installations`; a table it cannot read is left for the panel's
 * own reader to refuse.
 */
export async function migrateAgentTimeouts(env: { HOME?: string; ORCA_AGENTS_TABLE?: string }): Promise<string[]> {
  const table = agentsTablePath(env), marker = timeoutMigrationMarkerOf(table);
  if (await lstat(marker).then(() => true, () => false)) return [];
  const bytes = await readFile(table, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (bytes === null) return [];
  const parsed = JSON.parse(bytes) as { installations?: Record<string, { timeoutMs?: unknown }> };
  if (parsed.installations === undefined) return [];
  const moved = Object.entries(parsed.installations).filter(([, row]) => row.timeoutMs === OLD_DEFAULT_MS);
  await replace(marker, bytes, AGENTS_FILE_MODE);
  if (moved.length === 0) return [];
  for (const [, row] of moved) row.timeoutMs = NEW_DEFAULT_MS;
  await replace(table, serializeLike(bytes, parsed), (await lstat(table)).mode & 0o777);
  return moved.map(([id]) => id);
}
