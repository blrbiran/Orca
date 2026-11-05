import { rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runServiceCommand, type ServiceSeams } from "../../src/service/command.js";
import { writeServiceFiles } from "../../src/service/files.js";
import { servicePaths, type ServicePaths } from "../../src/service/paths.js";
import { fakeTools, sampleConfig, type FakeTools } from "./fixtures/fakeTools.js";

/**
 * Issue #120 (session 3cfc2e73): on macOS a panel can run under launchd or as a detached process, and neither manager
 * looked at the other, so a detached panel on the port made launchd's panel exit 78 every 10 s. `start --detach` and
 * `restart` now refuse, naming the other manager and the pid. launchctl and lsof are fakes first on PATH; every path is
 * under a temp root (ORCA_PANEL_DIR, ORCA_LAUNCH_AGENTS_DIR): the real launchd and ~/.orca are never touched.
 */
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function world(manager: string): Promise<{ fake: FakeTools; paths: ServicePaths; env: NodeJS.ProcessEnv }> {
  const r = await mkdtemp(join(tmpdir(), "mc-"));
  roots.push(r);
  const fake = await fakeTools(r, ["launchctl", "lsof", "tail"]);
  await fake.output("launchctl", "managername", "Aqua\n");
  const env = { ...fake.env, HOME: r, ORCA_SERVICE_MANAGER: manager, ORCA_PANEL_DIR: join(r, "p"), ORCA_LAUNCH_AGENTS_DIR: join(r, "la"), ORCA_SERVICE_LABEL: "dev.orca.panel.mc" };
  const paths = servicePaths(env);
  writeServiceFiles(paths, sampleConfig(paths)); // --port 7777
  return { fake, paths, env };
}
const loadedPlist = async (w: { fake: FakeTools; paths: ServicePaths }, pid: number | null) => {
  await mkdir(dirname(w.paths.plistFile), { recursive: true });
  writeFileSync(w.paths.plistFile, "<plist/>\n");
  await w.fake.output("launchctl", "print", `state = ${pid === null ? "spawn scheduled" : "running"}\n${pid === null ? "" : `pid = ${pid}\n`}`);
};
const listening = (w: { fake: FakeTools }, pid: number) => w.fake.output("lsof", "-nP", `${pid}\n`);
const plantPanel = (paths: ServicePaths, pid: number) =>
  writeFileSync(paths.panelJson, JSON.stringify({ pid, startTime: `start-${pid}`, url: "http://127.0.0.1:1", socketPath: null, version: "fake" }));

async function run(w: { env: NodeJS.ProcessEnv }, sub: string, args: string[], alive: number[] = []) {
  let stdout = "", stderr = "";
  let clock = 0;
  const seams: ServiceSeams = { platform: "darwin", ctx: {
    startWaitMs: 1_000, exitWaitMs: 1_000, now: () => clock, sleep: async (ms) => { clock += ms; await new Promise((r) => setImmediate(r)); },
    isAlive: (pid) => alive.includes(pid), startTimeOf: (pid) => (alive.includes(pid) ? `start-${pid}` : null),
  } };
  const result = await runServiceCommand(sub, args, w.env, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) }, seams);
  return { result, stdout, stderr };
}

describe("orca panel start --detach beside launchd (#120)", () => {
  it("refuses while launchd has the panel loaded, naming launchd and its pid; nothing is spawned", async () => {
    const w = await world("");
    await loadedPlist(w, 777);
    const started = await run(w, "start", ["--detach"]);
    expect(started.result).toBe(1);
    expect(started.stderr).toContain("rejected: service-manager-conflict: launchd already manages this panel (dev.orca.panel.mc, pid 777)");
    expect(started.stdout).not.toContain("detached process");
  });

  it("refuses when another pid holds the configured port, naming the port and the pid", async () => {
    const w = await world("");
    await listening(w, 999);
    const started = await run(w, "start", ["--detach"]);
    expect(started.result).toBe(1);
    expect(started.stderr).toContain("rejected: service-manager-conflict: port 7777 is held by pid 999");
  });

  it("with no launchd job and a free port it goes on to start (and the panel it already runs is not a conflict)", async () => {
    const w = await world("");
    await listening(w, 4242);
    plantPanel(w.paths, 4242); // its own detached panel holds the port
    rmSync(w.paths.runScript); // so start stops at "not installed" instead of spawning anything
    const started = await run(w, "start", ["--detach"], [4242]);
    expect(started.stderr).not.toContain("service-manager-conflict");
    expect(started.stderr).toContain("not installed (no run.sh)");
  });
});

describe("orca panel restart under launchd beside a detached panel (#120)", () => {
  it("refuses when panel.json names a live panel launchd does not run, naming its pid", async () => {
    const w = await world("launchd");
    await loadedPlist(w, 777);
    plantPanel(w.paths, 4242);
    const restarted = await run(w, "restart", [], [4242, 777]);
    expect(restarted.result).toBe(1);
    expect(restarted.stderr).toContain("rejected: service-manager-conflict: a panel launchd does not run (pid 4242");
    expect((await w.fake.calls()).some((call) => call.startsWith("launchctl kickstart"))).toBe(false);
  });

  it("refuses when a pid launchd does not run holds the port, naming the pid", async () => {
    const w = await world("launchd");
    await loadedPlist(w, 777);
    await listening(w, 555);
    const restarted = await run(w, "restart", [], [777]);
    expect(restarted.result).toBe(1);
    expect(restarted.stderr).toContain("rejected: service-manager-conflict: port 7777 is held by pid 555, which launchd does not run (launchd's pid: 777)");
  });

  it("launchd's own panel on the port is no conflict: restart goes on to launchctl", async () => {
    const w = await world("launchd");
    await loadedPlist(w, 777);
    plantPanel(w.paths, 777);
    await listening(w, 777);
    const restarted = await run(w, "restart", [], [777]);
    expect(restarted.stderr).not.toContain("service-manager-conflict");
    expect((await w.fake.calls()).some((call) => call.startsWith("launchctl kickstart") || call.startsWith("launchctl bootout"))).toBe(true);
  });
});
