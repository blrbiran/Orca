import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { installedCcloopBin } from "../../src/control/ccloopBin.js";

/**
 * ccloop dependency plan (2026-09-29) Task 3: Orca against the ccloop package installed in THIS checkout's
 * node_modules, with ORCA_CCLOOP_BIN unset. Opt-in (ORCA_CCLOOP_DEFAULT_E2E=1) like the other real-ccloop criteria,
 * because what it measures is an install, not the source: before the human installs the pinned git dependency there
 * is nothing here to measure. A formal run with ORCA_CCLOOP_BIN set is refused outright, since the override would
 * answer every question this file asks.
 *
 * Deliberately NOT borrowed from ccloopWorld.ts: that fixture takes fake-codex from ccloop's tests/ tree, which the
 * package does not ship. The fake codex here is a two-line shell script, and nothing else of ccloop's is assumed.
 */
const formal = process.env.ORCA_CCLOOP_DEFAULT_E2E === "1";
if (formal && process.env.ORCA_CCLOOP_BIN !== undefined) {
  throw new Error("ccloopDefaultE2E measures the default resolution: run it with ORCA_CCLOOP_BIN unset");
}

const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

type World = { bin: string; repo: string; table: string; env: NodeJS.ProcessEnv };

async function world(): Promise<World> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccd-")));
  roots.push(root);
  const bin = join(root, "bin");
  await mkdir(bin);
  await chmod(bin, 0o755); // ccloop's detect never searches a world-writable PATH entry
  // First on PATH: `node` for ccloop's `#!/usr/bin/env node`, and a codex whose --version detect and validate read.
  await symlink(process.execPath, join(bin, "node"));
  await writeFile(join(bin, "codex"), "#!/bin/sh\necho 'codex-cli 9.9.9-fake'\n", { mode: 0o755 });
  const repo = join(root, "repo");
  const home = join(root, "home");
  const [config, cache, data, state] = ["config", "cache", "data", "state"].map((name) => join(root, `xdg-${name}`));
  for (const dir of [repo, home, config!, cache!, data!, state!]) await mkdir(dir);
  const table = join(root, "orca", "agents.json");
  // Rule 17: every user-data root this process tree could reach is inside `root`.
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: process.env.TMPDIR,
    XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache, XDG_DATA_HOME: data, XDG_STATE_HOME: state,
    ORCA_AGENTS_TABLE: table, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"),
  };
  return { bin, repo, table, env };
}

function orca(w: World, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [tsxCli, "src/cli.ts", ...args], { cwd: process.cwd(), env: w.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** Everything a panel wrote to stderr up to its browser hint, which comes after the ready line and after assembly. */
async function panelStderr(w: World, over: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(process.execPath, [tsxCli, "src/cli.ts", "panel", "--by", "e2e", "--repo", `proj=${w.repo}`, "--port", "0"], {
    cwd: process.cwd(), env: { ...w.env, ...over }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  try {
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`no ready line within 60s; stdout: ${stdout} stderr: ${stderr}`)), 60_000);
      const check = (): void => { if (stdout.includes("\n") && stderr.includes("in a browser")) { clearTimeout(timer); ok(); } };
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); check(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); check(); });
      child.once("exit", (code) => { clearTimeout(timer); fail(new Error(`panel exited ${code}; stderr: ${stderr}`)); });
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
  return stderr;
}

describe.skipIf(!formal)("Orca with ccloop installed as its dependency and ORCA_CCLOOP_BIN unset", () => {
  it("resolves the package in this checkout, whose runtime finds the scripts the package ships", async () => {
    const bin = installedCcloopBin();
    expect(bin).toBe(await realpath(resolve("node_modules/ccloop/dist/cli.js")));
    const pkg = dirname(dirname(bin));
    // The adapter's own answer from its dist/ location -- the layout a checkout's build never exercises.
    const adapter = (await import(pathToFileURL(join(pkg, "dist", "src", "runtime", "claude", "claudeAgentAdapter.js")).href)) as { claudeRunnerPath(): string };
    expect(adapter.claudeRunnerPath()).toBe(join(pkg, "scripts", "claude-phase-runner.mjs"));
    expect(existsSync(adapter.claudeRunnerPath())).toBe(true);
    // The runner's one relative import, loaded for real: a package without it fails here, not in a claude phase.
    const stream = (await import(pathToFileURL(join(pkg, "scripts", "claude-stream.mjs")).href)) as { createLineSplitter?: unknown };
    expect(typeof stream.createLineSplitter).toBe("function");
  });

  it("runs orca agents init and show through the installed ccloop", async () => {
    const w = await world();
    const init = await orca(w, ["agents", "init"]);
    expect(init.code, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toContain(`orca agents: wrote ${w.table}`);
    const written = JSON.parse(await readFile(w.table, "utf8")) as { installations: Record<string, { command: string[]; version: string }> };
    // First on PATH, so ccloop's detect chooses it as the PATH default over any codex in /opt/homebrew/bin or /usr/local/bin.
    expect(written.installations.codex).toMatchObject({ command: [join(w.bin, "codex")], version: "9.9.9-fake" });
    // detect also searches /opt/homebrew/bin and /usr/local/bin whatever PATH says; keep only what this world owns,
    // so `show` measures Orca and ccloop rather than whichever claude this machine has. The file keeps its 0600.
    await writeFile(w.table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { codex: written.installations.codex } }));
    const show = await orca(w, ["agents", "show"]);
    expect(show.code, show.stdout + show.stderr).toBe(0);
    expect(show.stdout).toMatch(/^codex \(codex 9\.9\.9-fake\): .* configHash [0-9a-f]{64}$/m);
  }, 120_000);

  it("boots the panel with an execution port, while an explicit empty ORCA_CCLOOP_BIN still turns it off", async () => {
    const w = await world();
    expect(await panelStderr(w, {})).not.toContain("no execution port");
    // The control: the same world with the variable present but empty. Without this, "not.toContain" could be green
    // because the line was never printed for any reason at all.
    expect(await panelStderr(w, { ORCA_CCLOOP_BIN: "" })).toContain("mounted with no execution port");
  }, 150_000);
});
