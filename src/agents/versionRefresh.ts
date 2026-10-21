import { createHash, randomBytes } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { AgentObservation } from "../control/agentInstallationProtocol.js";
import { AGENTS_FILE_MODE } from "./paths.js";

/**
 * Agent version auto-refresh spec 2026-10-20 §3.1 (human ruling, session 308b874c: 「组跑到一半遇到 agent 升级 =>
 * 直接用新版本继续」). Records the versions ccloop's own probe observed (`control agent-installation-observe`) into the
 * agents table, so an upgraded CLI stops being refused as agent-version-drift. Only `installations.<id>.version` ever
 * changes: it is not in the configHash, so a frozen group resolves to the same hash afterwards.
 *
 * User data outside any repository (Rule 17, spec §4): the existing table keeps its mode and layout; the previous
 * bytes go to `<table>.bak-auto` (0600, one rolling copy); every write is a temp file beside the target, renamed over
 * it. Orca has no lock for user files, so the table is re-read just before the rename and the work starts over on
 * bytes another writer changed (and refreshes in this process are serialized, below).
 */
export interface VersionRefreshRow { id: string; recorded: string; observed: string | null; outcome: "updated" | "unchanged" | "unavailable" }
export interface VersionRefresh { rows: VersionRefreshRow[]; observation: AgentObservation }

/** ccloop's probe pattern (src/agents/versionProbe.ts), anchored: anything else is not a version to record. */
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const ATTEMPTS = 3;
export const backupPathOf = (table: string): string => `${table}.bak-auto`;

type Table = { installations: Record<string, { version?: unknown }> };

/** The table's own layout: one line stays one line, else the indent of its first nested line; trailing whitespace kept. */
function serializeLike(original: string, value: unknown): string {
  const body = original.trimEnd(), trailing = original.slice(body.length);
  const indent = body.includes("\n") ? (/\n([ \t]+)\S/.exec(body)?.[1] ?? "  ") : undefined;
  return `${JSON.stringify(value, null, indent)}${trailing}`;
}

/** The temp naming `orca agent init` already cleans up (command.ts), so a crash's leftover has one known owner. */
async function writeBeside(target: string, bytes: string, mode: number): Promise<string> {
  const temp = join(dirname(target), `.${basename(target)}.orca-agents-${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(temp, "wx", mode);
  try {
    await handle.chmod(mode);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return temp;
}

async function replace(target: string, bytes: string, mode: number): Promise<void> {
  const temp = await writeBeside(target, bytes, mode);
  try { await rename(temp, target); } catch (error) { await unlink(temp).catch(() => undefined); throw error; }
}

/**
 * One refresh of a table at a time in this process: the panel resolves several selections at once, and two drift
 * refusals arriving together would otherwise both pass the re-read before either renamed, losing one update.
 * Another process (a second panel, `orca agent refresh`) is still met only by the re-read before the rename.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function recordObservedVersions(
  tablePath: string,
  observation: AgentObservation,
  only?: string,
  hooks: { beforeRename?: () => Promise<void> } = {},
): Promise<VersionRefresh> {
  const prior = inFlight.get(tablePath) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(() => record(tablePath, observation, only, hooks));
  inFlight.set(tablePath, next);
  void next.catch(() => undefined).then(() => { if (inFlight.get(tablePath) === next) inFlight.delete(tablePath); });
  return next;
}

async function record(tablePath: string, observation: AgentObservation, only: string | undefined, hooks: { beforeRename?: () => Promise<void> }): Promise<VersionRefresh> {
  const scope = observation.installed.filter((row) => only === undefined || row.id === only);
  const observed = new Map(scope.map((row) => [row.id, row.observedVersion !== null && VERSION.test(row.observedVersion) ? row.observedVersion : null]));
  for (let attempt = 1; ; attempt += 1) {
    const bytes = await readFile(tablePath, "utf8");
    const table = JSON.parse(bytes) as Table;
    const rows: VersionRefreshRow[] = [];
    let changed = false;
    for (const [id, seen] of observed) {
      const row = Object.hasOwn(table.installations, id) ? table.installations[id] : undefined;
      if (row === undefined || typeof row.version !== "string") continue;
      const recorded = row.version;
      if (seen === null) rows.push({ id, recorded, observed: null, outcome: "unavailable" });
      else if (seen === recorded) rows.push({ id, recorded, observed: seen, outcome: "unchanged" });
      else { row.version = seen; changed = true; rows.push({ id, recorded, observed: seen, outcome: "updated" }); }
    }
    const after = changed ? serializeLike(bytes, table) : bytes;
    if (changed) {
      const mode = (await lstat(tablePath)).mode & 0o777;
      const temp = await writeBeside(tablePath, after, mode);
      try {
        await hooks.beforeRename?.();
        if ((await readFile(tablePath, "utf8")) !== bytes) {
          await unlink(temp);
          if (attempt < ATTEMPTS) continue;
          throw new Error(`orca agents: ${tablePath} kept changing while its versions were being recorded`);
        }
        await replace(backupPathOf(tablePath), bytes, AGENTS_FILE_MODE);
        await rename(temp, tablePath);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
    }
    return { rows, observation: describe(observation, JSON.parse(after) as Table, after) };
  }
}

/** The observation re-stated against the table as it is now: same probe answers, current recorded versions. */
function describe(observation: AgentObservation, table: Table, bytes: string): AgentObservation {
  return {
    ...observation,
    baseTableHash: createHash("sha256").update(bytes).digest("hex"),
    installed: observation.installed.map((row) => {
      const version = table.installations[row.id]?.version;
      const recordedVersion = typeof version === "string" ? version : row.recordedVersion;
      return { ...row, recordedVersion, status: row.observedVersion === null ? "unavailable" : row.observedVersion === recordedVersion ? "current" : "changed" };
    }),
  };
}
