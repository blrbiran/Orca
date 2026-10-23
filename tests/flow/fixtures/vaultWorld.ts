/**
 * Flow engine spec §5.2–§5.4 criteria (plan Task 6): a person's folder and its vault under one temporary root, with
 * ORCA_VAULT_DIR redirected there (Rule 17), and step outputs made by plumbing the way a landed child would leave them
 * (a commit whose parent is the base it started from).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openVault, type Vault } from "../../../src/flow/vault/vault.js";

export const gv = (vault: Vault, args: string[], input?: string): string =>
  execFileSync("git", ["--git-dir", vault.path, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", ...(input === undefined ? {} : { input }) }).trim();

export async function vaultWorld(files: Record<string, string> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flow-vault-")));
  const folder = join(root, "articles");
  mkdirSync(folder);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
  // Rule 17 (Task 9 fix round 2, O1): this world's own control root (0700), so nothing resolves to the real ~/.orca.
  const controlDir = join(root, "flow-control");
  mkdirSync(controlDir, { mode: 0o700 });
  chmodSync(controlDir, 0o700);
  const env: NodeJS.ProcessEnv = { ORCA_VAULT_DIR: join(root, "vaults"), ORCA_CONTROL_DIR: controlDir };
  const vault = await openVault(env, folder);
  /** A commit on `parent` with these paths set (string) or removed (null): a step's landed output. */
  const stepCommit = (parent: string, changes: Record<string, string | null>): string => {
    const index = join(root, `index-${Math.random().toString(36).slice(2)}`);
    const env2 = { ...process.env, GIT_INDEX_FILE: index };
    const run = (args: string[], input?: string): string => execFileSync("git", ["--git-dir", vault.path, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", env: env2, ...(input === undefined ? {} : { input }) }).trim();
    run(["read-tree", parent]);
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) { run(["update-index", "--index-info"], `0 ${"0".repeat(40)}\t${path}\n`); continue; }
      const blob = run(["hash-object", "-w", "--stdin"], content);
      run(["update-index", "--add", "--replace", "--cacheinfo", `100644,${blob},${path}`]);
    }
    return run(["commit-tree", run(["write-tree"]), "-p", parent, "-m", "step"]);
  };
  const show = (commit: string, path: string): string | null => {
    try { return execFileSync("git", ["--git-dir", vault.path, "show", `${commit}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return null; }
  };
  return { root, folder, env, vault, stepCommit, show };
}
