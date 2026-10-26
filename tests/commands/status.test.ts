// CLI v2 spec §8 (plan Task 12): `orca status` prints one line per check, `ok|warn|fail <subject>: <fact>`, exit 1 on any
// fail and 0 otherwise (warnings included); `orca doctor` runs the same checks plus slower ones and prints one line
// saying what to do per failure; `orca version` prints the CLI's version. Both are read-only: they never start, fix or
// write anything -- the tree under a temp HOME is the same before and after (Rule 17: never the person's ~/.orca).
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ccloopBinCheck, DOCTOR_CHECKS, orcaModesCheck, runDoctor, staleSocketsCheck } from "../../src/commands/doctor.js";
import { runRegistered } from "../../src/commands/run.js";
import { runStatus, agentsTableCheck, ccmemCheck, schemaCheck, skillCheck, STATUS_CHECKS, type Check, type CheckContext } from "../../src/commands/status.js";
import type { CommandIo, ParsedArgs } from "../../src/commands/types.js";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const VERSION = (JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8")) as { version: string }).version;

// Rule 17 guard: nothing in this file touches the person's real ~/.orca.
const REAL = join(homedir(), ".orca");
const stamp = (): string => (existsSync(REAL) ? String(statSync(REAL).mtimeMs) : "absent");
let before = "";
beforeAll(() => { before = stamp(); });
afterAll(() => { expect(stamp()).toBe(before); });

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
/** A temp HOME with every Orca path relocated into it, so the default checks read only what this test made. */
function sandbox(): { home: string; env: NodeJS.ProcessEnv } {
  // Short: a unix socket path must fit in 104 bytes on macOS.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "st-")));
  roots.push(home);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: home,
    ORCA_PANEL_DIR: join(home, ".orca", "panel"), ORCA_CONTROL_DIR: join(home, ".orca", "control"),
    ORCA_AGENTS_TABLE: join(home, ".orca", "agents.json"), ORCA_PERSON_DIR: join(home, ".orca", "person"),
    ORCA_PROJECTS_FILE: join(home, ".orca", "projects.json"),
    ORCA_LAUNCH_AGENTS_DIR: join(home, "LaunchAgents"), XDG_CONFIG_HOME: join(home, ".config"),
    ORCA_SERVICE_LABEL: "dev.orca.status-test", ORCA_SERVICE_UNIT: "orca-status-test",
  };
  return { home, env };
}

function capture(env: NodeJS.ProcessEnv = {}): { io: CommandIo; out: () => string } {
  const out: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => out.push(t), env, cwd: CHECKOUT, stdinIsTTY: false }, out: () => out.join("") };
}

const args = (json = false): ParsedArgs => ({ positionals: {}, flags: {}, global: { json, quiet: false, verbose: false, help: false, asPerson: false } });
const fixed = (level: "ok" | "warn" | "fail", subject: string, fact: string, fix?: string): Check =>
  async () => ({ level, subject, fact, ...(fix === undefined ? {} : { fix }) });

describe("orca status (spec §8)", () => {
  it("all ok: one `ok <subject>: <fact>` line per check, exit 0", async () => {
    const { io, out } = capture();
    expect(await runStatus(args(), io, [fixed("ok", "panel", "answering"), fixed("ok", "ccloop", "pinned")])).toBe(0);
    expect(out()).toBe("ok panel: answering\nok ccloop: pinned\n");
  });

  it("a warning is printed and still exits 0", async () => {
    const { io, out } = capture();
    expect(await runStatus(args(), io, [fixed("ok", "panel", "answering"), fixed("warn", "ccmem", "ORCA_CCMEM_BIN is not set")])).toBe(0);
    expect(out()).toContain("warn ccmem: ORCA_CCMEM_BIN is not set\n");
  });

  it("one fail exits 1; a check that throws is a fail by name, not a crash", async () => {
    const { io, out } = capture();
    expect(await runStatus(args(), io, [fixed("ok", "panel", "answering"), fixed("fail", "schema", "store 17, CLI 16")])).toBe(1);
    expect(out()).toContain("fail schema: store 17, CLI 16\n");
    const thrown = capture();
    expect(await runStatus(args(), thrown.io, [async () => { throw new Error("boom"); }])).toBe(1);
    expect(thrown.out()).toMatch(/^fail check: .*boom/m);
  });

  it("--json prints one orca-cli-response-v1 line carrying every check", async () => {
    const { io, out } = capture();
    expect(await runStatus(args(true), io, [fixed("warn", "ccmem", "unset")])).toBe(0);
    expect(out().split("\n").filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(out())).toEqual({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-status-v1", checks: [{ level: "warn", subject: "ccmem", fact: "unset" }] } });
  });

  it("skill: an installed copy whose version: differs from the CLI's is `fail skill: …`; a matching one is ok; none found is a warning", async () => {
    const { home, env } = sandbox();
    const ctx: CheckContext = { env, checkout: CHECKOUT };
    expect((await skillCheck(ctx)).level).toBe("warn");
    const dir = join(home, ".claude", "skills", "orca-control");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: orca-control\nversion: ${VERSION}\n---\n# x\n`);
    expect(await skillCheck(ctx)).toMatchObject({ level: "ok", subject: "skill" });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: orca-control\nversion: 0.0.0-old\n---\n# x\n");
    const failed = await skillCheck(ctx);
    expect(failed).toMatchObject({ level: "fail", subject: "skill" });
    expect(failed.fact).toContain("0.0.0-old");
    expect(failed.fact).toContain(VERSION);
    const { io, out } = capture(env);
    expect(await runStatus(args(), io, [skillCheck])).toBe(1);
    expect(out()).toMatch(/^fail skill: /m);
  });

  it("status runs the spec's checks: service, panel socket and HTTP, control schema, agents table, ccloop pin, ccmem, skill", () => {
    expect(STATUS_CHECKS.map((check) => check.name)).toEqual([
      "serviceCheck", "panelSocketCheck", "panelHttpCheck", "schemaCheck", "agentsTableCheck", "ccloopPinCheck", "ccmemCheck", "skillCheck",
    ]);
    // Doctor: the same, then the slower ones.
    expect(DOCTOR_CHECKS.slice(0, STATUS_CHECKS.length)).toEqual(STATUS_CHECKS);
    // Issue 92: plus the ccloop bin the panel would start with (rewritten under 0e13a9b7's ruling to add it).
    expect(DOCTOR_CHECKS.slice(STATUS_CHECKS.length).map((check) => check.name)).toEqual(["agentPathCheck", "orcaModesCheck", "staleSocketsCheck", "ccloopBinCheck"]);
  });
});

describe("orca status reads the installed service's environment (D4)", () => {
  const install = (env: NodeJS.ProcessEnv, serviceEnv: NodeJS.ProcessEnv): void => {
    const dir = env.ORCA_PANEL_DIR!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "service.json"), JSON.stringify({
      schema: "orca-panel-service-v1", node: process.execPath, entry: join(CHECKOUT, "dist", "cli.js"), args: [], env: serviceEnv,
    }));
  };

  it("names the service's ccmem bin and agents table when service.json exists, this shell's without it", async () => {
    const { home, env } = sandbox();
    const executable = (name: string): string => { const path = join(home, name); writeFileSync(path, "#!/bin/sh\n", { mode: 0o755 }); return path; };
    const table = (name: string): string => { const path = join(home, name); writeFileSync(path, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: [] }), { mode: 0o600 }); return path; };
    const callerBin = executable("caller-ccmem"), serviceBin = executable("service-ccmem");
    const callerTable = table("caller-agents.json"), serviceTable = table("service-agents.json");
    const caller = { ...env, ORCA_CCMEM_BIN: callerBin, ORCA_AGENTS_TABLE: callerTable };
    const plain = capture(caller);
    expect(await runStatus(args(), plain.io, [ccmemCheck, agentsTableCheck])).toBe(0);
    expect(plain.out()).toContain(callerBin);
    expect(plain.out()).toContain(callerTable);
    expect(plain.out()).not.toContain(serviceBin);
    expect(plain.out()).not.toContain(serviceTable);
    install(caller, { ORCA_CCMEM_BIN: serviceBin, ORCA_AGENTS_TABLE: serviceTable });
    const service = capture(caller);
    expect(await runStatus(args(), service.io, [ccmemCheck, agentsTableCheck])).toBe(0);
    expect(service.out()).toContain(serviceBin);
    expect(service.out()).toContain(serviceTable);
    expect(service.out()).not.toContain(callerBin);
    expect(service.out()).not.toContain(callerTable);
  });

  it("--control-state-dir still decides the control directory", async () => {
    const { home, env } = sandbox();
    const serviceControl = join(home, "service-control");
    mkdirSync(serviceControl);
    install(env, { ORCA_CONTROL_DIR: serviceControl });
    const flag = join(home, "flag-control");
    mkdirSync(flag);
    const flagged = { ...args(), global: { ...args().global, controlStateDir: flag } };
    const { io, out } = capture(env);
    expect(await runStatus(flagged, io, [schemaCheck])).toBe(0);
    expect(out()).toContain(join(flag, "control.sqlite"));
    expect(out()).not.toContain(join(serviceControl, "control.sqlite"));
  });
});

describe("orca doctor (spec §8)", () => {
  it("prints one fix line under each failure, none under an ok line; exit 1", async () => {
    const { io, out } = capture();
    const code = await runDoctor(args(), io, [
      fixed("ok", "panel", "answering"),
      fixed("fail", "ccloop", "pin 76b098b, installed 638c3d8", "npm install"),
      fixed("fail", "skill", "installed 0.0.1, CLI 0.1.0"),
    ]);
    expect(code).toBe(1);
    const lines = out().split("\n").filter(Boolean);
    expect(lines).toEqual([
      "ok panel: answering",
      "fail ccloop: pin 76b098b, installed 638c3d8",
      "  fix: npm install",
      "fail skill: installed 0.0.1, CLI 0.1.0",
      "  fix: no known fix; the fact above names what is wrong",
    ]);
  });

  // Issue 92: a panel whose ccloop bin is missing boots with no execution port, and doctor said nothing about it. The
  // check reads the environment the panel would start with -- the installed service's, when there is one, since that
  // is what launchd hands it -- and the package that resolves from that panel's own entry.
  it("ccloop bin: names a missing file, an empty variable and a missing package; ok when the bin is there", async () => {
    const { home, env } = sandbox();
    const bin = join(home, "ccloop", "dist", "cli.js");
    mkdirSync(join(home, "ccloop", "dist"), { recursive: true });
    const nowhere = join(home, "no-checkout"); // no node_modules above it inside the sandbox
    mkdirSync(nowhere);
    const ctx = (over: NodeJS.ProcessEnv, checkout = nowhere): CheckContext => ({ env: { ...env, ...over }, checkout });
    const gone = await ccloopBinCheck(ctx({ ORCA_CCLOOP_BIN: bin }));
    expect(gone).toMatchObject({ level: "fail", subject: "ccloop-bin" });
    expect(gone.fact).toContain(bin);
    writeFileSync(bin, "#!/usr/bin/env node\n", { mode: 0o755 });
    expect(await ccloopBinCheck(ctx({ ORCA_CCLOOP_BIN: bin }))).toMatchObject({ level: "ok", subject: "ccloop-bin" });
    expect(await ccloopBinCheck(ctx({ ORCA_CCLOOP_BIN: "" }))).toMatchObject({ level: "fail", subject: "ccloop-bin" });
    const unset = await ccloopBinCheck(ctx({}));
    expect(unset).toMatchObject({ level: "fail", subject: "ccloop-bin" });
    expect(unset.fact).toMatch(/^ccloop-not-installed: /);
    expect(unset.fix).toContain("npm install");
    // This checkout has ccloop installed: unset resolves to that package's bin.
    expect(await ccloopBinCheck(ctx({}, CHECKOUT))).toMatchObject({ level: "ok", subject: "ccloop-bin" });
    // The installed service's environment decides, not this shell's: its stored value points at the missing file.
    const serviceDir = env.ORCA_PANEL_DIR!;
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(join(serviceDir, "service.json"), JSON.stringify({
      schema: "orca-panel-service-v1", node: process.execPath, entry: join(CHECKOUT, "dist", "cli.js"), args: [],
      env: { ORCA_CCLOOP_BIN: join(home, "gone", "cli.js") },
    }));
    const service = await ccloopBinCheck(ctx({ ORCA_CCLOOP_BIN: bin }));
    expect(service).toMatchObject({ level: "fail", subject: "ccloop-bin" });
    expect(service.fact).toContain(join(home, "gone", "cli.js"));
    expect(service.fact).toContain("service.json");
  });

  it("~/.orca modes: a directory open to group or others is named with a chmod fix, and left as it is", async () => {
    const { home, env } = sandbox();
    mkdirSync(join(home, ".orca", "control"), { recursive: true, mode: 0o700 });
    chmodSync(join(home, ".orca"), 0o700);
    expect((await orcaModesCheck({ env, checkout: CHECKOUT })).level).toBe("ok");
    chmodSync(join(home, ".orca", "control"), 0o755);
    const found = await orcaModesCheck({ env, checkout: CHECKOUT });
    expect(found).toMatchObject({ level: "warn", subject: "orca-modes" });
    expect(found.fact).toContain(join(home, ".orca", "control"));
    expect(found.fix).toContain("chmod 700");
    expect(statSync(join(home, ".orca", "control")).mode & 0o777).toBe(0o755);
  });

  it("a socket no panel listens on is a stale socket, named with a fix, and not removed", async () => {
    const { env } = sandbox();
    // The temp HOME is too long for a unix socket path (104 bytes on macOS): the control root moves to a short one.
    const short = realpathSync(mkdtempSync("/tmp/ss-"));
    roots.push(short);
    env.ORCA_CONTROL_DIR = short;
    const dir = join(short, "panel");
    mkdirSync(dir, { recursive: true });
    const socket = join(dir, "control.sock");
    // A listener killed without closing leaves its socket file behind: the stale file a crashed panel leaves.
    await new Promise<void>((done, fail) => {
      const child = spawn(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(socket)}, () => process.kill(process.pid, "SIGKILL"))`]);
      child.on("exit", () => done());
      child.on("error", fail);
    });
    expect(existsSync(socket)).toBe(true);
    const found = await staleSocketsCheck({ env, checkout: CHECKOUT });
    expect(found).toMatchObject({ level: "fail", subject: "stale-sockets" });
    expect(found.fact).toContain(socket);
    expect(found.fix).toContain(socket);
    expect(existsSync(socket)).toBe(true);
  });
});

/** Every path under `root` with its type, mode, size and mtime: what a write of any kind would change. */
function snapshot(root: string): string[] {
  const rows: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const s = statSync(path, { throwIfNoEntry: false });
      if (s === undefined) { rows.push(`${path} dangling`); continue; }
      rows.push(`${path} ${s.isDirectory() ? "d" : "f"} ${(s.mode & 0o7777).toString(8)} ${s.isDirectory() ? "" : s.size} ${s.mtimeMs}`);
      if (s.isDirectory()) walk(path);
    }
  };
  walk(root);
  return rows;
}

describe("status, doctor and version write nothing (spec §8: read-only)", { timeout: 60_000 }, () => {
  it("the real checks, through the registry, leave a temp HOME exactly as it was", async () => {
    const { home, env } = sandbox();
    mkdirSync(join(home, ".orca", "control"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, ".orca", "agents.json"), "{}\n", { mode: 0o600 });
    mkdirSync(join(home, ".claude", "skills", "orca-control"), { recursive: true });
    writeFileSync(join(home, ".claude", "skills", "orca-control", "SKILL.md"), "---\nversion: 0.0.0\n---\n");
    const was = snapshot(home);
    for (const argv of [["status"], ["doctor"], ["version"], ["status", "--json"]]) {
      const { io, out } = capture(env);
      const code = await runRegistered(argv, io);
      expect([argv.join(" "), typeof code]).toEqual([argv.join(" "), "number"]);
      expect(out().length).toBeGreaterThan(0);
    }
    expect(snapshot(home)).toEqual(was);
  });
});

describe("orca version", () => {
  it("prints the package version; --json carries it", async () => {
    const text = capture();
    expect(await runRegistered(["version"], text.io)).toBe(0);
    expect(text.out()).toBe(`orca ${VERSION}\n`);
    const json = capture();
    expect(await runRegistered(["version", "--json"], json.io)).toBe(0);
    expect(JSON.parse(json.out())).toEqual({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-version-v1", version: VERSION } });
  });
});
