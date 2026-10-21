// CLI v2 spec §15.3, §15.5, §15.6 criterion 10 (plan Task 11): the person token on the panel's side. `orca login`'s
// socket route mints a token that is its own accounts session (kind `cli`, fixed lifetime), the socket verifies it on
// x-orca-person-token (401 control-person-token-invalid when it is not live), the Web lists and revokes CLI sessions
// next to browser ones, and the two kinds never stand in for each other.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNTS_FILE, openAccountsStore } from "../../src/panel/accounts/store.js";
import { controlRoot } from "../../src/panel/controlOptions.js";
import { attributionOf } from "../../src/panel/permissions.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { login, seedUser, sessionFor, TEST_PASSWORD } from "./fixtures/auth.js";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

useSocketPanels();

const AMOUNT = { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 };
const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" });
const ledger = (state: string): string[] => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};

async function setUp() {
  const w = await workspace();
  execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: gitEnv() });
  const panel = await boot(w, [], { port: true }) as StartedPanel;
  const owner = await sessionFor(panel, w.env);
  const socket = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    overSocket(panel.socketPath!, "POST", `/api/control/${path}`, { "x-orca-client": "cli:test", ...headers }, body);
  const answer = (res: { status: number; text: string }): [number, string] => [res.status, (JSON.parse(res.text) as { error?: { code: string } }).error?.code ?? "ok"];
  const personLogin = async (name: string, password = TEST_PASSWORD) => {
    const res = await socket("person/login", { name, password });
    return { res, body: JSON.parse(res.text) as { token: string; sid: string; user: { id: string; name: string }; expiresAt: number } };
  };
  const setLimit = (commandId: string, headers: Record<string, string> = {}) => socket("groups/nogroup/set-limit", { commandId, expectedRevision: 0, payload: { limit: AMOUNT } }, headers);
  return { w, panel, owner, socket, answer, personLogin, setLimit };
}

describe("the person token on the socket (CLI v2 spec §15.3)", { timeout: 60_000 }, () => {
  it("mints a cli session of fixed lifetime for the right password only, throttled as the Web login", async () => {
    const { w, socket, answer, personLogin } = await setUp();
    expect(answer(await socket("person/login", { name: "tester", password: "wrong-password-x" }))).toEqual([401, "login-failed"]);
    const { res, body } = await personLogin("tester");
    expect(res.status).toBe(200);
    expect(body.user.name).toBe("tester");
    const store = openAccountsStore(controlRoot(w.env));
    try {
      const row = store.db.prepare("SELECT kind, created_at, expires_at FROM sessions WHERE id = ?").get(body.sid) as { kind: string; created_at: number; expires_at: number };
      // The Web session length (15 days by default), fixed: the CLI never refreshes it.
      // (exp is whole seconds, as the Web token's.)
      expect([row.kind, row.expires_at - Math.floor(row.created_at / 1000) * 1000, body.expiresAt]).toEqual(["cli", 15 * 86_400_000, row.expires_at]);
    } finally { store.close(); }
  });

  it("opens the token tier with a live token; refuses a dead, foreign or browser token 401 control-person-token-invalid", async () => {
    const { w, panel, owner, answer, personLogin, setLimit, socket } = await setUp();
    const { body } = await personLogin("tester");
    const token = { "x-orca-person-token": body.token };
    expect(answer(await setLimit("sl-none"))).toEqual([403, "control-person-token-required"]);
    // Past the gate: the service answers (no such group) and the command is booked.
    expect(answer(await setLimit("sl-token", token))).toEqual([404, "group-not-found"]);
    expect(answer(await setLimit("sl-junk", { "x-orca-person-token": "not-a-token" }))).toEqual([401, "control-person-token-invalid"]);
    // A browser session's token is not a person token (and the reverse below): each kind is checked.
    const browser = owner.cookie.split("; ")[0]!.slice("orca_at=".length);
    expect(answer(await setLimit("sl-browser", { "x-orca-person-token": browser }))).toEqual([401, "control-person-token-invalid"]);
    expect(ledger(w.state).filter((id) => id.startsWith("sl-")).sort()).toEqual(["sl-token"]);
    // Logout revokes that sid: the same token is dead.
    expect(answer(await socket("person/logout", {}, token))).toEqual([200, "ok"]);
    expect(answer(await setLimit("sl-after", token))).toEqual([401, "control-person-token-invalid"]);
    // A read with a dead token is refused too: the header is checked before any route.
    const read = await overSocket(panel.socketPath!, "GET", "/api/control/summary", { "x-orca-client": "cli", "x-orca-person-token": body.token });
    expect(answer(read)).toEqual([401, "control-person-token-invalid"]);
  });

  it("a cli token is no Web session", async () => {
    const { panel, personLogin } = await setUp();
    const { body } = await personLogin("tester");
    const me = await fetch(`${panel.url}/api/auth/me`, { headers: { cookie: `orca_at=${body.token}` } });
    expect(me.status).toBe(401);
  });

  it("a member's token does not open the token tier: the member's own refusal, as on the Web (I3)", async () => {
    const { w, answer, personLogin, setLimit } = await setUp();
    seedUser(controlRoot(w.env), "amy", "member");
    const { body } = await personLogin("amy");
    expect(answer(await setLimit("sl-member", { "x-orca-person-token": body.token }))).toEqual([403, "control-verb-human-only"]);
  });

  it("attributes a token call to the token's person, by the socket's client (spec §16)", () => {
    expect(attributionOf({ kind: "agent", client: "cli:claude", person: { userId: "u9", name: "ana", roles: ["owner"] } }, "tester")).toEqual({ by: "ana", via: "cli:claude" });
  });
});

describe("CLI sessions in the Web UI's account settings (spec §15.3)", { timeout: 60_000 }, () => {
  it("lists the user's browser and CLI sessions; revoking the CLI one kills its token; another user's is not found", async () => {
    const { w, panel, owner, answer, personLogin, setLimit } = await setUp();
    const { body } = await personLogin("tester");
    const listed = await owner.fetch("/api/auth/sessions");
    expect(listed.status).toBe(200);
    const sessions = ((await listed.json()) as { sessions: Array<{ sid: string; kind: string; current: boolean }> }).sessions;
    expect(sessions.map((s) => [s.kind, s.current]).sort()).toEqual([["browser", true], ["cli", false]]);
    expect(sessions.find((s) => s.kind === "cli")!.sid).toBe(body.sid);
    seedUser(controlRoot(w.env), "bob", "owner");
    const bob = await login(panel.url, "bob");
    const foreign = await bob.fetch(`/api/auth/sessions/${body.sid}/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(foreign.status).toBe(404);
    expect(answer(await setLimit("sl-live", { "x-orca-person-token": body.token }))).toEqual([404, "group-not-found"]);
    const revoked = await owner.fetch(`/api/auth/sessions/${body.sid}/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(revoked.status).toBe(200);
    expect(answer(await setLimit("sl-revoked", { "x-orca-person-token": body.token }))).toEqual([401, "control-person-token-invalid"]);
    const after = ((await (await owner.fetch("/api/auth/sessions")).json()) as { sessions: Array<{ kind: string }> }).sessions;
    expect(after.map((s) => s.kind)).toEqual(["browser"]);
  });
});

describe("accounts schema 1 → 2 (sessions.kind)", () => {
  it("adds kind to a version-1 store, existing sessions read as browser, and records version 2", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-acct-"));
    try {
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
      const db = new DatabaseSync(join(root, ACCOUNTS_FILE));
      db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, roles TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER, must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))) STRICT;
        CREATE TABLE sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER) STRICT;
        INSERT INTO meta VALUES ('accountsSchemaVersion','1');
        INSERT INTO users VALUES ('u1','ana','h','["owner"]',1,NULL,0);
        INSERT INTO sessions VALUES ('s1','u1',1,9999999999999,NULL);`);
      db.close();
      const store = openAccountsStore(root);
      try {
        expect(store.db.prepare("SELECT value FROM meta WHERE key='accountsSchemaVersion'").get()).toEqual({ value: "2" });
        expect(store.listSessions("u1", 2)).toEqual([{ sid: "s1", kind: "browser", createdAt: 1, expiresAt: 9999999999999 }]);
      } finally { store.close(); }
      // Opening again is a no-op.
      openAccountsStore(root).close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
