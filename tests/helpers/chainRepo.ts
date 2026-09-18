import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";
import { tempRepo } from "./tempRepo.js";

export const ORCA_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A throwaway target for `orca chain`: a committed .gitignore (chain logs; `node_modules` WITHOUT a trailing slash,
 * because the symlink below is not a directory to git — measured at 96cae2b; and settings.local.json, which a global
 * ignore hides on the person's machine, spec §9), a committed .orca/chain.json and .orca/level.json, node_modules
 * symlinked back here (always: the preflight wants node_modules/.bin/tsx), and with `gate: true` this checkout's own
 * gate wiring — .claude/settings.json, scripts/gate-prefilter.mjs and a COPY of src/ (git refuses a pathspec beyond a
 * symlink, so src/ cannot be one).
 *
 * The model is `orca-fake-model` (given a window in level.json) on purpose: a safety net. If a mutation or a bug ever
 * let a criterion reach the real `claude` instead of the fake one, the session fails on the model name before any
 * token is spent.
 */
export const FAKE_MODEL = "orca-fake-model";
export async function makeChainRepo(opts: { gate: boolean; model?: string }): Promise<{ path: string; cleanup(): Promise<void> }> {
  const path = await tempRepo();
  await writeFile(join(path, ".gitignore"), ".orca/chain-logs/\nnode_modules\n.claude/settings.local.json\n");
  await mkdir(join(path, ".orca"), { recursive: true });
  await writeFile(join(path, ".orca", "chain.json"), `${JSON.stringify({ model: opts.model ?? FAKE_MODEL })}\n`);
  await writeFile(join(path, ".orca", "level.json"), `${JSON.stringify({ windows: { [FAKE_MODEL]: 200_000 } })}\n`);
  if (opts.gate) {
    await mkdir(join(path, ".claude"));
    await cp(join(ORCA_ROOT, ".claude", "settings.json"), join(path, ".claude", "settings.json"));
    await mkdir(join(path, "scripts"));
    await cp(join(ORCA_ROOT, "scripts", "gate-prefilter.mjs"), join(path, "scripts", "gate-prefilter.mjs"));
    await cp(join(ORCA_ROOT, "src"), join(path, "src"), { recursive: true });
  }
  // Always: the preflight refuses a target without node_modules/.bin/tsx (plan PC-23). Ignored by the .gitignore above.
  await symlink(join(ORCA_ROOT, "node_modules"), join(path, "node_modules"));
  await git(path, ["add", "-A"]);
  await git(path, [...ORCA_IDENTITY, "commit", "-q", "-m", "chain fixture"]);
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
