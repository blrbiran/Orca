import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNet, type AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSocketPath } from "../../src/entry/discovery.js";
import { identifyPanel } from "../../src/service/identify.js";
import { writePanelJson } from "../../src/service/instance.js";
import { statusLines } from "../../src/service/status.js";

const roots: string[] = [];
const servers: Array<{ close(cb: () => void): void }> = [];
afterEach(async () => {
  while (servers.length) await new Promise<void>((done) => servers.pop()!.close(() => done()));
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
async function root() { const r = await mkdtemp(join(tmpdir(), "id-")); roots.push(r); return r; }
const answering = (status: number) => (req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(req.url === "/api/control/summary" || req.url === "/" ? status : 404, { "content-type": "application/json" });
  res.end("{}");
};
async function socketPanel(dir: string, status = 200): Promise<string> {
  const path = join(dir, "control.sock");
  const server: Server = createHttp(answering(status));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  servers.push(server);
  return path;
}
const body = (socketPath: string | null, url = "http://127.0.0.1:1") => ({ pid: 1, startTime: "s", url, socketPath, version: "0.1.0" });

describe("identify (spec §5: liveness is a request, never the pid alone)", () => {
  it("answers when the socket panel.json names serves the summary", async () => {
    const r = await root();
    writePanelJson(join(r, "panel.json"), body(await socketPanel(r)));
    expect((await identifyPanel(join(r, "panel.json"))).answering).toBe(true);
  });

  it("a panel that answers with an error status is not answering, over the socket and over the url", async () => {
    const r = await root();
    writePanelJson(join(r, "panel.json"), body(await socketPanel(r, 503)));
    expect(await identifyPanel(join(r, "panel.json"))).toMatchObject({ answering: false, reason: "summary answered 503" });
    const server = createHttp(answering(503));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    writePanelJson(join(r, "panel.json"), body(null, `http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    expect(await identifyPanel(join(r, "panel.json"))).toMatchObject({ answering: false, reason: "GET / answered 503" });
  });

  it("does not answer for a dead socket, a missing file or a broken file", async () => {
    const r = await root();
    writePanelJson(join(r, "panel.json"), body(join(r, "gone.sock")));
    expect(await identifyPanel(join(r, "panel.json"))).toMatchObject({ answering: false, reason: expect.stringContaining("panel-not-running") });
    expect(await identifyPanel(join(r, "none.json"))).toMatchObject({ answering: false, panel: null, reason: expect.stringContaining("no panel.json") });
    await writeFile(join(r, "bad.json"), "{");
    expect(await identifyPanel(join(r, "bad.json"))).toMatchObject({ answering: false, reason: expect.stringContaining("invalid") });
    // A read that fails other than ENOENT (here ENOTDIR: the parent is a regular file) is a reason, not a rejection.
    expect(await identifyPanel(join(r, "bad.json", "panel.json"))).toMatchObject({ answering: false, panel: null, reason: expect.stringContaining("ENOTDIR") });
  });

  it("plan D12: with no socket, GET / on the panel's url", async () => {
    const r = await root();
    const server = createHttp(answering(200));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    writePanelJson(join(r, "panel.json"), body(null, `http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    expect((await identifyPanel(join(r, "panel.json"))).answering).toBe(true);
  });
});

describe("status (spec §4, §8)", () => {
  it("a manager that says running while the socket is dead is reported as not answering, with the log's last lines", () => {
    const s = statusLines("launchd", { loaded: true, state: "running", pid: 42 }, { answering: false, panel: null, reason: "panel-not-running" }, ["rejected: panel-bind-failed: 127.0.0.1:7777: EADDRINUSE"], "/l/panel.err.log");
    expect(s.code).toBe(1);
    expect(s.lines).toEqual([
      "manager: launchd running pid=42",
      "panel: not answering: panel-not-running",
      "last lines of /l/panel.err.log:",
      "  rejected: panel-bind-failed: 127.0.0.1:7777: EADDRINUSE",
    ]);
  });

  it("answers 0 only when the panel answered, and notes a pid the manager does not know", () => {
    const panel = body("/s/control.sock", "http://127.0.0.1:7777");
    const s = statusLines("systemd", { loaded: true, state: "active/running restarts=0", pid: 9 }, { answering: true, panel }, [], "/l");
    expect(s.code).toBe(0);
    expect(s.lines).toEqual([
      "manager: systemd active/running restarts=0 pid=9",
      "panel: answering at http://127.0.0.1:7777 (socket /s/control.sock, pid 1, version 0.1.0)",
      "note: the manager's pid 9 is not panel.json's pid 1",
    ]);
  });

  it("names a manager that has nothing loaded, and still exits 1 with no log lines to show", () => {
    const s = statusLines("systemd", { loaded: false, state: "inactive", pid: null }, { answering: false, panel: null, reason: "no panel.json at /p/panel.json" }, [], "/l");
    expect(s).toEqual({ code: 1, lines: ["manager: systemd not loaded pid=-", "panel: not answering: no panel.json at /p/panel.json"] });
  });
});

describe("discovery reads panel.json first after the flag (spec §5)", () => {
  async function listenSocket(dir: string) {
    await mkdir(dir, { recursive: true });
    const server = createNet();
    await new Promise<void>((resolve) => server.listen(join(dir, "control.sock"), resolve));
    servers.push(server);
    return join(dir, "control.sock");
  }

  it("prefers a live panel.json socket over the projects file, and the flag over both", async () => {
    const r = await root();
    const live = await listenSocket(join(r, "svc"));
    await mkdir(join(r, "p"));
    writePanelJson(join(r, "p", "panel.json"), body(live));
    const projects = join(r, "projects.json");
    await writeFile(projects, JSON.stringify({ version: 1, controlStateDir: join(r, "fromfile"), projects: [] }));
    const env = { ORCA_PANEL_DIR: join(r, "p"), ORCA_PROJECTS_FILE: projects, ORCA_CONTROL_DIR: join(r, "ctl") };
    expect(discoverSocketPath({ env })).toBe(live);
    expect(discoverSocketPath({ stateDirFlag: join(r, "flag"), env })).toBe(join(r, "flag", "control.sock"));
  });

  it("falls through when panel.json names no socket or a path that is not one; refuses a broken panel.json", async () => {
    const r = await root();
    await mkdir(join(r, "p"));
    const env = { ORCA_PANEL_DIR: join(r, "p"), ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: join(r, "ctl") };
    writePanelJson(join(r, "p", "panel.json"), body(null));
    expect(discoverSocketPath({ env })).toBe(join(r, "ctl", "panel", "control.sock"));
    writePanelJson(join(r, "p", "panel.json"), body(join(r, "not-a-socket")));
    expect(discoverSocketPath({ env })).toBe(join(r, "ctl", "panel", "control.sock"));
    await writeFile(join(r, "p", "panel.json"), "{");
    expect(() => discoverSocketPath({ env })).toThrow(expect.objectContaining({ code: "control-panel-json-invalid" }));
    // ORCA_PANEL_DIR names a regular file: ENOTDIR is refused by name, like the projects file (final review I1).
    expect(() => discoverSocketPath({ env: { ...env, ORCA_PANEL_DIR: join(r, "p", "panel.json") } }))
      .toThrow(expect.objectContaining({ code: "control-panel-json-invalid", message: expect.stringContaining("ENOTDIR") }));
  });

  // Task 9 review: a SIGKILLed or rebooted service panel leaves panel.json and its socket file behind. Its dead pid must
  // not shadow the live legacy --repo panel that the control-root scan (agent-entry spec §14) would find.
  it("a panel.json whose pid is dead falls through to the legacy socket under the control root", async () => {
    const r = await root();
    const stale = await listenSocket(join(r, "svc"));
    const child = spawnSync(process.execPath, ["-e", ""]);
    expect(child.status).toBe(0);
    await mkdir(join(r, "p"));
    writePanelJson(join(r, "p", "panel.json"), { ...body(stale), pid: child.pid! });
    const legacy = await listenSocket(join(r, "ctl", "orca-aaaa"));
    const env = { ORCA_PANEL_DIR: join(r, "p"), ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: join(r, "ctl") };
    expect(discoverSocketPath({ env })).toBe(legacy);
    // The same file with a live pid wins: the fall-through above is the pid, not the fixture.
    writePanelJson(join(r, "p", "panel.json"), { ...body(stale), pid: process.pid });
    expect(discoverSocketPath({ env })).toBe(stale);
  });

  // Plan Task 3 ruling carried here: panelDir() does not check absoluteness, so discovery must not resolve a relative
  // ORCA_PANEL_DIR against whatever directory the agent happens to run in. The relative path below does lead, from
  // this process's cwd, to a live panel.json -- discovery must not follow it, and must leave the directory as it was.
  it("a relative ORCA_PANEL_DIR is read as nothing: discovery falls through and writes nothing there", async () => {
    const r = await root();
    const live = await listenSocket(join(r, "svc"));
    await mkdir(join(r, "p"));
    writePanelJson(join(r, "p", "panel.json"), body(live));
    const rel = relative(process.cwd(), join(r, "p"));
    expect(rel.startsWith("/")).toBe(false);
    const env = { ORCA_PANEL_DIR: rel, ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: join(r, "ctl") };
    expect(discoverSocketPath({ env })).toBe(join(r, "ctl", "panel", "control.sock"));
    // Same env with the absolute spelling finds it: the fall-through above is the relativity, not a broken fixture.
    expect(discoverSocketPath({ env: { ...env, ORCA_PANEL_DIR: join(r, "p") } })).toBe(live);
    expect(await readdir(join(r, "p"))).toEqual(["panel.json"]);
  });
});

describe("discovery stays light (pre-flight P20)", () => {
  // `orca control` and `orca mcp serve` load discovery.ts; reading one JSON file must not load the panel server (express,
  // the control runtime). Walks the value imports (not `import type`) transitively from discovery.ts.
  it("no module discovery.ts reaches at run time is the panel server or the service config", () => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/^(?:import|export)(?!\s+type\b)[^;]*?from\s+"(\.[^"]+)"|^import\s+"(\.[^"]+)"/gm)) walk(resolve(dirname(file), (m[1] ?? m[2])!.replace(/\.js$/, ".ts")));
    };
    const src = resolve(__dirname, "../../src");
    walk(join(src, "entry", "discovery.ts"));
    expect(seen.has(join(src, "service", "instance.ts"))).toBe(true);
    expect([...seen].filter((f) => f === join(src, "panel", "server.ts") || f === join(src, "service", "config.ts")).map((f) => relative(src, f))).toEqual([]);
  });
});
