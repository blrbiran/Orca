// CLI browser login spec (2026-11-11) §6, the CLI's half (#208): `orca auth login` asks the panel for a login request,
// prints its code and URL, opens the browser through the io's `openUrl` seam (a fake here: no criterion opens a real
// browser), polls until the token is collected, and stores it as `orca login` does. The token store is a temp
// ORCA_PERSON_DIR in every case (Rule 17): nothing here reads or writes the person's real ~/.orca.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserAllowed, PERSON_TOKEN_SCHEMA } from "../../src/commands/person.js";
import { runRegistered } from "../../src/commands/run.js";
import type { CommandIo } from "../../src/commands/types.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { sessionFor } from "../panel/fixtures/auth.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";
import { cli, fakePanel, useFakePanels, type Recorded, type Route } from "./fixtures/fakePanel.js";

useFakePanels();
useSocketPanels();

// Rule 17 guard: nothing in this file touches the person's real ~/.orca.
const REAL = join(homedir(), ".orca");
const stamp = (): string => (existsSync(REAL) ? String(statSync(REAL).mtimeMs) : "absent");
let before = "";
beforeAll(() => { before = stamp(); });
afterAll(() => { expect(stamp()).toBe(before); });

const REQUEST_ID = "R".repeat(43);
const TOKEN = "fake.person.token-value";
const mode = (path: string): number => statSync(path).mode & 0o777;

function startAnswer(url = "http://127.0.0.1:4321/#cli-login/ABCD-EFGH"): Route {
  return { status: 200, body: { requestId: REQUEST_ID, code: "ABCD-EFGH", url, expiresAt: Date.now() + 300_000, pollMs: 1 } };
}
const tokenAnswer = { status: 200, body: { token: TOKEN, sid: "sid-1", user: { id: "u1", name: "ana" }, expiresAt: 1_900_000_000_000 } };
const pending = { status: 200, body: { state: "pending", pollMs: 1 } };

/** A fake panel answering start, then `polls` pending answers, then `last`. */
async function panelWith(options: { url?: string; polls?: number; last?: Route } = {}) {
  const panel = await fakePanel({
    "POST person/cli-login": startAnswer(options.url),
    "POST person/cli-login/poll": (request: Recorded, nth: number) => {
      if (nth < (options.polls ?? 2)) return pending;
      const last = options.last ?? tokenAnswer;
      return typeof last === "function" ? last(request, nth) : last;
    },
    "POST person/cli-login/cancel": { status: 200, body: { state: "cancelled" } },
  });
  const personDir = join(panel.dir, "person");
  const opened: string[] = [];
  const run = (argv: string[], env: NodeJS.ProcessEnv = {}, extra: Partial<CommandIo> = {}) => cli(argv, panel.dir, {
    env: { ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: "/nonexistent/p.json", ORCA_PERSON_DIR: personDir, ...env },
    openUrl: async (url: string) => { opened.push(url); }, ...extra,
  });
  const paths = () => panel.requests.map((request) => request.path);
  return { panel, personDir, opened, run, paths };
}

describe("orca auth login against a stand-in panel (CLI browser login spec §6)", { timeout: 60_000 }, () => {
  it("prints the code and URL first, opens the URL once, polls until the token, and stores it with orca login's modes", async () => {
    const { panel, personDir, opened, run, paths } = await panelWith();
    const result = await run(["auth", "login"], { DISPLAY: ":0" });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout.split("\n")[0]).toBe("Code ABCD-EFGH: approve it in the browser at http://127.0.0.1:4321/#cli-login/ABCD-EFGH");
    expect(opened).toEqual(["http://127.0.0.1:4321/#cli-login/ABCD-EFGH"]);
    expect(paths()).toEqual(["person/cli-login", "person/cli-login/poll", "person/cli-login/poll", "person/cli-login/poll"]);
    // The start reports who asks (unverified, spec §6.2) and is attributed to the CLI.
    const start = panel.requests[0]!;
    expect(start.headers["x-orca-client"]).toBe("cli");
    expect(start.headers["x-orca-dispatched-run"]).toBeUndefined();
    expect(JSON.parse(start.text)).toEqual({ pid: process.pid, ppid: process.ppid, cwd: "/", startedAt: expect.any(Number) });
    for (const poll of panel.requests.slice(1)) expect(JSON.parse(poll.text)).toEqual({ requestId: REQUEST_ID });
    const file = join(personDir, "token.json");
    expect([mode(personDir), mode(file)]).toEqual([0o700, 0o600]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ schema: PERSON_TOKEN_SCHEMA, token: TOKEN, sid: "sid-1", user: "ana", expiresAt: 1_900_000_000_000 });
    // Neither the token nor the request id is ever printed.
    for (const text of [result.stdout, result.stderr]) {
      expect(text.includes(TOKEN)).toBe(false);
      expect(text.includes(REQUEST_ID)).toBe(false);
    }
  });

  it("--no-browser never opens one; neither does an SSH session on macOS or a Linux session without a display", async () => {
    const one = await panelWith();
    // Mutation "--no-browser ignored" -> one call -> red.
    expect((await one.run(["auth", "login", "--no-browser"], { DISPLAY: ":0" })).code).toBe(0);
    expect(one.opened).toEqual([]);
    const ssh = await panelWith();
    // No DISPLAY either, so this holds on macOS (SSH) and on Linux (no display) alike.
    expect((await ssh.run(["auth", "login"], { SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" })).code).toBe(0);
    expect(ssh.opened).toEqual([]);
    expect(browserAllowed("darwin", {}, false)).toBe(true);
    expect(browserAllowed("darwin", { SSH_CONNECTION: "x" }, false)).toBe(false);
    expect(browserAllowed("darwin", { SSH_TTY: "/dev/ttys001" }, false)).toBe(false);
    expect(browserAllowed("linux", { DISPLAY: ":0" }, false)).toBe(true);
    expect(browserAllowed("linux", { WAYLAND_DISPLAY: "wayland-0" }, false)).toBe(true);
    expect(browserAllowed("linux", {}, false)).toBe(false);
    expect(browserAllowed("darwin", {}, true)).toBe(false);
  });

  it("a browser that cannot be opened only prints: the login goes on", async () => {
    const { run } = await panelWith();
    const result = await run(["auth", "login"], { DISPLAY: ":0" }, { openUrl: async () => { throw new Error("spawn open ENOENT"); } });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("could not open a browser");
  });

  it("refuses a URL that is not a loopback http URL of the expected shape: opens nothing, stores nothing, cancels the request", async () => {
    for (const url of ["http://evil.example:4321/#cli-login/ABCD-EFGH", "https://127.0.0.1:4321/#cli-login/ABCD-EFGH",
      "http://127.0.0.1:4321/x#cli-login/ABCD-EFGH", "http://127.0.0.1:4321/#cli-login/ABCD-EFGH&x", "http://10.0.0.5:4321/#cli-login/ABCD-EFGH"]) {
      const { opened, run, paths, personDir } = await panelWith({ url });
      const result = await run(["auth", "login"], { DISPLAY: ":0" });
      // Mutation "URL validation removed" -> opened and logged in -> red.
      expect([result.code, opened, existsSync(personDir)], url).toEqual([2, [], false]);
      expect(result.stderr, url).toContain("cli-login-url-invalid");
      expect(paths(), url).toEqual(["person/cli-login", "person/cli-login/cancel"]);
    }
    for (const url of ["http://localhost:1/#cli-login/ABCD-EFGH", "http://[::1]:65535/#cli-login/ABCD-EFGH", "http://127.9.0.1:80/#cli-login/ABCD-EFGH"]) {
      const { run } = await panelWith({ url });
      expect((await run(["auth", "login"], { DISPLAY: ":0" })).code, url).toBe(0);
    }
  });

  it("a denied, expired or unknown request exits 2 by name and stores nothing", async () => {
    for (const [code, status] of [["cli-login-denied", 403], ["cli-login-expired", 409], ["cli-login-unknown", 404]] as const) {
      const { run, personDir } = await panelWith({ polls: 1, last: { status, body: { error: { code, message: "m", commandRevision: null, evidenceIds: [], retryable: false } } } });
      const result = await run(["auth", "login", "--no-browser"]);
      expect([result.code, existsSync(personDir)], code).toEqual([2, false]);
      expect(result.stderr, code).toContain(`orca: ${code}:`);
      if (code === "cli-login-unknown") expect(result.stderr).toContain("run orca auth login again");
    }
  });

  it("refuses under the dispatched-run marker before asking the panel or opening anything", async () => {
    const { run, paths, opened, personDir } = await panelWith();
    // Mutation "drop the CLI-side marker refusal" -> the request is sent -> red.
    const result = await run(["auth", "login"], { DISPLAY: ":0", ORCA_DISPATCHED_RUN: "run-1" });
    expect([result.code, paths(), opened, existsSync(personDir)]).toEqual([1, [], [], false]);
    expect(result.stderr).toContain("control-dispatched-run-refused");
  });

  it("refuses over MCP (cli-login-not-over-mcp) before asking the panel; auth status is allowed there", async () => {
    const { run, paths, opened } = await panelWith();
    // Mutation "drop the MCP refusal" -> the request is sent -> red.
    const result = await run(["auth", "login", "--json"], { DISPLAY: ":0" }, { client: "mcp:test" });
    expect([result.code, paths(), opened]).toEqual([1, [], []]);
    expect(result.json().body.error.code).toBe("cli-login-not-over-mcp");
    expect((await run(["auth", "status"], {}, { client: "mcp:test" })).stderr).toContain("person-token-missing");
  });

  it("on SIGINT while waiting, cancels the request (best effort) and stores nothing", async () => {
    const { run, paths, personDir } = await panelWith({ polls: 1_000_000 });
    const listening = process.listenerCount("SIGINT");
    const waiting = run(["auth", "login", "--no-browser"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Only the listener the command added is called, so the test runner's own handlers (if any) are left alone.
    expect(process.listenerCount("SIGINT")).toBe(listening + 1);
    (process.listeners("SIGINT").at(-1) as (signal: NodeJS.Signals) => void)("SIGINT");
    const result = await waiting;
    expect([result.code, existsSync(personDir)]).toEqual([130, false]);
    expect(paths().at(-1)).toBe("person/cli-login/cancel");
    expect(result.stderr).toContain("cancelled");
  });

  it("auth status prints the stored token's user and expiry, never the token; without one it is refused", async () => {
    const { run } = await panelWith();
    const none = await run(["auth", "status"]);
    expect([none.code, none.stderr]).toEqual([1, expect.stringContaining("person-token-missing")]);
    expect((await run(["auth", "login", "--no-browser"])).code).toBe(0);
    const status = await run(["auth", "status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toBe(`stored person token: ana, expires ${new Date(1_900_000_000_000).toISOString()}\n`);
    // Mutation "print the stored file" -> the token is on stdout -> red.
    expect(status.stdout.includes(TOKEN)).toBe(false);
  });
});

describe("orca auth login against a real panel (CLI browser login spec §6)", { timeout: 60_000 }, () => {
  const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" });

  it("an owner approving in the browser logs the terminal in; the token opens the token tier; auth logout revokes it", async () => {
    const w = await workspace();
    execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: gitEnv() });
    const panel = await boot(w, [], { port: true }) as StartedPanel;
    const owner = await sessionFor(panel, w.env);
    const personDir = join(w.root, "person");
    const env: NodeJS.ProcessEnv = { ...w.env, ORCA_PERSON_DIR: personDir, DISPLAY: ":0" };
    const opened: string[] = [];
    const run = async (argv: string[], extra: Partial<CommandIo> = {}) => {
      const out: string[] = [], err: string[] = [];
      const io: CommandIo = {
        stdout: (t) => out.push(t), stderr: (t) => err.push(t), env, cwd: w.root, stdinIsTTY: true,
        // The person, in the browser the URL opened: they read the page, then approve.
        openUrl: async (url) => {
          opened.push(url);
          const code = url.slice(url.indexOf("#cli-login/") + "#cli-login/".length);
          expect((await owner.fetch(`/api/auth/cli-login/${code}`)).status).toBe(200);
          const approved = await owner.fetch(`/api/auth/cli-login/${code}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          expect(approved.status).toBe(200);
        },
        ...extra,
      };
      const code = await runRegistered([...argv, "--control-state-dir", w.state], io);
      return { code, out: out.join(""), err: err.join("") };
    };
    const login = await run(["auth", "login"]);
    expect([login.code, login.err]).toEqual([0, ""]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${panel.port}/#cli-login/[A-Z0-9]{4}-[A-Z0-9]{4}$`));
    const file = join(personDir, "token.json");
    const stored = JSON.parse(readFileSync(file, "utf8")) as { token: string; user: string };
    expect(stored.user).toBe("tester");
    expect(login.out.includes(stored.token)).toBe(false);
    const write = async (commandId: string) => {
      const res = await run(["usage", "set-cap", "--scope", "all", "--period", "week", "--tokens", "5000", "--json", "--command-id", commandId, "--as-person"]);
      return [res.code, (JSON.parse(res.out) as { body: { error?: { code: string } } }).body.error?.code];
    };
    expect(await write("cc-auth-login")).toEqual([0, undefined]);
    const status = await run(["auth", "status"]);
    expect([status.code, status.out.startsWith("stored person token: tester, expires ")]).toEqual([0, true]);
    const copy = readFileSync(file, "utf8");
    const logout = await run(["auth", "logout"]);
    expect([logout.code, existsSync(file)]).toEqual([0, false]);
    writeFileSync(file, copy, { mode: 0o600 });
    expect(await write("cc-after-logout")).toEqual([2, "control-person-token-invalid"]);
  });
});
