// CLI browser login spec (2026-11-11) §6, the panel's half (#208): `orca auth login` asks the control socket for a login
// request; an owner signed in to the Web panel approves its code; the CLI collects the person token with a separate request
// id. The token is minted only at collect, after the approver is read again. Every panel here has its own temp control root
// and state dir (Rule 17): nothing reads or writes the person's ~/.orca.
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNTS_FILE, openAccountsStore } from "../../src/panel/accounts/store.js";
import { controlRoot } from "../../src/panel/controlOptions.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { login, seedUser, sessionFor, type Session } from "./fixtures/auth.js";
import { overSocket, trackSocketPanel, untrackSocketPanel, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

useSocketPanels();

const CODE = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;
const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" });
type Workspace = Awaited<ReturnType<typeof workspace>>;

/** A panel whose one clock (PanelOptions.now) the criterion moves. */
async function bootAt(w: Workspace, clock: { now: number }): Promise<StartedPanel> {
  const opts = parsePanelArgs(["--by", "tester", "--repo", `proj=${w.repo}`, "--control-state-dir", w.state], w.env);
  opts.now = () => new Date(clock.now);
  return trackSocketPanel(await createPanelServer(opts, w.env));
}

async function setUp() {
  const w = await workspace();
  execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: gitEnv() });
  const clock = { now: Date.now() };
  const panel = await bootAt(w, clock);
  const owner = await sessionFor(panel, w.env);
  const socket = (path: string, body: unknown, headers: Record<string, string> = {}, at = panel) =>
    overSocket(at.socketPath!, "POST", `/api/control/${path}`, { "x-orca-client": "cli:test", ...headers }, body);
  const json = (res: { text: string }) => JSON.parse(res.text) as Record<string, any>;
  const codeOf = (res: { status: number; text: string }): [number, string] => {
    const body = json(res);
    return [res.status, body.error?.code ?? body.code ?? "ok"];
  };
  const start = async (headers: Record<string, string> = {}) => {
    const res = await socket("person/cli-login", { pid: 4242, ppid: 4241, cwd: "/work/here", startedAt: clock.now - 1000 }, headers);
    return { res, body: json(res) as { requestId: string; code: string; url: string; expiresAt: number; pollMs: number } };
  };
  const poll = (requestId: string, at = panel) => socket("person/cli-login/poll", { requestId }, {}, at);
  const view = (session: Session, code: string) => session.fetch(`/api/auth/cli-login/${code}`);
  const act = (session: Session, code: string, action: "approve" | "deny") =>
    session.fetch(`/api/auth/cli-login/${code}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const cliSessions = (): number => {
    const store = openAccountsStore(controlRoot(w.env));
    try { return (store.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'cli'").get() as { n: number }).n; } finally { store.close(); }
  };
  const setLimit = (commandId: string, token: string) => socket("groups/nogroup/set-limit",
    { commandId, expectedRevision: 0, payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } }, { "x-orca-person-token": token });
  return { w, clock, panel, owner, socket, json, codeOf, start, poll, view, act, cliSessions, setLimit };
}

const res2 = async (res: Response): Promise<{ status: number; text: string }> => ({ status: res.status, text: await res.text() });

function rawRequest(url: string, method: string, path: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(method === "GET" ? undefined : "{}");
  });
}

describe("orca auth login, the panel's half (CLI browser login spec §6)", { timeout: 60_000 }, () => {
  it("start answers a request id, a code, the loopback URL with the code in the hash, the expiry and the poll interval -- and no token", async () => {
    const { panel, clock, start, cliSessions } = await setUp();
    const { res, body } = await start();
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["code", "expiresAt", "pollMs", "requestId", "url"]);
    expect(body.code).toMatch(CODE);
    // 32 random bytes, base64url: 43 characters, never the code.
    expect(body.requestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.url).toBe(`http://127.0.0.1:${panel.port}/#cli-login/${body.code}`);
    expect(body.expiresAt).toBe(clock.now + 300_000);
    expect(body.pollMs).toBeGreaterThan(0);
    expect(cliSessions()).toBe(0);
  });

  it("a poll before approval answers pending at once and leaves no session", async () => {
    const { start, poll, json, cliSessions } = await setUp();
    const { body } = await start();
    const answer = await poll(body.requestId);
    expect([answer.status, json(answer).state, typeof json(answer).pollMs]).toEqual([200, "pending", "number"]);
    expect(json(answer).token).toBeUndefined();
    expect(cliSessions()).toBe(0);
  });

  it("an owner's approval, then the CLI's collect, issues a working person token; the approval alone issues nothing", async () => {
    const { w, owner, start, poll, view, act, json, cliSessions, setLimit, codeOf } = await setUp();
    const { body } = await start();
    const seen = await res2(await view(owner, body.code));
    expect(seen.status).toBe(200);
    const page = json(seen);
    expect(page).toMatchObject({
      code: body.code, state: "pending", expiresAt: body.expiresAt, account: { name: "tester" }, tokenDays: 15,
      reported: { client: "cli:test", pid: 4242, ppid: 4241, cwd: "/work/here", verified: false },
    });
    expect(typeof page.requestedAt).toBe("number");
    expect(typeof page.reported.startedAt).toBe("number");
    const approved = await res2(await act(owner, body.code, "approve"));
    expect([approved.status, json(approved).state]).toEqual([200, "approved"]);
    // Mutation "mint on approve" -> a session exists before anyone collects -> red.
    expect(cliSessions()).toBe(0);
    const collected = await poll(body.requestId);
    expect(collected.status).toBe(200);
    const token = json(collected) as { token: string; sid: string; user: { id: string; name: string }; expiresAt: number };
    expect(Object.keys(token).sort()).toEqual(["expiresAt", "sid", "token", "user"]);
    expect(token.user.name).toBe("tester");
    // Past the token gate: the service answers (no such group).
    expect(codeOf(await setLimit("sl-cli-login", token.token))).toEqual([404, "group-not-found"]);
    const store = openAccountsStore(controlRoot(w.env));
    try {
      const row = store.db.prepare("SELECT kind, expires_at FROM sessions WHERE id = ?").get(token.sid) as { kind: string; expires_at: number };
      expect([row.kind, row.expires_at]).toEqual(["cli", token.expiresAt]);
    } finally { store.close(); }
    // Neither id nor the token in what the Web was told.
    for (const text of [seen.text, approved.text]) {
      expect(text.includes(body.requestId)).toBe(false);
      expect(text.includes(token.token)).toBe(false);
    }
  });

  it("is single use: the request id is consumed by a collect, the code by an approval", async () => {
    const { owner, start, poll, act, codeOf } = await setUp();
    const { body } = await start();
    expect((await act(owner, body.code, "approve")).status).toBe(200);
    // Mutation "skip the single-use delete" -> a second collect mints a second token -> red.
    expect((await poll(body.requestId)).status).toBe(200);
    expect(codeOf(await poll(body.requestId))).toEqual([404, "cli-login-unknown"]);
    expect(codeOf(await res2(await act(owner, body.code, "approve")))).toEqual([404, "cli-login-unknown"]);
    expect(codeOf(await res2(await act(owner, body.code, "deny")))).toEqual([404, "cli-login-unknown"]);
  });

  it("deny: the collect is refused cli-login-denied and no session exists", async () => {
    const { owner, start, poll, act, json, codeOf, cliSessions } = await setUp();
    const { body } = await start();
    const denied = await res2(await act(owner, body.code, "deny"));
    expect([denied.status, json(denied).state]).toEqual([200, "denied"]);
    expect(codeOf(await res2(await act(owner, body.code, "approve")))).toEqual([404, "cli-login-unknown"]);
    expect(codeOf(await poll(body.requestId))).toEqual([403, "cli-login-denied"]);
    expect(cliSessions()).toBe(0);
  });

  it("expires by the panel's clock: past the expiry the code and the request id answer cli-login-expired", async () => {
    const { owner, clock, start, poll, view, act, codeOf, cliSessions } = await setUp();
    const { body } = await start();
    clock.now += 299_000;
    expect(codeOf(await poll(body.requestId))).toEqual([200, "ok"]);
    clock.now += 2_000;
    expect(codeOf(await res2(await view(owner, body.code)))).toEqual([409, "cli-login-expired"]);
    expect(codeOf(await res2(await act(owner, body.code, "approve")))).toEqual([409, "cli-login-expired"]);
    expect(codeOf(await poll(body.requestId))).toEqual([409, "cli-login-expired"]);
    expect(cliSessions()).toBe(0);
  });

  it("a member may neither see nor approve a request (owner-required); the request stays pending", async () => {
    const { w, panel, start, poll, view, act, codeOf, json } = await setUp();
    seedUser(controlRoot(w.env), "amy", "member");
    const amy = await login(panel.url, "amy");
    const { body } = await start();
    // Mutation "drop the owner check" -> 200 -> red.
    expect(codeOf(await res2(await view(amy, body.code)))).toEqual([403, "owner-required"]);
    expect(codeOf(await res2(await act(amy, body.code, "approve")))).toEqual([403, "owner-required"]);
    expect(json(await poll(body.requestId)).state).toBe("pending");
  });

  it("the Web routes sit behind the session, CSRF, forced-password-change and Host checks", async () => {
    const { w, panel, owner, start, poll, json, codeOf } = await setUp();
    const { body } = await start();
    const path = `/api/auth/cli-login/${body.code}`;
    const host = `127.0.0.1:${panel.port}`;
    expect(codeOf(await rawRequest(panel.url, "GET", path, { host }))).toEqual([401, "login-required"]);
    expect(codeOf(await rawRequest(panel.url, "POST", `${path}/approve`, { host, cookie: owner.cookie, "content-type": "application/json" }))).toEqual([403, "csrf-required"]);
    expect(codeOf(await rawRequest(panel.url, "GET", path, { host: `evil.example:${panel.port}`, cookie: owner.cookie }))).toEqual([403, "panel-host-not-allowed"]);
    seedUser(controlRoot(w.env), "newbie", "owner");
    const fresh = await login(panel.url, "newbie");
    const db = new DatabaseSync(join(controlRoot(w.env), ACCOUNTS_FILE));
    try { db.prepare("UPDATE users SET must_change_password = 1 WHERE name = 'newbie'").run(); } finally { db.close(); }
    expect(codeOf(await rawRequest(panel.url, "POST", `${path}/approve`, { host, cookie: fresh.cookie, "x-orca-csrf": fresh.csrf, "content-type": "application/json" }))).toEqual([403, "password-change-required"]);
    expect(json(await poll(body.requestId)).state).toBe("pending");
  });

  it("an approver disabled before the collect gets no token", async () => {
    const { w, owner, start, poll, act, codeOf, cliSessions } = await setUp();
    const { body } = await start();
    expect((await act(owner, body.code, "approve")).status).toBe(200);
    const store = openAccountsStore(controlRoot(w.env));
    try {
      const tester = store.findByName("tester")!;
      store.disableUser(tester.id, Date.now(), "test");
    } finally { store.close(); }
    // Mutation "skip the re-read at collect" -> a token for a disabled account -> red.
    expect(codeOf(await poll(body.requestId))).toEqual([403, "cli-login-denied"]);
    expect(cliSessions()).toBe(0);
  });

  it("refuses a start that carries the dispatched-run marker", async () => {
    const { start, codeOf } = await setUp();
    // Mutation "drop the socket-side marker refusal" -> 200 -> red.
    const { res } = await start({ "x-orca-dispatched-run": "run-1" });
    expect(codeOf(res)).toEqual([403, "control-dispatched-run-refused"]);
  });

  it("holds at most 16 open requests: the 17th start is refused cli-login-busy", async () => {
    const { start, codeOf } = await setUp();
    for (let i = 0; i < 16; i += 1) expect((await start()).res.status).toBe(200);
    expect(codeOf((await start()).res)).toEqual([429, "cli-login-busy"]);
  });

  it("an unknown request id answers cli-login-unknown; after a restart the open request is unknown", async () => {
    const { w, clock, panel, start, poll, codeOf } = await setUp();
    expect(codeOf(await poll("A".repeat(43)))).toEqual([404, "cli-login-unknown"]);
    const { body } = await start();
    const began = Date.now();
    await panel.close();
    untrackSocketPanel(panel);
    // No poll is ever held open, so closing does not wait on one (launchd's ExitTimeOut is 20 s).
    expect(Date.now() - began).toBeLessThan(5_000);
    const again = await bootAt(w, clock);
    expect(codeOf(await poll(body.requestId, again))).toEqual([404, "cli-login-unknown"]);
  });
});
