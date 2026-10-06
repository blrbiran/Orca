import { spawn } from "node:child_process";
import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import { controlSocketPath, socketPathTooLong } from "../../src/panel/controlSocket.js";
import { boot, overSocket, trackSocketPanel, untrackSocketPanel, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

useSocketPanels();

const captureStderr = (): string[] => {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
  return lines;
};

describe("the control socket (spec §3)", () => {
  it("C1: binds <stateDir>/control.sock as a 0600 socket and serves the control summary without a token", async () => {
    const w = await workspace();
    const panel = await boot(w);
    expect(panel.socketPath).toBe(controlSocketPath(await realpath(w.state)));
    const info = await lstat(panel.socketPath!);
    expect(info.isSocket()).toBe(true);
    expect(info.mode & 0o777).toBe(0o600);
    const summary = await overSocket(panel.socketPath!, "GET", "/api/control/summary");
    expect(summary.status).toBe(200);
    expect(JSON.parse(summary.text).schema).toBe("orca-control-summary-v1");
  });

  it("C2: replaces a stale socket left by a dead owner (SIGKILLed child, as a crash leaves it)", async () => {
    const w = await workspace();
    const first = await boot(w);
    const path = first.socketPath!;
    await first.close(); untrackSocketPanel(first);
    const child = spawn(process.execPath, ["-e", "require('net').createServer().listen(process.argv[1], () => console.log('up'))", path], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => { child.once("error", reject); child.stdout.once("data", () => resolve()); });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await exited;
    expect((await lstat(path)).isSocket()).toBe(true);
    const second = await boot(w);
    expect(second.socketPath).toBe(path);
    expect((await overSocket(second.socketPath!, "GET", "/api/control/summary")).status).toBe(200);
  });

  it("C2: a regular file at the path is not removed; the panel still serves the Web UI and says why on stderr", async () => {
    const w = await workspace();
    await mkdir(w.state, { recursive: true, mode: 0o700 });
    await writeFile(join(w.state, "control.sock"), "not a socket", { mode: 0o600 });
    const lines = captureStderr();
    const panel = await boot(w);
    expect(panel.socketPath).toBe(null);
    expect(lines.join("")).toContain("orca-panel: control socket unavailable: control-socket-path-occupied");
    expect((await stat(join(w.state, "control.sock"))).isFile()).toBe(true);
    const web = await fetch(`${panel.url}/api/control/config`, { headers: { "x-orca-token": panel.token } });
    expect(web.status).toBe(200);
  });

  it("C3: close() removes the socket file", async () => {
    const w = await workspace();
    const panel = await boot(w);
    const path = panel.socketPath!;
    await panel.close(); untrackSocketPanel(panel);
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C4: --no-control binds nothing; a second panel on a held store binds nothing and leaves the first one's socket", async () => {
    const w = await workspace();
    const off = await boot(w, ["--no-control"]);
    expect(off.socketPath).toBe(null);
    await expect(lstat(join(w.state, "control.sock"))).rejects.toMatchObject({ code: "ENOENT" });
    const first = await boot(w);
    const lines = captureStderr();
    const second = await boot(w);
    expect(lines.join("")).toContain("another process holds this repository's control store");
    expect(second.socketPath).toBe(null);
    expect((await overSocket(first.socketPath!, "GET", "/api/control/summary")).status).toBe(200);
    // The loser closing must not take the winner's socket with it.
    await second.close(); untrackSocketPanel(second);
    expect((await overSocket(first.socketPath!, "GET", "/api/control/summary")).status).toBe(200);
  });

  it("C5: serves no non-control route and no page", async () => {
    const w = await workspace();
    const panel = await boot(w);
    expect((await overSocket(panel.socketPath!, "GET", "/api/reviews")).status).toBe(404);
    expect((await overSocket(panel.socketPath!, "GET", "/")).status).toBe(404);
  });

  it("C15: a path over the sun_path limit is refused by name, and the panel still starts", async () => {
    expect(socketPathTooLong("/" + "a".repeat(120))).toBe(true);
    expect(socketPathTooLong("/tmp/x/control.sock")).toBe(false);
    const w = await workspace();
    const deep = join(w.root, "d".repeat(100));
    const lines = captureStderr();
    const opts = parsePanelArgs(["--by", "tester", "--repo", `proj=${w.repo}`, "--control-state-dir", deep], w.env);
    const panel = trackSocketPanel(await createPanelServer(opts, w.env));
    expect(panel.socketPath).toBe(null);
    expect(lines.join("")).toContain("control-socket-path-too-long");
  });
});
