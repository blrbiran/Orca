import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detached } from "../../src/service/detached.js";
import { writeServiceFiles } from "../../src/service/files.js";
import { identifyPanel } from "../../src/service/identify.js";
import { readPanelJson } from "../../src/service/instance.js";
import { isProcessAlive, processStartTime } from "../../src/service/processInfo.js";
import { servicePaths } from "../../src/service/paths.js";
import { fakeContext, fakeTools } from "./fixtures/fakeTools.js";

const roots: string[] = [];
/** Each pid with the start time it had when recorded: afterEach never kills a pid that was reused since. */
const tracked: Array<{ pid: number; startTime: string | null }> = [];
const track = (pid: number, startTime = processStartTime(pid)): void => { tracked.push({ pid, startTime }); };
/** CLI process groups whose leader has not exited yet. */
const groups = new Set<number>();
const killQuiet = (target: number): void => { try { process.kill(target, "SIGKILL"); } catch { /* already gone */ } };
afterEach(async () => {
  // A red run must not orphan a panel: the CLI's still-open process groups, every pid recorded, and whatever pid a
  // root's panel.json still names (a test that timed out before recording it). The panel leads its own group.
  for (const pgid of groups) killQuiet(-pgid);
  groups.clear();
  for (const root of roots) {
    const json = readPanelJson(join(root, "p", "panel.json"));
    if (json.kind === "valid") track(json.body.pid, json.body.startTime);
  }
  for (const { pid, startTime } of tracked.splice(0)) {
    if (pid > 1 && startTime !== null && processStartTime(pid) === startTime) { killQuiet(-pid); killQuiet(pid); }
  }
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function installed() {
  const r = await mkdtemp(join(tmpdir(), "dt-"));
  roots.push(r);
  const paths = servicePaths({ ORCA_PANEL_DIR: join(r, "p") });
  writeServiceFiles(paths, {
    schema: "orca-panel-service-v1", node: process.execPath, entry: join(process.cwd(), "tests", "service", "fixtures", "fakePanel.mjs"),
    args: [], env: { HOME: r, NODE_OPTIONS: "", ORCA_PANEL_DIR: paths.panelDir, PATH: "/usr/bin:/bin" },
  });
  return { r, paths };
}
const cli = (args: string[], env: NodeJS.ProcessEnv) => new Promise<{ code: number | null; out: string; err: string; pid: number }>((resolve) => {
  // Its own process group, which the test kills afterwards like a closing terminal would.
  const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, detached: true });
  groups.add(child.pid!);
  let out = "", err = "";
  child.stdout.on("data", (c: Buffer) => (out += c.toString()));
  child.stderr.on("data", (c: Buffer) => (err += c.toString()));
  child.on("close", (code) => { groups.delete(child.pid!); resolve({ code, out, err, pid: child.pid! }); });
});
const realProbes = { startTimeOf: processStartTime, isAlive: isProcessAlive, sleep: (ms: number) => new Promise<void>((x) => setTimeout(x, ms)), now: Date.now };

describe("detached fallback (spec §2, §8)", () => {
  it("start survives its parent and its parent's process group; stop verifies the start time before SIGTERM", async () => {
    const { paths } = await installed();
    const env = { ORCA_PANEL_DIR: paths.panelDir, ORCA_SERVICE_MANAGER: "detached" };
    const started = await cli(["panel", "start", "--detach"], env);
    expect(started.code, started.err).toBe(0);
    expect(started.out + started.err).toContain("neither restarts on crash nor survives a reboot");
    try { process.kill(-started.pid, "SIGTERM"); } catch { /* the group may already be empty */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const json = readPanelJson(paths.panelJson);
    expect(json.kind).toBe("valid");
    if (json.kind !== "valid") return;
    track(json.body.pid);
    expect((await identifyPanel(paths.panelJson)).answering).toBe(true);

    const real = readFileSync(paths.panelJson, "utf8");
    writeFileSync(paths.panelJson, JSON.stringify({ ...json.body, startTime: "Thu Jan  1 00:00:00 1970" }));
    const refused = await cli(["panel", "stop"], env);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("not the panel");
    expect(isProcessAlive(json.body.pid)).toBe(true);

    writeFileSync(paths.panelJson, real);
    const stopped = await cli(["panel", "stop"], env);
    expect(stopped.code, stopped.err).toBe(0);
    expect(isProcessAlive(json.body.pid)).toBe(false);
    expect(existsSync(paths.panelJson)).toBe(false);
  }, 90_000);

  it("start is a no-op when the panel already answers; state reads panel.json", async () => {
    const { r, paths } = await installed();
    const { ctx } = fakeContext(await fakeTools(r), paths, realProbes);
    expect(await detached.start(ctx)).toBe(0);
    const json = readPanelJson(paths.panelJson);
    if (json.kind === "valid") track(json.body.pid);
    expect(await detached.start(ctx)).toBe(0);
    expect(detached.state(ctx)).toMatchObject({ loaded: true, state: "running" });
    expect(await detached.stop(ctx)).toBe(0);
    expect(detached.state(ctx)).toEqual({ loaded: false, state: "not running", pid: null });
  }, 60_000);

  it("the panel leads its own process group; stop and state refuse a pid without panel.json's start time", async () => {
    const { r, paths } = await installed();
    const { ctx, err } = fakeContext(await fakeTools(r), paths, realProbes);
    expect(await detached.start(ctx)).toBe(0);
    const json = readPanelJson(paths.panelJson);
    expect(json.kind).toBe("valid");
    if (json.kind !== "valid") return;
    const { pid } = json.body;
    track(pid);
    // Spec §2 / S1: a group of its own, so a closing terminal's hangup or a kill of the starter's group misses it.
    expect(spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim()).toBe(String(pid));
    // Spec §8: the pid is alive but did not start when panel.json says, so it is someone else's process now.
    writeFileSync(paths.panelJson, JSON.stringify({ ...json.body, startTime: "Thu Jan  1 00:00:00 1970" }));
    expect(detached.state(ctx)).toEqual({ loaded: false, state: "not running", pid: null });
    expect(await detached.stop(ctx)).toBe(1);
    expect(err.join("\n")).toContain("not the panel");
    expect(isProcessAlive(pid)).toBe(true);
  }, 60_000);

  it("start refuses without run.sh, and fails loudly when the panel exits or never answers", async () => {
    const { r, paths } = await installed();
    const { ctx, err } = fakeContext(await fakeTools(r), paths, { ...realProbes, startWaitMs: 500 });
    writeFileSync(paths.runScript, "exit 3\n");
    expect(await detached.start(ctx)).toBe(1);
    expect(err.pop()).toContain(`the panel exited during start; see ${paths.errLog}`);
    // Far longer than the deadline, so load cannot turn it into an exit; killed here by the pid the message names.
    writeFileSync(paths.runScript, "exec /bin/sleep 60\n");
    expect(await detached.start(ctx)).toBe(1);
    const late = err.pop() ?? "";
    const sleeper = Number(/no answer from pid (\d+) within 500 ms/.exec(late)?.[1]);
    if (sleeper > 1) killQuiet(-sleeper);
    expect(late).toMatch(/no answer from pid \d+ within 500 ms/);
    await rm(paths.runScript);
    expect(await detached.start(ctx)).toBe(1);
    expect(err.pop()).toContain("not installed (no run.sh)");
  }, 60_000);

  it("stop with nothing recorded answers 0; an unparseable panel.json is refused by name", async () => {
    const { r, paths } = await installed();
    const { ctx, out, err } = fakeContext(await fakeTools(r), paths, realProbes);
    expect(await detached.stop(ctx)).toBe(0);
    expect(out).toContain("orca panel: not running; nothing to stop");
    writeFileSync(paths.panelJson, "{");
    expect(await detached.stop(ctx)).toBe(1);
    expect(err.pop()).toContain(`${paths.panelJson} is invalid`);
  });

  it("install says how to start; restart replaces a live panel; uninstall stops it and removes run.sh", async () => {
    const { r, paths } = await installed();
    const { ctx, out } = fakeContext(await fakeTools(r), paths, realProbes);
    expect(await detached.install(ctx)).toBe(0);
    expect(out.pop()).toContain("start it with orca panel start --detach");
    expect(await detached.start(ctx)).toBe(0);
    const first = readPanelJson(paths.panelJson);
    expect(first.kind).toBe("valid");
    if (first.kind !== "valid") return;
    track(first.body.pid);
    expect(await detached.restart(ctx)).toBe(0);
    const second = readPanelJson(paths.panelJson);
    expect(second.kind).toBe("valid");
    if (second.kind !== "valid") return;
    track(second.body.pid);
    expect(second.body.pid).not.toBe(first.body.pid);
    expect(isProcessAlive(first.body.pid)).toBe(false);
    expect((await identifyPanel(paths.panelJson)).answering).toBe(true);
    expect(await detached.uninstall(ctx)).toBe(0);
    expect([isProcessAlive(second.body.pid), existsSync(paths.runScript)]).toEqual([false, false]);
  }, 60_000);

  it("restart and uninstall refuse while stop refuses (a pid without panel.json's start time)", async () => {
    const { r, paths } = await installed();
    const { ctx } = fakeContext(await fakeTools(r), paths, realProbes);
    expect(await detached.start(ctx)).toBe(0);
    const json = readPanelJson(paths.panelJson);
    expect(json.kind).toBe("valid");
    if (json.kind !== "valid") return;
    track(json.body.pid);
    const stale = JSON.stringify({ ...json.body, startTime: "Thu Jan  1 00:00:00 1970" });
    writeFileSync(paths.panelJson, stale);
    expect(await detached.restart(ctx)).toBe(1);
    expect(await detached.uninstall(ctx)).toBe(1);
    expect([isProcessAlive(json.body.pid), existsSync(paths.runScript), readFileSync(paths.panelJson, "utf8")]).toEqual([true, true, stale]);
  }, 60_000);

  it("stop: a panel gone before the signal is stopped; one that outlives the exit wait is a failure", async () => {
    const { r, paths } = await installed();
    // A process this test owns, standing in for the panel; its own group so the cleanup can take it down.
    const sleeper = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
    const pid = sleeper.pid!;
    track(pid);
    const startTime = processStartTime(pid)!;
    writeFileSync(paths.panelJson, JSON.stringify({ pid, startTime, url: "http://127.0.0.1:1", socketPath: null, version: "fake" }));
    // The clock only moves on sleep, and isAlive never says gone: the exit wait runs out.
    const stuck = fakeContext(await fakeTools(r), paths, { startTimeOf: () => startTime, isAlive: () => true, exitWaitMs: 1_000 });
    expect(await detached.stop(stuck.ctx)).toBe(1);
    expect(stuck.err.pop()).toContain(`pid ${pid} did not exit within 1000 ms`);
    await new Promise<void>((resolve) => { if (sleeper.exitCode !== null || sleeper.signalCode !== null) resolve(); else sleeper.once("exit", () => resolve()); });
    // Now dead, but the probe still reports the recorded start time: the window between the check and the signal.
    const gone = fakeContext(await fakeTools(r), paths, { startTimeOf: () => startTime, isAlive: () => false });
    expect(await detached.stop(gone.ctx)).toBe(0);
    expect(gone.out).toContain("orca panel: not running; nothing to stop");
  }, 60_000);
});
