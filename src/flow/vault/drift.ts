/**
 * Flow engine spec §5.4 [IR-I6]: the person's drift. Before each execution code snapshots the folder; the paths that
 * differ from the flow head are the drift. It is placed at the earliest step (template order) whose active output wrote
 * any drifted path, else at the start, and committed onto that step's active output as a person-authored execution, so
 * the next composition holds it and the planner sees it as an `edit` (§7.2).
 *
 * A path the snapshot left out (over a cap, or not a regular file or link) is not drift: the folder still has it, the
 * snapshot only could not take it. Nor is a path the snapshot does not list at all while the folder still has it -- one
 * the vault's or the folder's ignore rules now exclude: only a path gone from the folder is a deletion.
 */
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORCA_IDENTITY } from "../../scheduler/gitExec.js";
import { DEFAULT_CAPS, snapshotTree, type SnapshotCaps } from "./snapshot.js";
import { vaultGit, type Vault } from "./vault.js";

const nfc = (path: string): string => path.normalize("NFC");

async function changedPaths(vault: Vault, from: string, to: string): Promise<string[]> {
  return (await vaultGit(vault, ["diff-tree", "-r", "-z", "--no-renames", "--name-only", from, to])).split("\0").filter((p) => p.length > 0);
}

/** `onto`'s tree with `paths` taken from `source` (removed where `source` has none). */
export async function treeWith(vault: Vault, onto: string, source: string, paths: readonly string[]): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "orca-vault-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    await vaultGit(vault, ["read-tree", onto], { env });
    for (const path of paths) {
      const entry = (await vaultGit(vault, ["ls-tree", "-z", source, "--", path])).split("\0")[0] ?? "";
      // ls-tree's own line is an --index-info line; mode 0 removes the path.
      const line = entry.length === 0 ? `0 ${"0".repeat(40)}\t${path}` : entry;
      await vaultGit(vault, ["update-index", "-z", "--index-info"], { env, input: `${line}\0` });
    }
    return (await vaultGit(vault, ["write-tree"], { env })).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function snapshotDrift(vault: Vault, dir: string, head: string, caps: SnapshotCaps = DEFAULT_CAPS, excludes: readonly string[] = []): Promise<{ commit: string; paths: string[] } | null> {
  const snap = await snapshotTree(vault, dir, caps, excludes);
  const left = new Set([...snap.overCap, ...snap.excluded]);
  const paths: string[] = [];
  for (const path of await changedPaths(vault, head, snap.tree)) {
    if (left.has(path)) continue;
    const taken = (await vaultGit(vault, ["ls-tree", "-z", "--name-only", snap.tree, "--", path])).length > 0;
    if (!taken && await present(join(dir, path))) continue;
    paths.push(path);
  }
  if (paths.length === 0) return null;
  const tree = await treeWith(vault, head, snap.tree, paths);
  const commit = (await vaultGit(vault, [...ORCA_IDENTITY, "commit-tree", tree, "-p", head, "-m", "orca: drift"])).trim();
  return { commit, paths };
}

async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return false; throw error; }
}

/** The earliest step in template order whose active output wrote any drifted path, else `start`. */
export function placeDrift(paths: readonly string[], activeOutputs: ReadonlyArray<{ stepKey: string; paths: readonly string[] }>): string {
  const drifted = new Set(paths.map(nfc));
  return activeOutputs.find((output) => output.paths.some((path) => drifted.has(nfc(path))))?.stepKey ?? "start";
}

/**
 * The person-authored execution: the step's active output with the drifted paths as the person left them. `message` is
 * the commit message (dir-requirements §9.2 gives its folder commit the attribution trailers).
 */
export async function commitDriftOnto(vault: Vault, onto: string, drift: string, paths: readonly string[], message = "orca: person edit"): Promise<string> {
  const tree = await treeWith(vault, onto, drift, paths);
  return (await vaultGit(vault, [...ORCA_IDENTITY, "commit-tree", tree, "-p", onto, "-F", "-"], { input: message })).trim();
}
