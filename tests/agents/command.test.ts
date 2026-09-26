import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runAgentsCommand } from "../../src/agents/command.js";
import { AgentsPathError, agentsTablePath } from "../../src/agents/paths.js";

// Agent selection spec §6.7, §8 and CLAUDE.md Rule 17: `orca agents init` is the one writer of the installation
// table, user data outside any repository. Every criterion points ORCA_AGENTS_TABLE into a temporary directory and
// HOME at an empty one that must stay empty; the ccloop here is a stand-in answering `agents detect|validate` and
// `control capabilities` from a script file, so no real agent is probed.
//
// Plan review P1 (2026-09-26): `agentsTablePath` reads `HOME` from the environment it is GIVEN, never
// `os.homedir()`, so nothing in this file can reach the real ~/.orca through the default branch even by accident.
// As a second, process-level guard (belt and braces, since a regression that reintroduced `os.homedir()` would
// otherwise still read the real HOME here), this file's own `beforeAll` redirects `process.env.HOME` and
// `process.env.ORCA_AGENTS_TABLE` to temporary locations for its whole duration and restores them afterwards.
//
// P23 m7 (fix round 1): the same redirection covers the four XDG roots, mirroring the `relocateHome` convention
// in tests/control/fixtures/ccloopWorld.ts:166-176 -- any code reached through this file that consults
// XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_DATA_HOME/XDG_STATE_HOME (directly or via a library) lands in a temporary
// directory too, never a real one.
const XDG_KEYS = ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const;
let realHome: string | undefined;
let realTable: string | undefined;
const realXdg: Partial<Record<(typeof XDG_KEYS)[number], string | undefined>> = {};
let guardRoot: string;

beforeAll(async () => {
  realHome = process.env.HOME;
  realTable = process.env.ORCA_AGENTS_TABLE;
  for (const key of XDG_KEYS) realXdg[key] = process.env[key];
  guardRoot = await realpath(await mkdtemp(join(tmpdir(), "orca-agents-cli-guard-")));
  process.env.HOME = join(guardRoot, "home");
  process.env.ORCA_AGENTS_TABLE = join(guardRoot, "unused", "agents.json");
  for (const key of XDG_KEYS) process.env[key] = join(guardRoot, key.toLowerCase());
});

afterAll(async () => {
  process.env.HOME = realHome;
  process.env.ORCA_AGENTS_TABLE = realTable;
  for (const key of XDG_KEYS) {
    if (realXdg[key] === undefined) delete process.env[key];
    else process.env[key] = realXdg[key];
  }
  await rm(guardRoot, { recursive: true, force: true });
});

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

const TABLE = { schema: "ccloop-agents-table-v1", installations: { claude: { kind: "claude", command: ["/opt/claude"], version: "2.1.282", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 } } };

async function world(script: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-agents-cli-")));
  roots.push(root);
  const home = join(root, "home");
  await mkdir(home);
  // P23 m7 (fix round 1): each world gets its own four XDG roots, pre-created so `tree()` can prove them empty
  // (not merely absent) both before and after every command this world runs.
  const xdgConfig = join(root, "xdg-config"), xdgCache = join(root, "xdg-cache"), xdgData = join(root, "xdg-data"), xdgState = join(root, "xdg-state");
  await mkdir(xdgConfig);
  await mkdir(xdgCache);
  await mkdir(xdgData);
  await mkdir(xdgState);
  const binary = join(root, "ccloop");
  const scriptPath = join(root, "script.json");
  await writeFile(scriptPath, JSON.stringify({ table: TABLE, ...script }));
  await writeFile(binary, `#!${process.execPath}
const fs = require("node:fs");
const script = JSON.parse(fs.readFileSync(${JSON.stringify(scriptPath)}, "utf8"));
const [a, b, c, d] = process.argv.slice(2);
if (a === "agents" && b === "detect") { process.stdout.write(script.detect ?? JSON.stringify({ schema: "ccloop-agents-detect-v1", table: script.table, candidates: {} })); process.exit(0); }
if (a === "agents" && b === "validate") { process.stdout.write(JSON.stringify([{ id: "claude", ok: script.validateOk !== false }]) + "\\n"); process.exit(script.validateOk === false ? 1 : 0); }
if (a === "control" && b === "capabilities" && c === "--agents") {
  let stdin = ""; process.stdin.on("data", (x) => { stdin += x; }); process.stdin.on("end", () => {
    const request = JSON.parse(stdin);
    if (request.agent === null) process.stdout.write(JSON.stringify({ protocol: 3, installations: [{ id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1000000], version: "2.1.282" }] }));
    else if (script.driftFor === request.agent.agent) { process.stderr.write("agent-version-drift\\n"); process.exit(1); }
    else process.stdout.write(JSON.stringify({ protocol: 3, selection: { model: "claude-opus-5-5", contextWindow: "agent-default", ...request.agent }, configHash: "e".repeat(64), timeoutMs: 1800000, killGraceMs: 5000,
      capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } }));
  });
} else { process.stderr.write("unexpected " + process.argv.slice(2).join(" ") + "\\n"); process.exit(9); }
`, { mode: 0o700 });
  const table = join(root, "orca", "nested", "agents.json");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: home, ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table,
    XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: xdgCache, XDG_DATA_HOME: xdgData, XDG_STATE_HOME: xdgState,
  };
  const out: string[] = [], err: string[] = [];
  const io = { stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { err.push(text); } };
  const agents = (verb: string, over: NodeJS.ProcessEnv = {}) => runAgentsCommand([verb], { ...env, ...over }, io);
  return { root, home, binary, table, env, out, err, agents, scriptPath, xdgConfig, xdgCache, xdgData, xdgState };
}

const modeOf = async (path: string): Promise<number> => (await lstat(path)).mode & 0o777;

/** Every file and directory under `dir`, relative, sorted; `[]` for a directory that does not exist. */
async function tree(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { recursive: true })).sort(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * P23 m7 (fix round 1): after `init` or `show`, none of the four XDG roots gained anything, and HOME gained
 * nothing beyond the entries the caller names (the table and/or its draft, for the one criterion where the
 * table lives under HOME itself).
 */
async function assertNoStrayWrites(w: { home: string; xdgConfig: string; xdgCache: string; xdgData: string; xdgState: string }, expectedHomeEntries: string[] = []): Promise<void> {
  expect(await tree(w.home)).toEqual(expectedHomeEntries);
  expect(await tree(w.xdgConfig)).toEqual([]);
  expect(await tree(w.xdgCache)).toEqual([]);
  expect(await tree(w.xdgData)).toEqual([]);
  expect(await tree(w.xdgState)).toEqual([]);
}

describe("agentsTablePath (agent selection plan review P1)", () => {
  it("prefers ORCA_AGENTS_TABLE verbatim, ignoring HOME entirely", () => {
    expect(agentsTablePath({ HOME: "/nowhere", ORCA_AGENTS_TABLE: "/x/agents.json" })).toBe("/x/agents.json");
  });

  it("without ORCA_AGENTS_TABLE, defaults to <HOME>/.orca/agents.json using the HOME it was given, not os.homedir()", () => {
    expect(agentsTablePath({ HOME: "/nowhere" })).toBe(join("/nowhere", ".orca", "agents.json"));
    expect(agentsTablePath({ HOME: "/nowhere", ORCA_AGENTS_TABLE: "" })).toBe(join("/nowhere", ".orca", "agents.json"));
  });

  it("refuses rather than falling back to the real home when HOME is missing or not absolute", () => {
    expect(() => agentsTablePath({})).toThrow(AgentsPathError);
    expect(() => agentsTablePath({ HOME: "relative/home" })).toThrow(AgentsPathError);
    expect(() => agentsTablePath({ HOME: "" })).toThrow(AgentsPathError);
  });
});

describe("orca agents init (agent selection spec §6.7, §8)", () => {
  it("writes the detected table where ORCA_AGENTS_TABLE says, creating directories 0700 and the file 0600, and nothing under HOME", async () => {
    const w = await world();
    expect(await w.agents("init")).toBe(0);
    expect(JSON.parse(await readFile(w.table, "utf8"))).toEqual(TABLE);
    expect(await modeOf(w.table)).toBe(0o600);
    expect(await modeOf(join(w.root, "orca", "nested"))).toBe(0o700);
    expect(await modeOf(join(w.root, "orca"))).toBe(0o700);
    expect(await readdir(join(w.root, "orca", "nested"))).toEqual(["agents.json"]);
    expect(await readdir(w.home)).toEqual([]);
    expect(w.out.join("")).toContain(`wrote ${w.table}`);
    await assertNoStrayWrites(w);
  });

  // Plan review P1: with no override at all, the table must land under the given HOME's own ~/.orca, never the
  // real developer home -- this is the criterion P1 requires in addition to the pure-function ones above.
  it("with no ORCA_AGENTS_TABLE, lands the table at HOME/.orca/agents.json, 0700 dir / 0600 file (plan review P1)", async () => {
    const w = await world();
    const expectedTable = join(w.home, ".orca", "agents.json");
    expect(await w.agents("init", { ORCA_AGENTS_TABLE: undefined })).toBe(0);
    expect(JSON.parse(await readFile(expectedTable, "utf8"))).toEqual(TABLE);
    expect(await modeOf(expectedTable)).toBe(0o600);
    expect(await modeOf(join(w.home, ".orca"))).toBe(0o700);
    expect(await readdir(join(w.home, ".orca"))).toEqual(["agents.json"]);
    // The table lands under HOME on this path, so the "nothing else" carve-out is HOME's own .orca entries.
    await assertNoStrayWrites(w, [".orca", join(".orca", "agents.json")]);
  });

  it("never overwrites an existing table: the bytes and mode stay, the detection goes to the draft 0600, and the diff is printed", async () => {
    const w = await world();
    await mkdir(join(w.root, "orca", "nested"), { recursive: true, mode: 0o755 });
    await chmod(join(w.root, "orca", "nested"), 0o755);
    const original = '{ "schema": "ccloop-agents-table-v1", "installations": {} }\n';
    await writeFile(w.table, original, { mode: 0o644 });
    await chmod(w.table, 0o644);
    expect(await w.agents("init")).toBe(0);
    expect(await readFile(w.table, "utf8")).toBe(original);
    expect(await modeOf(w.table)).toBe(0o644);
    expect(await modeOf(join(w.root, "orca", "nested"))).toBe(0o755);
    expect(JSON.parse(await readFile(`${w.table}.draft.json`, "utf8"))).toEqual(TABLE);
    expect(await modeOf(`${w.table}.draft.json`)).toBe(0o600);
    expect(w.out.join("")).toMatch(/^\+.*"claude"/m);
    expect((await readdir(join(w.root, "orca", "nested"))).sort()).toEqual(["agents.json", "agents.json.draft.json"]);
  });

  it("treats a table that is a symlink as existing and leaves the file it points at untouched", async () => {
    const w = await world();
    await mkdir(join(w.root, "orca", "nested"), { recursive: true });
    const elsewhere = join(w.root, "elsewhere.json");
    await writeFile(elsewhere, "not mine\n");
    await symlink(elsewhere, w.table);
    expect(await w.agents("init")).toBe(0);
    expect(await readlink(w.table)).toBe(elsewhere);
    expect(await readFile(elsewhere, "utf8")).toBe("not mine\n");
    expect(JSON.parse(await readFile(`${w.table}.draft.json`, "utf8"))).toEqual(TABLE);
  });

  it("replaces its own earlier draft", async () => {
    const w = await world();
    await mkdir(join(w.root, "orca", "nested"), { recursive: true });
    await writeFile(w.table, "{}\n");
    await writeFile(`${w.table}.draft.json`, "stale draft\n");
    expect(await w.agents("init")).toBe(0);
    expect(JSON.parse(await readFile(`${w.table}.draft.json`, "utf8"))).toEqual(TABLE);
  });

  it("removes a temporary file an earlier init left, and nothing that merely looks like one", async () => {
    const w = await world();
    const dir = join(w.root, "orca", "nested");
    await mkdir(dir, { recursive: true });
    const stale = join(dir, ".agents.json.orca-agents-0123456789abcdef.tmp");
    await writeFile(stale, "left by a crash");
    const target = join(w.root, "precious.txt");
    await writeFile(target, "precious\n");
    const linked = join(dir, ".agents.json.orca-agents-fedcba9876543210.tmp");
    await symlink(target, linked);
    const other = join(dir, ".agents.json.orca-agents-short.tmp");
    await writeFile(other, "not our pattern");
    expect(await w.agents("init")).toBe(0);
    await expect(lstat(stale)).rejects.toThrow("ENOENT");
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toBe("precious\n");
    expect(await readFile(other, "utf8")).toBe("not our pattern");
  });

  it("gives the modes explicitly, not from the umask", async () => {
    const w = await world();
    // A child process, because the umask is per process: 0300 would strip the owner's write and execute bits from
    // anything created with a mode it did not then set. `node --import tsx` rather than the tsx CLI, whose own IPC
    // pipe would be created under the same umask.
    const cli = resolve("src/cli.ts");
    await promisify(execFile)("/bin/sh", ["-c", `umask 0300; exec "${process.execPath}" --import tsx "${cli}" agents init`], { env: w.env, cwd: resolve(".") });
    expect(await modeOf(join(w.root, "orca", "nested"))).toBe(0o700);
    expect(await modeOf(w.table)).toBe(0o600);
  });

  it("refuses a relative table path, a missing ccloop and a detection it cannot read, writing nothing", async () => {
    const w = await world({ detect: "not json" });
    expect(await w.agents("init", { ORCA_AGENTS_TABLE: "relative/agents.json" })).toBe(1);
    expect(await w.agents("init", { ORCA_CCLOOP_BIN: "" })).toBe(1);
    expect(await w.agents("init")).toBe(1);
    await expect(lstat(join(w.root, "orca"))).rejects.toThrow("ENOENT");
    expect(w.err.join("")).toMatch(/ORCA_AGENTS_TABLE must be an absolute path[\s\S]*ORCA_CCLOOP_BIN[\s\S]*not JSON/);
  });
});

describe("orca agents show (agent selection spec §6.7)", () => {
  it("prints ccloop's validation and what each installation resolves to, and exits 0 when all are accepted", async () => {
    const w = await world();
    expect(await w.agents("init")).toBe(0);
    expect(await w.agents("show")).toBe(0);
    const printed = w.out.join("");
    expect(printed).toContain('[{"id":"claude","ok":true}]');
    expect(printed).toContain(`claude (claude 2.1.282): {"agent":"claude","model":"claude-opus-5-5","contextWindow":"agent-default"} configHash ${"e".repeat(64)}`);
    // `show` reads only (M-8: no control store, no writes anywhere) -- HOME is untouched here since this world's
    // table lives beside `root`, not under HOME.
    await assertNoStrayWrites(w);
  });

  it("exits 1 and names the refusal when ccloop refuses an installation or the validation fails", async () => {
    const drift = await world({ driftFor: "claude" });
    expect(await drift.agents("init")).toBe(0);
    expect(await drift.agents("show")).toBe(1);
    expect(drift.out.join("")).toContain("claude (claude 2.1.282): refused: agent-version-drift");
    await assertNoStrayWrites(drift);
    const invalid = await world({ validateOk: false });
    expect(await invalid.agents("init")).toBe(0);
    expect(await invalid.agents("show")).toBe(1);
    await assertNoStrayWrites(invalid);
  });
});
