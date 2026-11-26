import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Issue #366: run directories and workspaces are named after the run id (`run-<uuid>`, workspace.ts), and every other
 * leaf of the two roots -- `landing-<runId>`, `check-<runId>`, `skills-<runId>`, a scratch directory -- is not. A run
 * directory is therefore recognised by this name alone, never by position or by following anything.
 */
export const RUN_DIRECTORY = /^run-[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const isRunDirectoryName = (name: string): boolean => RUN_DIRECTORY.test(name);

export interface DirectorySize { bytes: number; truncated: boolean }

/**
 * Logical file bytes under `root`, counted once per inode, without following symbolic links. Reclaim mode includes
 * an inode only when every link is in this candidate. The estimate can undercount across removal candidates and
 * does not measure physical allocation, sparse extents or filesystem clones.
 * `limit` bounds the entries visited so a runaway tree cannot make the command hang: a truncated answer undercounts,
 * which is a reporting fact only -- the caller never decides to delete from a size.
 */
export async function directorySize(root: string, limit = 500_000, { reclaim = false }: { reclaim?: boolean } = {}): Promise<DirectorySize> {
  let rootStat;
  try { rootStat = await lstat(root); } catch { return { bytes: 0, truncated: false }; }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return { bytes: 0, truncated: false };
  let bytes = 0, seen = 0;
  // GC counts a shared inode only once it sees its last link within this removal candidate.
  const links = new Map<string, number>();
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      seen += 1;
      if (seen > limit) return { bytes, truncated: true };
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(path); continue; }
      if (!entry.isFile()) continue;
      try {
        const stat = await lstat(path, { bigint: true });
        if (!stat.isFile()) continue;
        if (stat.nlink <= 1n) { bytes += Number(stat.size); continue; }
        const inode = `${stat.dev}:${stat.ino}`;
        const count = (links.get(inode) ?? 0) + 1;
        links.set(inode, count);
        if (reclaim ? BigInt(count) === stat.nlink : count === 1) bytes += Number(stat.size);
      } catch { /* vanished between readdir and lstat */ }
    }
  }
  return { bytes, truncated: false };
}

export interface RunDirectory { name: string; path: string; mtimeMs: number }

/** The direct children of `root` named after a run; a missing root has none. Symbolic links are never followed. */
export async function runDirectories(root: string): Promise<RunDirectory[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const found: RunDirectory[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isRunDirectoryName(entry.name)) continue;
    const path = join(root, entry.name);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      found.push({ name: entry.name, path, mtimeMs: stat.mtimeMs });
    } catch { /* vanished */ }
  }
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

/** A person-readable size (`du -sh` shape), from a byte count. */
export function formatBytes(bytes: number): string {
  const units = ["B", "K", "M", "G", "T"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return unit === 0 ? `${value}B` : `${value.toFixed(1)}${units[unit]}`;
}