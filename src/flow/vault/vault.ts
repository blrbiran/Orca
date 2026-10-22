/**
 * Flow engine spec §5.2 (H11) and §20 (Rule 17): the per-directory vault, a bare repository at
 * `$ORCA_VAULT_DIR/<sha256(NFC(realpath(dir)))>.git` created with `git init --bare --shared=0600`, so git itself keeps
 * every file it writes there 0600 and every directory 0700. The vault root is made 0700 when this creates it; an
 * existing one keeps the mode the person gave it. The vault's HEAD is never read: every ref is written with an
 * explicit value (snapshot.ts, compose.ts).
 *
 * Every git call here runs with QUIET_GIT and without any inherited GIT_* variable (workspace.ts): a hook, an fsmonitor
 * or a GIT_DIR in Orca's own environment must not act on the person's data.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { QUIET_GIT, unsetInheritedGitEnv } from "../../control/workspace.js";
import { git, gitBytes, type GitOptions } from "../../scheduler/gitExec.js";
import { vaultDir, vaultPathFor } from "./paths.js";

export interface Vault { path: string; dir: string }

/**
 * §5.2 default excludes, the vault's shared `info/exclude` (one vault per folder, shared by every run on it). A template's
 * `workspace.excludes` are the run's own (review finding I5): passed to each snapshot of that run, never written here.
 */
export const DEFAULT_EXCLUDES = [".git/", "node_modules/", ".DS_Store"];

/** Run git against the vault (and, with a work tree, the person's folder), quietly and without inherited GIT_* env. */
export function vaultGit(vault: Vault, args: string[], options: GitOptions & { workTree?: string } = {}): Promise<string> {
  const { workTree, ...rest } = options;
  return git(vault.path, gitArgs(vault, args, workTree), { ...rest, env: { ...unsetInheritedGitEnv(), ...rest.env } });
}
export function vaultGitBytes(vault: Vault, args: string[], options: GitOptions & { workTree?: string } = {}): Promise<Buffer> {
  const { workTree, ...rest } = options;
  return gitBytes(vault.path, gitArgs(vault, args, workTree), { ...rest, env: { ...unsetInheritedGitEnv(), ...rest.env } });
}
const gitArgs = (vault: Vault, args: string[], workTree: string | undefined): string[] =>
  [...QUIET_GIT, "--git-dir", vault.path, ...(workTree === undefined ? [] : ["--work-tree", workTree]), ...args];

/** mkdir -p where each directory this creates is chmod 0700 explicitly (never from umask); existing ones are left alone. */
export function makePrivateDirs(path: string): void {
  if (existsSync(path)) return;
  makePrivateDirs(dirname(path));
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return; throw error; }
  chmodSync(path, 0o700);
}

export async function openVault(env: NodeJS.ProcessEnv, dir: string): Promise<Vault> {
  const real = await realpath(dir);
  const root = vaultDir(env);
  makePrivateDirs(root);
  const path = await vaultPathFor(env, real);
  const vault: Vault = { path, dir: real };
  if (!existsSync(join(path, "HEAD"))) {
    await git(root, [...QUIET_GIT, "init", "-q", "--bare", "--shared=0600", path], { env: unsetInheritedGitEnv() });
    chmodSync(path, 0o700);
  }
  await vaultGit(vault, ["config", "core.precomposeUnicode", "true"]);
  const exclude = join(path, "info", "exclude");
  makePrivateDirs(dirname(exclude));
  writeFileSync(exclude, DEFAULT_EXCLUDES.map((line) => `${line}\n`).join(""), { mode: 0o600 });
  chmodSync(exclude, 0o600);
  return vault;
}
