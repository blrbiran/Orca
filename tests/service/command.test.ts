import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";
import { runServiceCommand, selectManager, startNeedsDetach, type ServiceSeams } from "../../src/service/command.js";
import { servicePaths, type ServicePaths } from "../../src/service/paths.js";
import { runTool } from "../../src/service/tools.js";
import { captureStreams } from "../scheduler/sandbox.js";
import { fakeTools } from "./fixtures/fakeTools.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function setup() {
  const r = await mkdtemp(join(tmpdir(), "cm-"));
  roots.push(r);
  const checkout = join(r, "orca");
  await mkdir(join(checkout, "src"), { recursive: true });
  await mkdir(join(checkout, "dist"));
  await writeFile(join(checkout, "src", "a.ts"), "\n");
  await utimes(join(checkout, "src", "a.ts"), new Date("2026-01-01"), new Date("2026-01-01"));
  await writeFile(join(checkout, "dist", "cli.js"), "\n");
  const fake = await fakeTools(r);
  await fake.output("launchctl", "managername", "Aqua\n");
  const env = {
    ...fake.env, ORCA_SERVICE_MANAGER: "launchd", ORCA_SERVICE_CHECKOUT: checkout,
    ORCA_PANEL_DIR: join(r, "p"), ORCA_LAUNCH_AGENTS_DIR: join(r, "la"), ORCA_SYSTEMD_USER_DIR: join(r, "su"),
    ORCA_SERVICE_LABEL: "dev.orca.panel.cmd", ORCA_CCMEM_BIN: "/usr/local/bin/ccmem", ORCA_UNRELATED: "x",
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return { r, fake, checkout, paths: servicePaths(process.env) }; // the env the CLI reads (the setup file sets ORCA_SERVICE_UNIT)
}
const install = ["panel", "install", "--by", "ann", "--port", "7777", "--repo", "orca=/src/orca-web"];

/** A panel that answers GET / with 200, as the url-only branch of identifyPanel asks. */
async function answeringPanel(): Promise<string> {
  const server = createServer((_req, res) => { res.writeHead(200); res.end("ok"); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}
const plantPanel = (paths: ServicePaths, url: string, pid: number) =>
  writeFileSync(paths.panelJson, JSON.stringify({ pid, startTime: `start-${pid}`, url, socketPath: null, version: "fake" }));

/**
 * The CLI's context with a clock that only moves on sleep, so the spec §9 wait runs out without waiting. `onSleep`
 * stands in for the manager's job coming up a little after launchctl/systemctl returned.
 */
function seams(onSleep: () => void = () => {}): ServiceSeams & { slept: () => number } {
  let clock = 0;
  return {
    ctx: { startWaitMs: 1_000, now: () => clock, sleep: async (ms) => { clock += ms; onSleep(); await new Promise((r) => setImmediate(r)); } },
    slept: () => clock,
  };
}
async function run(sub: string, args: string[], s: ServiceSeams = {}) {
  let stdout = "", stderr = "";
  const result = await runServiceCommand(sub, args, process.env, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) }, s);
  return { result, stdout, stderr };
}

describe("orca panel <subcommand> (spec §4)", () => {
  it("install --dry-run prints every file it would write and runs nothing (plan D17)", async () => {
    const s = await setup();
    const { result, stdout } = await captureStreams(() => main([...install.slice(0, 2), "--dry-run", ...install.slice(2)]));
    expect(result).toBe(0);
    for (const path of [s.paths.configFile, s.paths.envFile, s.paths.runScript, s.paths.plistFile]) expect(stdout).toContain(`--- ${path}`);
    expect(stdout).toContain("<key>Label</key>");
    expect(stdout).toContain('ORCA_CCMEM_BIN="/usr/local/bin/ccmem"');
    expect(stdout).not.toContain("ORCA_UNRELATED");
    expect([existsSync(s.paths.panelDir), await s.fake.calls()]).toEqual([false, []]);
  });

  it("install records an absolute entry even when ORCA_SERVICE_CHECKOUT is relative (config does not check it)", async () => {
    const s = await setup();
    vi.stubEnv("ORCA_SERVICE_CHECKOUT", relative(process.cwd(), s.checkout));
    const { result, stdout } = await captureStreams(() => main([...install.slice(0, 2), "--dry-run", ...install.slice(2)]));
    expect(result).toBe(0);
    expect(stdout).toContain(`"entry": "${join(s.checkout, "dist", "cli.js")}"`);
  });

  it("install writes the files 0600, loads the LaunchAgent and waits for the panel to answer (spec §9)", async () => {
    const s = await setup();
    const url = await answeringPanel();
    // launchctl returned 0 before the panel was up: the first poll misses, the panel appears during the wait.
    const wait = seams(() => plantPanel(s.paths, url, 4242));
    const { result, stdout } = await run("install", install.slice(2), wait);
    expect(result).toBe(0);
    expect(wait.slept()).toBeGreaterThan(0);
    expect(stdout).toContain(`orca panel: answering at ${url} (pid 4242)`);
    expect((JSON.parse(readFileSync(s.paths.configFile, "utf8")) as { args: string[] }).args).toEqual(install.slice(2));
    expect([statSync(s.paths.panelDir).mode & 0o777, statSync(s.paths.configFile).mode & 0o777]).toEqual([0o700, 0o600]);
    expect(await s.fake.calls()).toEqual(["launchctl managername", "launchctl bootout gui/" + process.getuid!() + "/dev.orca.panel.cmd",
      "launchctl enable gui/" + process.getuid!() + "/dev.orca.panel.cmd", `launchctl bootstrap gui/${process.getuid!()} ${s.paths.plistFile}`]);
  });

  it("install, start and restart do not trust launchctl's 0: no answer within the wait is exit 1, naming what was checked", async () => {
    const s = await setup();
    const installed = await run("install", install.slice(2), seams());
    expect(installed.result).toBe(1);
    expect(installed.stderr).toContain(`orca panel: launchd accepted install, but no panel answered through ${s.paths.panelJson} within 1000 ms (no panel.json at ${s.paths.panelJson})`);
    const started = await run("start", [], seams());
    expect(started.result).toBe(1);
    expect(started.stderr).toContain("launchd accepted start, but no panel answered");
    const restarted = await run("restart", [], seams());
    expect(restarted.result).toBe(1);
    expect(restarted.stderr).toContain("launchd accepted restart, but no panel answered");
  });

  it("restart does not count the panel from before it; a new pid answering is success", async () => {
    const s = await setup();
    const url = await answeringPanel();
    expect((await run("install", install.slice(2), seams(() => plantPanel(s.paths, url, 4242)))).result).toBe(0);
    const stale = await run("restart", [], seams());
    expect(stale.result).toBe(1);
    expect(stale.stderr).toContain("only the panel from before the restart (pid 4242) answered");
    const fresh = await run("restart", [], seams(() => plantPanel(s.paths, url, 4343)));
    expect(fresh.result).toBe(0);
    expect(fresh.stdout).toContain("(pid 4343)");
  });

  it("the detached manager's install starts nothing, so it does not wait for a panel", async () => {
    await setup();
    vi.stubEnv("ORCA_SERVICE_MANAGER", "detached");
    const wait = seams();
    const { result, stdout } = await run("install", install.slice(2), wait);
    expect([result, wait.slept()]).toEqual([0, 0]);
    expect(stdout).toContain("start it with orca panel start --detach");
  });

  it("the agent skill says the service commands are the human's (spec §7)", () => {
    expect(readFileSync("skills/orca-control/SKILL.md", "utf8")).toContain("`orca panel install|uninstall|start|stop|restart` change the human's running service. Never run them; ask the human.");
  });

  it("a failed enable names the next step: re-run orca panel install", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "enable", [1]);
    const { result, stderr } = await run("install", install.slice(2), seams());
    expect(result).toBe(1);
    expect(stderr).toContain("launchctl enable exited 1");
    expect(stderr).toContain("re-run orca panel install");
  });

  it("status reports a running job whose panel does not answer as not answering, exit 1", async () => {
    const s = await setup();
    // Installed means the plist exists (status never infers it from the manager's answer).
    await mkdir(join(s.r, "la"));
    await writeFile(s.paths.plistFile, "plist\n");
    await s.fake.output("launchctl", "print", "\tstate = running\n\tpid = 4242\n");
    const { result, stdout } = await captureStreams(() => main(["panel", "status"]));
    expect(result).toBe(1);
    expect(stdout).toContain("manager: launchd running pid=4242");
    expect(stdout).toContain("panel: not answering");
  });

  it("status without the manager's file is service-not-installed, even when the manager answers (systemctl show exits 0 for a missing unit)", async () => {
    const s = await setup();
    await s.fake.output("launchctl", "print", "\tstate = running\n\tpid = 4242\n");
    const launchdStatus = await captureStreams(() => main(["panel", "status"]));
    expect([launchdStatus.result, launchdStatus.stdout]).toEqual([1, ""]);
    expect(launchdStatus.stderr).toContain(`rejected: service-not-installed: ${s.paths.plistFile} does not exist`);
    vi.stubEnv("ORCA_SERVICE_MANAGER", "systemd");
    await s.fake.output("systemctl", "show", "ActiveState=inactive\nSubState=dead\nMainPID=0\nNRestarts=0\n");
    const systemdStatus = await captureStreams(() => main(["panel", "status"]));
    expect([systemdStatus.result, systemdStatus.stdout]).toEqual([1, ""]);
    expect(systemdStatus.stderr).toContain(`rejected: service-not-installed: ${s.paths.unitFile} does not exist`);
  });

  it("logs answers 0 or 1: the tool's own non-zero code (130 on Ctrl-C) is 1 (global exit codes)", async () => {
    const s = await setup();
    await s.fake.codes("tail", "-n", [130, 0]);
    expect((await run("logs", ["-n", "5"])).result).toBe(1);
    expect((await run("logs", ["-n", "5"])).result).toBe(0);
    expect(await s.fake.calls()).toEqual([`tail -n 5 ${s.paths.outLog} ${s.paths.errLog}`, `tail -n 5 ${s.paths.outLog} ${s.paths.errLog}`]);
  });

  it("refuses bad arguments and an unknown manager by name", async () => {
    await setup();
    expect((await captureStreams(() => main(["panel", "logs", "-n", "x"]))).stderr).toContain("service-argument-invalid");
    expect((await captureStreams(() => main(["panel", "stop", "--now"]))).stderr).toContain("service-argument-invalid");
    vi.stubEnv("ORCA_SERVICE_MANAGER", "upstart");
    expect((await captureStreams(() => main(["panel", "status"]))).stderr).toContain("service-manager-invalid");
  });

  it("panel run is the foreground panel, and the old form is its alias", async () => {
    for (const argv of [["panel", "run", "--port", "0"], ["panel", "--port", "0"]]) {
      const { result, stderr } = await captureStreams(() => main(argv));
      expect([result, stderr.includes("no-viewer-identity")]).toEqual([1, true]);
    }
  });
});

describe("manager selection (spec §2, plan D14)", () => {
  it("launchd on macOS, systemd when the user manager answers, detached otherwise; --detach forces detached", async () => {
    const r = await mkdtemp(join(tmpdir(), "ms-"));
    roots.push(r);
    const fake = await fakeTools(r);
    const env = { ...process.env, ...fake.env, ORCA_SERVICE_MANAGER: "" };
    const pick = (platform: NodeJS.Platform, detach = false) => selectManager({ env, platform, detach, run: runTool, uid: process.getuid!() }).manager.kind;
    expect(pick("darwin")).toBe("launchd");
    expect(pick("darwin", true)).toBe("detached");
    expect(pick("linux")).toBe("systemd");
    await fake.codes("systemctl", "show-environment", [1]);
    expect(pick("linux")).toBe("detached");
    expect(() => pick("win32")).toThrow(expect.objectContaining({ code: "service-platform-unsupported" }));
  });

  it("start without a manager found needs --detach typed (plan D14); a chosen detached manager does not", async () => {
    expect([startNeedsDetach("detached", true, false), startNeedsDetach("detached", true, true), startNeedsDetach("detached", false, false),
      startNeedsDetach("launchd", true, false), startNeedsDetach("systemd", true, false)]).toEqual([true, false, false, false, false]);
    // Through the command on a Linux host whose user manager does not answer (unreachable on this macOS host otherwise).
    const s = await setup();
    vi.stubEnv("ORCA_SERVICE_MANAGER", "");
    await s.fake.codes("systemctl", "show-environment", [1, 1]);
    const refused = await run("start", [], { platform: "linux" });
    expect(refused.result).toBe(1);
    expect(refused.stderr).toContain("rejected: service-detach-required: no service manager here; orca panel start --detach");
    const typed = await run("start", ["--detach"], { platform: "linux" });
    expect([typed.result, typed.stderr]).toEqual([1, "orca panel: not installed (no run.sh); run orca panel install first\n"]);
  });
});
