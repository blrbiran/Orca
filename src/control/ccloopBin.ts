import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * ccloop as a locked dependency (human ruling 2026-09-29, plan docs/superpowers/plans/2026-09-29-ccloop-git-dependency.md):
 * Orca's package.json is meant to pin ccloop to a commit by git URL (the human step, the plan's Task 5), so that a
 * checkout that ran `npm install` holds the ccloop it was tested against. ORCA_CCLOOP_BIN still decides whenever it
 * is present -- empty included, because controlOptions reads an empty value as "no execution port", and an explicit
 * answer is never second-guessed by what happens to be installed.
 *
 * Resolution is Node's own (`createRequire(from).resolve("ccloop/package.json")`), so it walks node_modules upward
 * from `from`. The bin is returned as a realpath, which ccloopPort's regularAbsolute requires: Node realpaths the
 * manifest, but not under --preserve-symlinks, and never the bin joined onto it. ccloop has no "exports" field today;
 * if it ever gains one, it must export "./package.json" or this stops resolving.
 */
export class CcloopNotInstalled extends Error {
  constructor(from: string, detail: string) {
    super(
      `ccloop-not-installed: ORCA_CCLOOP_BIN is unset and no usable ccloop package resolves from ${from} (${detail}); ` +
        `run "npm install" in the Orca checkout, or point ORCA_CCLOOP_BIN at a ccloop build's dist/cli.js`,
    );
    this.name = "CcloopNotInstalled";
  }
}

/** The installed package's `bin.ccloop`, found the way Node finds `ccloop` from `from` (a module's file URL or absolute path). */
export function installedCcloopBin(from: string = import.meta.url): string {
  let manifestPath: string;
  try {
    manifestPath = createRequire(from).resolve("ccloop/package.json");
  } catch (error) {
    throw new CcloopNotInstalled(from, String((error as NodeJS.ErrnoException).code ?? error));
  }
  let manifest: { bin?: { ccloop?: unknown } };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: { ccloop?: unknown } };
  } catch (error) {
    // Node's resolution treats an unreadable manifest as absent and still returns its path; the read is where it fails.
    throw new CcloopNotInstalled(from, `${manifestPath} cannot be read as JSON: ${String((error as NodeJS.ErrnoException).code ?? error)}`);
  }
  const relative = manifest.bin?.ccloop;
  if (typeof relative !== "string" || relative.length === 0) throw new CcloopNotInstalled(from, `${manifestPath} names no bin.ccloop`);
  const bin = join(dirname(manifestPath), relative);
  if (!existsSync(bin)) throw new CcloopNotInstalled(from, `${bin} is missing: the package was installed without its build`);
  return realpathSync(bin);
}

/**
 * The environment with ORCA_CCLOOP_BIN filled in from the installed package when it is unset. A missing package is
 * returned rather than thrown: the panel boots without an execution port anyway (ruling R5), while `orca agents`
 * stops on it by name. The caller's object is never written to.
 */
export function withDefaultCcloopBin(
  env: NodeJS.ProcessEnv,
  from: string = import.meta.url,
): { env: NodeJS.ProcessEnv; notInstalled: CcloopNotInstalled | null } {
  if (env.ORCA_CCLOOP_BIN !== undefined) return { env, notInstalled: null };
  try {
    return { env: { ...env, ORCA_CCLOOP_BIN: installedCcloopBin(from) }, notInstalled: null };
  } catch (error) {
    if (error instanceof CcloopNotInstalled) return { env, notInstalled: error };
    throw error;
  }
}
