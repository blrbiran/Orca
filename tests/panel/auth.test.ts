import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/panel/accounts/jwt.js";
import { AccountsRejection, openAccountsStore } from "../../src/panel/accounts/store.js";
import { createPanelAuth } from "../../src/panel/auth.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { login, seedUser, sessionFor, type Session } from "./fixtures/auth.js";

let tmp: string, root: string, env: NodeJS.ProcessEnv;
const panels: StartedPanel[] = [];

beforeEach(async () => {
  // A fresh control root per criterion: the default owner and its initial-password exist only on a store with no user.
  tmp = await mkdtemp(join(tmpdir(), "orca-auth-"));
  root = join(tmp, "control");
  env = { ...process.env, ORCA_CONTROL_DIR: root, ORCA_CORRECTIONS_DIR: join(tmp, "corrections") };
  await mkdir(join(tmp, "dist"));
  await writeFile(join(tmp, "dist", "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
});

afterEach(async () => {
  for (const panel of panels.splice(0)) await panel.close().catch(() => undefined);
  await rm(tmp, { recursive: true, force: true });
});

async function boot(extra: string[] = [], now?: () => Date): Promise<StartedPanel> {
  const opts = parsePanelArgs(["--by", "tester", "--dist", join(tmp, "dist"), ...extra], env);
  if (now !== undefined) opts.now = now;
  const panel = await createPanelServer(opts, env);
  panels.push(panel);
  return panel;
}

const json = { "content-type": "application/json" };

describe("login and sessions (spec §3.2-§3.4)", () => {
  it("answers 401 login-required with no cookie, and 200 after login, on a --no-control panel too (D1)", async () => {
    const panel = await boot(["--no-control"]);
    expect((await fetch(`${panel.url}/api/metrics`)).status).toBe(401);
    expect(await (await fetch(`${panel.url}/api/metrics`)).json()).toMatchObject({ code: "login-required" });
    const s = await sessionFor(panel, env);
    expect((await s.fetch("/api/metrics")).status).toBe(200);
  });

  it("the initial password reaches only the change step; the change deletes the file and lifts the gate", async () => {
    const panel = await boot();
    const initial = (await readFile(join(root, "initial-password"), "utf8")).trim();
    const s = await login(panel.url, "tester", initial);
    expect(await (await s.fetch("/api/auth/me")).json()).toMatchObject({ user: { name: "tester", mustChangePassword: true } });
    expect(await (await s.fetch("/api/metrics")).json()).toMatchObject({ code: "password-change-required" });
    expect(await (await s.fetch("/api/auth/password", { method: "POST", headers: json, body: JSON.stringify({ current: "not the initial one", next: "a long enough one" }) })).json()).toMatchObject({ code: "login-failed" });
    expect((await s.fetch("/api/auth/password", { method: "POST", headers: json, body: JSON.stringify({ current: initial, next: "short" }) })).status).toBe(400);
    expect((await s.fetch("/api/auth/password", { method: "POST", headers: json, body: JSON.stringify({ current: initial, next: "a long enough one" }) })).status).toBe(200);
    await expect(stat(join(root, "initial-password"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await s.fetch("/api/metrics")).status).toBe(200);
  });

  it("refuses a token signed with another key, a POST without the CSRF header, and a logged-out or disabled session at once", async () => {
    const panel = await boot();
    const s = await sessionFor(panel, env);
    const forged = signAccessToken(randomBytes(32), { sub: "x", roles: ["owner"], sid: "x", iat: 1, exp: 4_000_000_000 });
    expect((await fetch(`${panel.url}/api/metrics`, { headers: { cookie: `orca_at=${forged}` } })).status).toBe(401);
    const noCsrf = await fetch(`${panel.url}/api/reviews`, { method: "POST", headers: { cookie: s.cookie, "content-type": "application/json" }, body: "{}" });
    expect(await noCsrf.json()).toMatchObject({ code: "csrf-required" });
    // Double submit is an equality, not a presence check: a wrong value of the right length, and the right value with no cookie.
    const wrong = s.csrf.slice(0, -1) + (s.csrf.endsWith("A") ? "B" : "A");
    const wrongValue = await fetch(`${panel.url}/api/reviews`, { method: "POST", headers: { cookie: s.cookie, "x-orca-csrf": wrong, "content-type": "application/json" }, body: "{}" });
    expect([wrongValue.status, await wrongValue.json()]).toMatchObject([403, { code: "csrf-required" }]);
    const noCookie = await fetch(`${panel.url}/api/reviews`, { method: "POST", headers: { cookie: s.cookie.split("; ")[0]!, "x-orca-csrf": s.csrf, "content-type": "application/json" }, body: "{}" });
    expect([noCookie.status, await noCookie.json()]).toMatchObject([403, { code: "csrf-required" }]);
    expect((await s.fetch("/api/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await s.fetch("/api/metrics")).status).toBe(401);
    seedUser(root, "amy", "member");
    const amy = await login(panel.url, "amy");
    const store = openAccountsStore(root);
    try { store.disableUser(store.findByName("amy")!.id, Date.now(), "test"); } finally { store.close(); }
    expect((await amy.fetch("/api/metrics")).status).toBe(401);
  });

  it("refresh extends exp and keeps sid; a token survives a panel restart; an expired one does not", async () => {
    let now = 1_800_000_000_000;
    const panel = await boot([], () => new Date(now)); // passes opts.now; PanelAuth reads nowMs from it
    const s = await sessionFor(panel, env);
    const claimsOf = (cookie: string) => JSON.parse(Buffer.from(cookie.split("orca_at=")[1]!.split(";")[0]!.split(".")[1]!, "base64url").toString());
    const before = claimsOf(s.cookie);
    expect(before.exp - before.iat).toBe(15 * 86_400);
    now += 86_400_000;
    const refreshed = await s.fetch("/api/auth/refresh", { method: "POST" });
    const after = claimsOf(refreshed.headers.getSetCookie().find((line) => line.startsWith("orca_at="))!);
    expect(after.sid).toBe(before.sid);
    expect(after.exp).toBe(before.exp + 86_400);
    await panel.close();
    const again = await boot([], () => new Date(now));
    expect((await fetch(`${again.url}/api/metrics`, { headers: { cookie: s.cookie } })).status).toBe(200);
    now += 16 * 86_400_000;
    expect((await fetch(`${again.url}/api/metrics`, { headers: { cookie: s.cookie } })).status).toBe(401);
  });

  it("throttles a name after five failures without sleeping, and records one summary event", async () => {
    // A fixed clock: five scrypt verifications can take longer than the 1 s window under load.
    const panel = await boot([], () => new Date(1_800_000_000_000));
    seedUser(root, "amy", "member");
    const attempt = () => fetch(`${panel.url}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ name: "amy", password: "wrong wrong wrong" }) });
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    const sixth = await attempt();
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toMatchObject({ code: "login-throttled", retryAfterSec: 1 });
    const store = openAccountsStore(root);
    try { expect(store.db.prepare("SELECT COUNT(*) AS n FROM security_events WHERE kind='login-failed'").get()).toMatchObject({ n: 1 }); } finally { store.close(); }
  });

  it("an added user's own password works with no forced change; a member cannot add users", async () => {
    const panel = await boot();
    const owner = await sessionFor(panel, env);
    const add = (s: Session, name: string) => s.fetch("/api/auth/users", { method: "POST", headers: json, body: JSON.stringify({ name, role: "member", password: "bobs own password" }) });
    expect((await add(owner, "bob")).status).toBe(201);
    const bob = await login(panel.url, "bob", "bobs own password");
    expect(await (await bob.fetch("/api/auth/me")).json()).toMatchObject({ user: { mustChangePassword: false, roles: ["member"] } });
    expect(await (await add(bob, "eve")).json()).toMatchObject({ code: "owner-required" });
  });

  it("--session-days is an integer 1..30, 15 when absent", () => {
    const parse = (extra: string[]) => parsePanelArgs(["--by", "tester", ...extra], env).sessionDays;
    expect([parse([]), parse(["--session-days", "1"]), parse(["--session-days", "30"])]).toEqual([15, 1, 30]);
    for (const bad of [["--session-days", "0"], ["--session-days", "31"], ["--session-days", "1.5"], ["--session-days", "-2"], ["--session-days"]]) {
      expect(() => parse(bad), bad.join(" ")).toThrow(expect.objectContaining({ code: "malformed-session-days" }));
    }
  });

  it("refresh moves the session row's expiry with the token, and refuses a revoked session (carried ruling)", () => {
    let now = 1_800_000_000_000;
    const auth = createPanelAuth({ root, by: "tester", sessionDays: 15, log: () => undefined, nowMs: () => now });
    try {
      seedUser(root, "amy", "member");
      const login = auth.login("amy", "orca-test-password", now);
      if (!login.ok) throw new Error(`login refused: ${login.code}`);
      const current = auth.authenticate(login.token, now)!;
      now += 86_400_000;
      const refreshed = auth.refresh(current, now);
      // Past the first token's expiry: only a session row that moved with the new token keeps it alive.
      now += 15 * 86_400_000 - 3_600_000;
      expect(auth.authenticate(login.token, now)).toBeNull();
      expect(auth.authenticate(refreshed, now)?.claims.sid).toBe(current.claims.sid);
      auth.logout(current.claims.sid, now);
      expect(() => auth.refresh(current, now)).toThrow(expect.objectContaining({ code: "login-required", status: 401 }));
      expect(() => auth.refresh(current, now)).toThrow(AccountsRejection);
    } finally { auth.close(); }
  });

  it("sets the two cookies with exactly the spec's attributes, and logout clears both", async () => {
    const panel = await boot();
    seedUser(root, "amy", "member");
    const res = await fetch(`${panel.url}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ name: "amy", password: "orca-test-password" }) });
    const set = res.headers.getSetCookie();
    expect(set.map((line) => line.replace(/=[^;]*;/, "=v;"))).toEqual([
      `orca_at=v; HttpOnly; SameSite=Strict; Path=/; Max-Age=${15 * 86_400}`,
      `orca_csrf=v; SameSite=Strict; Path=/; Max-Age=${15 * 86_400}`,
    ]);
    const amy = await login(panel.url, "amy");
    const out = await amy.fetch("/api/auth/logout", { method: "POST" });
    expect(out.headers.getSetCookie()).toEqual(["orca_at=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0", "orca_csrf=; SameSite=Strict; Path=/; Max-Age=0"]);
  });

  it("keeps the forced change to me, password and logout; the page token carries no user for the auth routes", async () => {
    const panel = await boot();
    const initial = (await readFile(join(root, "initial-password"), "utf8")).trim();
    const s = await login(panel.url, "tester", initial);
    expect((await s.fetch("/api/auth/me")).status).toBe(200);
    expect(await (await s.fetch("/api/auth/refresh", { method: "POST" })).json()).toMatchObject({ code: "password-change-required" });
    expect(await (await s.fetch("/api/auth/users")).json()).toMatchObject({ code: "password-change-required" });
    // Until Task 4 the page token still opens the data routes, but it is nobody: the auth routes want a session.
    expect((await fetch(`${panel.url}/api/metrics`, { headers: { "x-orca-token": panel.token } })).status).toBe(200);
    expect(await (await fetch(`${panel.url}/api/auth/me`, { headers: { "x-orca-token": panel.token } })).json()).toMatchObject({ code: "login-required" });
    expect((await s.fetch("/api/auth/logout", { method: "POST" })).status).toBe(200);
  });

  it("owners list users, see and acknowledge notices; members see none; a role is owner or member exactly; a user renames itself", async () => {
    const panel = await boot();
    const owner = await sessionFor(panel, env);
    seedUser(root, "amy", "member");
    const amy = await login(panel.url, "amy");
    const post = (s: Session, path: string, body: unknown) => s.fetch(path, { method: "POST", headers: json, body: JSON.stringify(body) });
    expect(await (await post(owner, "/api/auth/users", { name: "bob", role: "admin", password: "bobs own password" })).json()).toMatchObject({ code: "user-role-invalid" });
    expect((await post(owner, "/api/auth/users", { name: "bob", role: "owner", password: "bobs own password" })).status).toBe(201);
    const users = (await (await owner.fetch("/api/auth/users")).json()) as { users: Array<{ name: string; roles: string[] }> };
    expect(users.users.map((user) => [user.name, user.roles])).toEqual(expect.arrayContaining([["amy", ["member"]], ["bob", ["owner"]]]));
    expect(await (await amy.fetch("/api/auth/users")).json()).toMatchObject({ code: "owner-required" });
    // Roles come from the user row on every request, not from the token: a demoted owner loses owner routes at once.
    const bob = await login(panel.url, "bob", "bobs own password");
    expect((await bob.fetch("/api/auth/users")).status).toBe(200);
    const store = openAccountsStore(root);
    try { store.db.prepare("UPDATE users SET roles = ? WHERE name = 'bob'").run(JSON.stringify(["member"])); } finally { store.close(); }
    expect(await (await bob.fetch("/api/auth/users")).json()).toMatchObject({ code: "owner-required" });
    const notices = async (s: Session) => ((await (await s.fetch("/api/auth/notices")).json()) as { notices: Array<{ seq: number; kind: string; body: { name?: string } }> }).notices;
    const bobCreated = (await notices(owner)).find((notice) => notice.kind === "user-created" && notice.body.name === "bob")!;
    expect(bobCreated).toBeDefined();
    expect(await notices(amy)).toEqual([]);
    expect((await amy.fetch(`/api/auth/notices/${bobCreated.seq}/ack`, { method: "POST" })).status).toBe(403);
    expect(await (await owner.fetch("/api/auth/notices/999999/ack", { method: "POST" })).json()).toMatchObject({ code: "notice-not-found" });
    expect((await owner.fetch("/api/auth/notices/x/ack", { method: "POST" })).status).toBe(404);
    // Only the decimal spelling names a notice: Number() would read these as the same seq.
    for (const spelling of [`${bobCreated.seq}.0`, `0x${bobCreated.seq.toString(16)}`, `${bobCreated.seq}e0`]) {
      expect(await (await owner.fetch(`/api/auth/notices/${spelling}/ack`, { method: "POST" })).json(), spelling).toMatchObject({ code: "notice-not-found" });
    }
    expect((await owner.fetch(`/api/auth/notices/${bobCreated.seq}/ack`, { method: "POST" })).status).toBe(200);
    expect((await notices(owner)).map((notice) => notice.seq)).not.toContain(bobCreated.seq);
    expect(await (await post(amy, "/api/auth/profile", { name: "amelia" })).json()).toMatchObject({ user: { name: "amelia", roles: ["member"] } });
    expect(await (await post(amy, "/api/auth/profile", { name: "bob" })).json()).toMatchObject({ code: "user-name-taken" });
  });

  it("bounds the throttle: impossible names never enter it, idle expired entries leave it, and it has a hard size cap", () => {
    let now = 1_800_000_000_000;
    const auth = createPanelAuth({ root, by: "tester", sessionDays: 15, log: () => undefined, nowMs: () => now, throttleLimits: { maxEntries: 2, idleMs: 60_000 } });
    try {
      const fail = (name: string) => auth.login(name, "wrong wrong wrong", now);
      for (let i = 0; i < 5; i += 1) fail("amy");
      expect(fail("amy")).toMatchObject({ code: "login-throttled" });
      // Two names no user can have: answered like any failure, and amy keeps her place in a map of two.
      expect([fail("bad name"), fail("x".repeat(65))]).toEqual([{ ok: false, code: "login-failed" }, { ok: false, code: "login-failed" }]);
      expect(fail("amy")).toMatchObject({ code: "login-throttled" });
      // Two new failing names fill the map; the least recently failed (amy) is evicted and starts over.
      fail("bob"); fail("carl");
      expect(fail("amy")).toEqual({ ok: false, code: "login-failed" });
    } finally { auth.close(); }
    const idle = createPanelAuth({ root, by: "tester", sessionDays: 15, log: () => undefined, nowMs: () => now, throttleLimits: { maxEntries: 100, idleMs: 60_000 } });
    try {
      const fail = (name: string) => idle.login(name, "wrong wrong wrong", now);
      for (let i = 0; i < 5; i += 1) fail("amy");
      now += 60_001;
      fail("bob"); // sweeps amy: her 1 s is over and she has been idle a minute
      expect([fail("amy"), fail("amy")]).toEqual([{ ok: false, code: "login-failed" }, { ok: false, code: "login-failed" }]);
    } finally { idle.close(); }
  }, 60_000);

  it("a password change logs out the user's other sessions and keeps this one", async () => {
    const panel = await boot();
    seedUser(root, "amy", "member");
    const here = await login(panel.url, "amy"), there = await login(panel.url, "amy");
    expect((await here.fetch("/api/auth/password", { method: "POST", headers: json, body: JSON.stringify({ current: "orca-test-password", next: "amys new password" }) })).status).toBe(200);
    expect([(await here.fetch("/api/auth/me")).status, (await there.fetch("/api/auth/me")).status]).toEqual([200, 401]);
  });

  it("a wrong current password counts against the name's login throttle", async () => {
    const panel = await boot([], () => new Date(1_800_000_000_000));
    seedUser(root, "amy", "member");
    const amy = await login(panel.url, "amy");
    const change = () => amy.fetch("/api/auth/password", { method: "POST", headers: json, body: JSON.stringify({ current: "wrong wrong wrong", next: "amys new password" }) });
    for (let i = 0; i < 5; i += 1) expect(await (await change()).json()).toMatchObject({ code: "login-failed" });
    const sixth = await change();
    expect([sixth.status, await sixth.json()]).toMatchObject([429, { code: "login-throttled", retryAfterSec: 1 }]);
    const relogin = await fetch(`${panel.url}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ name: "amy", password: "orca-test-password" }) });
    expect(relogin.status).toBe(429);
  }, 30_000);
});
