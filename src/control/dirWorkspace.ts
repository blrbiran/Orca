/**
 * Dir-requirements spec §4.1: the folder workspace, one folder ↔ one vault. The only code that turns a dir group's
 * frozen `{ dir, vaultId }` into vault operations, built on the flow engine's vault primitives (`src/flow/vault/*`).
 *
 * Every function takes the frozen workspace and explicit refs and commits as arguments and never reads a group body, so
 * a group with several folders (the multi-dir spec, H7) calls it once per folder.
 */
import { realpath, stat } from "node:fs/promises";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import { snapshotDrift, treeWith } from "../flow/vault/drift.js";
import { vaultKeyOf } from "../flow/vault/paths.js";
import { DEFAULT_CAPS, importSnapshot } from "../flow/vault/snapshot.js";
import { openVault, vaultGit, type Vault } from "../flow/vault/vault.js";

/** The group body's `dirWorkspace` (§5.1): the folder's NFC real path when the requirement was opened, and its vault key. */
export interface FrozenDirWorkspace { readonly dir: string; readonly vaultId: string }
export interface DirWorkspace { readonly frozen: FrozenDirWorkspace; readonly vault: Vault }

/**
 * §10: every dir-group snapshot leaves the folder's own `.decisions/` out; the group's ledger lives in the vault. Anchored
 * at the folder's root, where the ledger is (`.decisions/<runId>.jsonl`): a `.decisions/` deeper down is the person's.
 */
export const DIR_EXCLUDES: readonly string[] = ["/.decisions/"];
const DECISIONS = ".decisions";

/** §9.3: the frozen folder is gone, moved, or no longer a directory at that real path. */
export class DirFolderMissing extends Error {
  readonly code = "dir-folder-missing";
  constructor(readonly dir: string, why: string) {
    super(`${dir}: ${why}`);
    this.name = "DirFolderMissing";
  }
}

/**
 * §5.1: the frozen workspace for a dir project's folder, at requirement-open. The same `realpath` `openVault` uses, NFC,
 * and that path's vault key, so any spelling of the folder names the vault a flow run on it names. A read only: no
 * vault is created here.
 */
export async function freezeDirWorkspace(path: string): Promise<FrozenDirWorkspace> {
  let real: string;
  try { real = await realpath(path); }
  catch (error) { throw new DirFolderMissing(path, (error as NodeJS.ErrnoException).code ?? String(error)); }
  if (!(await stat(real)).isDirectory()) throw new DirFolderMissing(path, "not a directory");
  const dir = real.normalize("NFC");
  return { dir, vaultId: vaultKeyOf(dir) };
}

export async function openDirWorkspace(env: NodeJS.ProcessEnv, frozen: FrozenDirWorkspace): Promise<DirWorkspace> {
  let real: string;
  try { real = await realpath(frozen.dir); }
  catch (error) { throw new DirFolderMissing(frozen.dir, (error as NodeJS.ErrnoException).code ?? String(error)); }
  if (real.normalize("NFC") !== frozen.dir.normalize("NFC")) throw new DirFolderMissing(frozen.dir, `now resolves to ${real}`);
  if (!(await stat(real)).isDirectory()) throw new DirFolderMissing(frozen.dir, "not a directory");
  // A frozen record whose vault key is not its folder's is broken, not a moved folder (Rule 12: loud).
  if (vaultKeyOf(real) !== frozen.vaultId) throw new Error(`orca: the frozen vault id ${frozen.vaultId} is not the vault of ${frozen.dir}`);
  return { frozen, vault: await openVault(env, frozen.dir) };
}

/**
 * §6.1/§6.2: an import of the folder (its `.decisions/` left out). With `reuseUnchanged`, the newest import when the
 * folder's tree is unchanged; with `baseRef`, that ref is written create-only and an existing one is the answer.
 */
export async function importFolder(ws: DirWorkspace, opts: { reuseUnchanged: boolean; baseRef: string | null }): Promise<{ commit: string }> {
  const { commit } = await importSnapshot(ws.vault, ws.frozen.dir, { baseRef: opts.baseRef, reuseUnchanged: opts.reuseUnchanged, caps: DEFAULT_CAPS, excludes: DIR_EXCLUDES });
  return { commit };
}

/** §9.2: the folder's paths that differ from a folder commit (same excludes), with the drift commit; null when none. */
export function folderDrift(ws: DirWorkspace, folderCommit: string): Promise<{ commit: string; paths: string[] } | null> {
  return snapshotDrift(ws.vault, ws.frozen.dir, folderCommit, DEFAULT_CAPS, DIR_EXCLUDES);
}

const lsNames = async (vault: Vault, commit: string, path: string): Promise<string[]> =>
  (await vaultGit(vault, ["ls-tree", "-r", "-z", "--name-only", commit, "--", path])).split("\0").filter((p) => p.length > 0);

/**
 * §8.2/§8.5 step 5: the folder commit for a work-branch tip. `tip`'s tree with every path under `.decisions/` and every
 * path in `keepFromPlaced` (the requirement document, the withheld paths) taken from `placed` (removed where `placed`
 * has none); parent `placed`, message `orca: place <groupId>`, Orca's identity. `differs`: the paths whose entry differs
 * between `tip` and the folder commit, in git's (byte) order.
 */
export async function nextFolderCommit(ws: DirWorkspace, input: { groupId: string; tip: string; placed: string; keepFromPlaced: readonly string[] }): Promise<{ commit: string; differs: string[] }> {
  const own = new Set([...await lsNames(ws.vault, input.tip, DECISIONS), ...await lsNames(ws.vault, input.placed, DECISIONS), ...input.keepFromPlaced]);
  const tree = await treeWith(ws.vault, input.tip, input.placed, [...own]);
  const commit = (await vaultGit(ws.vault, [...ORCA_IDENTITY, "commit-tree", tree, "-p", input.placed, "-m", `orca: place ${input.groupId}`])).trim();
  const differs = (await vaultGit(ws.vault, ["diff-tree", "-r", "-z", "--no-renames", "--name-only", input.tip, commit])).split("\0").filter((p) => p.length > 0);
  return { commit, differs };
}
