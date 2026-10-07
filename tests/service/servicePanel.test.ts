import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlSocketPath } from "../../src/panel/controlSocket.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { readPanelJson } from "../../src/service/instance.js";
import { LOG_MAX_BYTES } from "../../src/service/logRotate.js";
import { isProcessAlive, processStartTime } from "../../src/service/processInfo.js";

const roots: string[] = [];
const children: Array<ReturnType<typeof spawn>> = [];
afterEach(async () => {
  // The whole group: tsx runs the panel in a child of its own, which a SIGKILL to tsx alone would orphan.
  for (const c of children.splice(0)) { try { process.kill(-c.pid!, "SIGKILL"); } catch { /* already gone */ } }
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function workspace() {
  // realpath: the panel names its socket by the resolved path, and macOS's tmpdir is under the /var symlink.
  const r = await realpath(await mkdtemp(join(tmpdir(), "sp-")));
  roots.push(r);
  for (const d of ["repo", "dist", "p", "p/logs", "c", "k"]) await mkdir(join(r, d));
  writeFileSync(join(r, "dist", "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
  // An explicit short state dir: in service mode a socket path over sun_path's 104 bytes is exit 78 (plan D13), and
  // <scoped TMPDIR>/sp-XXXXXX/c/<repo key>/control.sock measured 108 bytes on macOS.
  return { r, panelDir: join(r, "p"), controlDir: join(r, "c"), state: join(r, "s"), lock: join(r, "p", "panel.lock"), json: join(r, "p", "panel.json"), errLog: join(r, "p", "logs", "panel.err.log") };
}

/** A log one byte over the rotation limit (spec §6): rotated only by the instance that holds the lock. */
const oversizeLog = (file: string): void => writeFileSync(file, Buffer.alloc(LOG_MAX_BYTES + 1, 0x61), { mode: 0o600 });

function servicePanel(w: Awaited<ReturnType<typeof workspace>>, extra: string[] = [], service = true) {
  const args = ["src/cli.ts", "panel", "run", ...(service ? ["--service"] : []), "--by", "t", "--repo", `p=${join(w.r, "repo")}`, "--dist", join(w.r, "dist"), "--control-state-dir", w.state, ...extra];
  const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), args, {
    cwd: process.cwd(),
    env: { ...process.env, ORCA_AGENTS_TABLE: "", ORCA_CCLOOP_BIN: "", ORCA_PANEL_DIR: w.panelDir, ORCA_CONTROL_DIR: w.controlDir, ORCA_CORRECTIONS_DIR: join(w.r, "k") },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  let stdout = "", stderr = "";
  child.stdout!.on("data", (c: Buffer) => (stdout += c.toString()));
  child.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  const ready = () => new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => { if (stdout.includes("orca-panel ready url=")) { clearInterval(timer); resolve(); } }, 50);
    setTimeout(() => { clearInterval(timer); reject(new Error(`no ready line in 30s; stderr: ${stderr}`)); }, 30_000);
    void exited.then((code) => { clearInterval(timer); reject(new Error(`exited ${code} before ready; stderr: ${stderr}`)); });
  });
  return { child, exited, ready, out: () => stdout, err: () => stderr };
}

describe("orca panel run --service (spec §5)", () => {
  it("takes the lock, writes panel.json naming its socket, and removes both on SIGTERM", async () => {
    const w = await workspace();
    oversizeLog(w.errLog);
    const p = servicePanel(w, ["--port", "0"]);
    await p.ready();
    expect([statSync(w.errLog).size, statSync(`${w.errLog}.1`).size]).toEqual([0, LOG_MAX_BYTES + 1]);
    const json = readPanelJson(w.json);
    expect(json.kind).toBe("valid");
    if (json.kind !== "valid") return;
    expect(JSON.parse(readFileSync(w.lock, "utf8"))).toEqual({ pid: json.body.pid, startTime: json.body.startTime });
    expect(json.body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(json.body.socketPath).toBe(controlSocketPath(w.state));
    // Accounts plan dependency: the initial-password line names a file, never the password. Vacuous until that plan
    // lands (no such file); whichever plan lands second makes this unconditional and sees it red (mutation M-acc).
    const initial = join(w.controlDir, "initial-password");
    if (existsSync(initial)) expect(p.out() + p.err()).not.toContain(readFileSync(initial, "utf8").trim());
    p.child.kill("SIGTERM");
    expect(await p.exited).toBe(0);
    expect([existsSync(w.json), existsSync(w.lock)]).toEqual([false, false]);
  }, 60_000);

  it("exits 78 when the port is held by another program, leaving no lock and no panel.json", async () => {
    const w = await workspace();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    try {
      const p = servicePanel(w, ["--port", String((blocker.address() as AddressInfo).port)]);
      expect(await p.exited).toBe(78);
      expect(p.err()).toContain("panel-bind-failed");
      expect([existsSync(w.json), existsSync(w.lock)]).toEqual([false, false]);
      // Plan D2: the plain panel keeps today's exit code for the same failure (cli.ts's exit-3 arm), not 78.
      expect(await servicePanel(w, ["--port", String((blocker.address() as AddressInfo).port)], false).exited).toBe(3);
    } finally { blocker.close(); }
  }, 60_000);

  it("plan D13: exits 78 when the control socket cannot be bound, leaving no lock and no panel.json", async () => {
    const w = await workspace();
    const p = servicePanel({ ...w, state: join(w.r, "s".repeat(120)) }, ["--port", "0"]);
    expect(await Promise.race([p.exited, p.ready().then(() => "ready", () => null)])).toBe(78);
    expect(p.err()).toContain("rejected: panel-bind-failed: control socket: control-socket-path-too-long");
    expect([existsSync(w.json), existsSync(w.lock)]).toEqual([false, false]);
  }, 60_000);

  it("exits 0 without binding when a live panel holds the lock", async () => {
    const w = await workspace();
    const held = JSON.stringify({ pid: process.pid, startTime: processStartTime(process.pid) });
    writeFileSync(w.lock, held);
    oversizeLog(w.errLog);
    const p = servicePanel(w, ["--port", "0"]);
    expect(await p.exited).toBe(0);
    expect(p.err()).toContain(`pid ${process.pid}`);
    expect([p.out().includes("orca-panel ready"), existsSync(w.json)]).toEqual([false, false]);
    // The loser leaves the holder's lock byte for byte, and never copy-truncates the live panel's logs.
    expect(readFileSync(w.lock, "utf8")).toBe(held);
    expect([statSync(w.errLog).size, existsSync(`${w.errLog}.1`)]).toEqual([LOG_MAX_BYTES + 1, false]);
  }, 60_000);

  it("closes the bound panel and exits when panel.json cannot be written, leaving no lock", async () => {
    const w = await workspace();
    // A directory where panel.json goes: the temp-file rename over it fails after the panel has bound.
    await mkdir(join(w.json, "occupied"), { recursive: true });
    const p = servicePanel(w, ["--port", "0"]);
    const gone = await Promise.race([p.exited, new Promise<string>((resolve) => setTimeout(() => resolve("still running"), 20_000))]);
    expect(gone).toBe(3);
    expect(existsSync(w.lock)).toBe(false);
  }, 60_000);

  it("takes over a lock whose pid was reused (start time differs)", async () => {
    const w = await workspace();
    writeFileSync(w.lock, JSON.stringify({ pid: process.pid, startTime: "Thu Jan  1 00:00:00 1970" }));
    const p = servicePanel(w, ["--port", "0"]);
    await p.ready();
    const json = readPanelJson(w.json);
    expect(json.kind === "valid" && json.body.pid !== process.pid && isProcessAlive(json.body.pid)).toBe(true);
    p.child.kill("SIGTERM");
    expect(await p.exited).toBe(0);
  }, 60_000);

  it("plan D2: plain orca panel run takes no lock and writes no panel.json", async () => {
    const w = await workspace();
    const p = servicePanel(w, ["--port", "0"], false);
    await p.ready();
    expect([existsSync(w.lock), existsSync(w.json)]).toEqual([false, false]);
    p.child.kill("SIGTERM");
    expect(await p.exited).toBe(0);
  }, 60_000);
});
