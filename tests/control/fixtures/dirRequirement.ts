/**
 * Dir-requirements spec §5-§6 (plan Task 2): a requirement on a registered `dir` project. The requirement harness with a
 * plain folder registered as the dir project "repo" (`dirProjectOf`), and the driver given its environment and the
 * panel's resolver (`flow-vault-<id>` → the vault, anything else → the folder, as controlAssembly.ts resolves). Rule 17:
 * HOME, ORCA_VAULT_DIR, ORCA_CONTROL_DIR and ORCA_PROJECTS_FILE are directories under the harness's temporary root, in
 * the env the driver is given and in process.env (so even a wrong default could not reach the real ~/.orca).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import { vaultPathOfRepoId } from "../../../src/flow/groups.js";
import { WebControlService } from "../../../src/control/webService.js";
import { requirementHarness, type QueuedAnswer } from "./requirementHarness.js";

export function writeTree(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** Every entry under `dir`: its path, mode and bytes (a symlink's target), so a single changed byte changes the digest. */
export function digestTree(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name), stat = lstatSync(path);
      hash.update(`${path}\0${stat.mode}\0`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
      else hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

export async function dirRequirementHarness(options: { answers: QueuedAnswer[]; startAt?: "none" | "split"; files?: Record<string, string> }) {
  const x = await requirementHarness({ answers: options.answers, startAt: options.startAt ?? "none" });
  const env: NodeJS.ProcessEnv = {
    HOME: join(x.root, "home"), ORCA_VAULT_DIR: join(x.root, "vaults"), ORCA_CONTROL_DIR: join(x.root, "control"), ORCA_PROJECTS_FILE: join(x.root, "projects.json"),
  };
  mkdirSync(env.HOME!, { mode: 0o700 });
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value!);
  const folder = join(x.root, "notes");
  writeTree(folder, options.files ?? { "README.md": "# Notes\nA note-taking tool.\n", "src/a.ts": "export const a = 1;\n" });
  x.deps.env = env;
  x.deps.resolveRepository = (repoId: string) => vaultPathOfRepoId(env, repoId) ?? folder;
  const service = new WebControlService({ ...x.service.deps, dirProjectOf: (repoId: string) => (repoId === "repo" ? { path: folder } : null) });
  const vaultGit = (vaultPath: string, args: string[]): string => execFileSync("git", ["--git-dir", vaultPath, ...args], { encoding: "utf8" }).trim();
  return {
    ...x, env, folder, service, vaultGit,
    /** requirement-open of group "r" on the dir project, as the Web sends it. */
    open: () => service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open-r", actorId: "human", expectedRevision: 0, verb: "requirement-open",
      target: { kind: "group", groupId: "r" }, payload: { groupId: "r", repoId: "repo", idea: "Let people export their notes as Markdown." } } as never),
    body: () => JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)) as Record<string, unknown>,
    dispose: async () => { vi.unstubAllEnvs(); await x.dispose(); },
  };
}
