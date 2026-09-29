import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

describe("ccloop dependency plan Task 3 fix round 1: what the resolved default must satisfy", () => {
  it("is a realpath even when the install reaches its build through symlinks, as ccloopPort's regularAbsolute requires", async () => {
    // A package directory whose dist/ is a symlink to a build elsewhere: Node's resolution realpaths the manifest,
    // but the bin joined onto it still runs through the dist/ link. (--preserve-symlinks, which leaves even the
    // manifest unresolved, cannot be switched on inside this worker; this layout reaches the same unresolved join.)
    const root = await realpath(await mkdtemp(join(tmpdir(), "ccb-")));
    roots.push(root);
    const build = join(root, "elsewhere", "dist");
    await mkdir(build, { recursive: true });
    await writeFile(join(build, "cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
    const pkg = join(root, "store", "ccloop");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "ccloop", version: "0.1.0", bin: { ccloop: "dist/cli.js" } }));
    await symlink(build, join(pkg, "dist"));
    await mkdir(join(root, "node_modules"), { recursive: true });
    await symlink(pkg, join(root, "node_modules", "ccloop"));
    await mkdir(join(root, "src", "control"), { recursive: true });
    const bin = installedCcloopBin(join(root, "src", "control", "ccloopBin.js"));
    expect(bin).toBe(realpathSync(bin));
    expect(bin).toBe(join(build, "cli.js"));
  });

  it("names a manifest it cannot read instead of crashing the panel's boot", async () => {
    // Node's resolution treats an unreadable package.json as absent and still resolves the path, so the read that
    // follows is where it fails. Needs a non-root user, for whom mode 000 denies the read.
    const c = await consumer({});
    const manifest = join(dirname(dirname(c.bin)), "package.json");
    await chmod(manifest, 0o000);
    try {
      expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
      expect(() => installedCcloopBin(c.from)).toThrow(/EACCES/);
      const result = withDefaultCcloopBin({}, c.from);
      expect(result.notInstalled).toBeInstanceOf(CcloopNotInstalled);
      expect(result.env).toEqual({});
    } finally {
      await chmod(manifest, 0o600);
    }
  });

  it("names a manifest that is not JSON instead of crashing the panel's boot", async () => {
    // Node's resolution already refuses this one (ERR_INVALID_PACKAGE_CONFIG) before the manifest is read here; the
    // criterion pins the named outcome whichever of the two layers catches it.
    const c = await consumer({});
    await writeFile(join(dirname(dirname(c.bin)), "package.json"), "{ not json");
    expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
    expect(() => installedCcloopBin(c.from)).toThrow(/^ccloop-not-installed: /);
    const result = withDefaultCcloopBin({}, c.from);
    expect(result.notInstalled).toBeInstanceOf(CcloopNotInstalled);
    expect(result.env).toEqual({});
  });
});
