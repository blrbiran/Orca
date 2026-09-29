import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CcloopNotInstalled, installedCcloopBin, withDefaultCcloopBin } from "../../src/control/ccloopBin.js";

/**
 * ccloop dependency plan (2026-09-29) Task 2. Every criterion resolves from a consumer directory of its own, laid out
 * the way npm leaves one, so none of them depends on whether THIS checkout's node_modules holds ccloop -- before the
 * human's install it does not, after it does, and a criterion that changed colour between the two would be measuring
 * the machine. `from` is a module two levels below the consumer root, so resolution has to walk up as Node's does.
 * Precondition: NODE_PATH unset and no node_modules/ccloop above $TMPDIR (Node would find those too).
 */
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function consumer(pkg: { manifest?: unknown; build?: boolean } | null) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccb-")));
  roots.push(root);
  await mkdir(join(root, "src", "control"), { recursive: true });
  const from = join(root, "src", "control", "ccloopBin.js");
  const dir = join(root, "node_modules", "ccloop");
  if (pkg !== null) {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg.manifest ?? { name: "ccloop", version: "0.1.0", bin: { ccloop: "dist/cli.js" } }));
    if (pkg.build !== false) await writeFile(join(dir, "dist", "cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
  }
  return { from, bin: join(dir, "dist", "cli.js") };
}

describe("the ccloop binary Orca uses when ORCA_CCLOOP_BIN is unset", () => {
  it("is the installed package's bin.ccloop, found by walking up from the calling module", async () => {
    const c = await consumer({});
    expect(installedCcloopBin(c.from)).toBe(c.bin);
    // The shipped default is import.meta.url, a file: URL, not a path.
    expect(installedCcloopBin(pathToFileURL(c.from).href)).toBe(c.bin);
  });

  it("is filled into a copy of the environment, never into the caller's", async () => {
    const c = await consumer({});
    const input: NodeJS.ProcessEnv = { ORCA_AGENTS_TABLE: "/etc/agents.json" };
    const result = withDefaultCcloopBin(input, c.from);
    expect(result).toEqual({ env: { ORCA_AGENTS_TABLE: "/etc/agents.json", ORCA_CCLOOP_BIN: c.bin }, notInstalled: null });
    // process.env is what the panel passes; a default written into it would leak into every child it spawns.
    expect(input).toEqual({ ORCA_AGENTS_TABLE: "/etc/agents.json" });
  });

  it("never overrides an explicit ORCA_CCLOOP_BIN, an empty one included", async () => {
    // The package IS installed here, so a resolver that ignored the variable would visibly replace it.
    const c = await consumer({});
    const explicit: NodeJS.ProcessEnv = { ORCA_CCLOOP_BIN: "/elsewhere/ccloop/dist/cli.js" };
    expect(withDefaultCcloopBin(explicit, c.from).env).toBe(explicit);
    // Empty is the operator saying "no execution port": controlOptions reads it as unconfigured
    // (tests/panel/controlOptions.test.ts, "calls the port configured only when both are set and non-empty").
    const empty: NodeJS.ProcessEnv = { ORCA_CCLOOP_BIN: "" };
    expect(withDefaultCcloopBin(empty, c.from).env.ORCA_CCLOOP_BIN).toBe("");
  });

  it("names a missing package instead of crashing, and leaves the environment as it was", async () => {
    const c = await consumer(null);
    expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
    expect(() => installedCcloopBin(c.from)).toThrow(/^ccloop-not-installed: /);
    const input: NodeJS.ProcessEnv = { ORCA_AGENTS_TABLE: "/etc/agents.json" };
    const result = withDefaultCcloopBin(input, c.from);
    expect(result.notInstalled).toBeInstanceOf(CcloopNotInstalled);
    expect(result.env).toBe(input);
    expect("ORCA_CCLOOP_BIN" in result.env).toBe(false);
  });

  it("names a package installed without its build, by the path it expected", async () => {
    // What a git install looks like when `prepare` did not run: the manifest is there, dist/ is not.
    const c = await consumer({ build: false });
    expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
    expect(() => installedCcloopBin(c.from)).toThrow(c.bin);
  });

  it("names a package whose manifest declares no ccloop bin", async () => {
    const c = await consumer({ manifest: { name: "ccloop", version: "0.1.0" } });
    expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
    expect(() => installedCcloopBin(c.from)).toThrow(/names no bin\.ccloop/);
  });
});
