import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/panel/accounts/password.js";
import { signAccessToken, verifyAccessToken } from "../../src/panel/accounts/jwt.js";
import { JWT_KEY_FILE, loadOrCreateSigningKey, rotateSigningKey } from "../../src/panel/accounts/signingKey.js";
import { ACCOUNTS_FILE, openAccountsStore } from "../../src/panel/accounts/store.js";
import { INITIAL_PASSWORD_FILE, ensureDefaultOwner } from "../../src/panel/accounts/initialOwner.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "ac-")); roots.push(r); return join(r, "control"); }
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

describe("passwords (spec §3.1)", () => {
  it("stores scrypt N=2^17 r=8 p=1 with a 32-byte salt and a 64-byte key, and verifies only the right password", () => {
    const stored = hashPassword("correct horse battery");
    const [scheme, n, r, p, salt, key] = stored.split("$");
    expect([scheme, n, r, p]).toEqual(["scrypt", "131072", "8", "1"]);
    expect(Buffer.from(salt!, "base64").length).toBe(32);
    expect(Buffer.from(key!, "base64").length).toBe(64);
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("correct horse batterz", stored)).toBe(false);
    expect(verifyPassword("x", "plain$text")).toBe(false);
  });
});

describe("access tokens (spec §3.3)", () => {
  const key = randomBytes(32);
  const claims = { sub: "u1", roles: ["owner" as const], sid: "s1", iat: 1000, exp: 2000 };
  it("verifies its own token until exp, and nothing signed with another key, unsigned or with another alg", () => {
    const token = signAccessToken(key, claims);
    expect(verifyAccessToken(key, token, 1999)).toEqual(claims);
    expect(verifyAccessToken(key, token, 2000)).toBe(null);
    expect(verifyAccessToken(randomBytes(32), token, 1500)).toBe(null);
    const [, payload] = token.split(".");
    const none = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${payload}.`;
    expect(verifyAccessToken(key, none, 1500)).toBe(null);
    const h512 = b64url(JSON.stringify({ alg: "HS512", typ: "JWT" }));
    const sig = createHmac("sha512", key).update(`${h512}.${payload}`).digest("base64url");
    expect(verifyAccessToken(key, `${h512}.${payload}.${sig}`, 1500)).toBe(null);
    // One token, one string: the signature segment with an appended "=" or "!", or a character inserted, is no token.
    const [h0, p0, s0] = token.split(".") as [string, string, string];
    for (const sig of [`${s0}=`, `${s0}!`, `${s0.slice(0, 10)}*${s0.slice(10)}`]) expect(verifyAccessToken(key, `${h0}.${p0}.${sig}`, 1500)).toBe(null);
    // Only the exact header: a correctly signed token whose header differs (here only in key order) is no token.
    const reordered = b64url(JSON.stringify({ typ: "JWT", alg: "HS256" }));
    expect(verifyAccessToken(key, `${reordered}.${payload}.${createHmac("sha256", key).update(`${reordered}.${payload}`).digest("base64url")}`, 1500)).toBe(null);
    const extra = b64url(JSON.stringify({ ...claims, admin: true }));
    const h = token.split(".")[0]!;
    expect(verifyAccessToken(key, `${h}.${extra}.${createHmac("sha256", key).update(`${h}.${extra}`).digest("base64url")}`, 1500)).toBe(null);
  });
});

describe("the signing key (spec §3.3, Rule 17)", () => {
  it("is created once as a 0600 file of 32 bytes, read back unchanged, and an existing file's mode is left alone", async () => {
    const r = await root();
    const first = loadOrCreateSigningKey(r);
    expect(first.length).toBe(32);
    expect((await stat(join(r, JWT_KEY_FILE))).mode & 0o777).toBe(0o600);
    expect((await stat(r)).mode & 0o777).toBe(0o700);
    expect(loadOrCreateSigningKey(r).equals(first)).toBe(true);
    await chmod(join(r, JWT_KEY_FILE), 0o640);
    loadOrCreateSigningKey(r);
    expect((await stat(join(r, JWT_KEY_FILE))).mode & 0o777).toBe(0o640);
    rotateSigningKey(r);
    expect(loadOrCreateSigningKey(r).equals(first)).toBe(false);
    await writeFile(join(r, JWT_KEY_FILE), "short");
    expect(() => loadOrCreateSigningKey(r)).toThrow("jwt-key-invalid");
  });
});

describe("the accounts store and the default owner (spec §3.1, §3.2, D1)", () => {
  it("creates the store 0600, the owner named after --by with a forced change, and the initial password file 0600, logging only its path", async () => {
    const r = await root();
    const store = openAccountsStore(r);
    try {
      expect((await stat(join(r, ACCOUNTS_FILE))).mode & 0o777).toBe(0o600);
      const lines: string[] = [];
      expect(ensureDefaultOwner(store, r, "biran", (line) => lines.push(line), 1)).toEqual({ created: true });
      const password = (await readFile(join(r, INITIAL_PASSWORD_FILE), "utf8")).trim();
      expect(password).toMatch(/^[0-9a-f]{16}$/);
      expect((await stat(join(r, INITIAL_PASSWORD_FILE))).mode & 0o777).toBe(0o600);
      expect(lines).toEqual([`orca-panel: initial password for biran written to ${join(r, INITIAL_PASSWORD_FILE)}\n`]);
      expect(lines.join("")).not.toContain(password);
      const owner = store.findByName("biran")!;
      expect(owner).toMatchObject({ roles: ["owner"], mustChangePassword: true });
      expect(verifyPassword(password, owner.passwordHash)).toBe(true);
      expect(ensureDefaultOwner(store, r, "someone", () => undefined, 2)).toEqual({ created: false });
      expect(store.openNotices().map((n) => n.kind)).toEqual(["user-created"]);
    } finally { store.close(); }
  });

  it("enforces the minimum length, unique names and the name pattern; revokes sessions on disable", async () => {
    const store = openAccountsStore(await root());
    try {
      expect(() => store.createUser({ name: "amy", password: "short", roles: ["member"], now: 1, by: "t" })).toThrow(expect.objectContaining({ code: "password-too-short" }));
      const amy = store.createUser({ name: "amy", password: "twelve chars!", roles: ["member"], now: 1, by: "t" });
      expect(amy.mustChangePassword).toBe(false);
      expect(() => store.createUser({ name: "amy", password: "twelve chars!", roles: ["member"], now: 1, by: "t" })).toThrow(expect.objectContaining({ code: "user-name-taken" }));
      expect(() => store.createUser({ name: "a b", password: "twelve chars!", roles: ["member"], now: 1, by: "t" })).toThrow(expect.objectContaining({ code: "user-name-invalid" }));
      const sid = store.createSession(amy.id, 10, 100);
      expect(store.sessionActive(sid, amy.id, 50)).toBe(true);
      expect(store.sessionActive(sid, amy.id, 100)).toBe(false);
      store.disableUser(amy.id, 20, "t");
      expect(store.sessionActive(sid, amy.id, 50)).toBe(false);
      // Both halves, each measured alone: the session row itself is revoked, and a session made after the disable is not active.
      expect((store.db.prepare("SELECT revoked_at FROM sessions WHERE id = ?").get(sid) as { revoked_at: number | null }).revoked_at).toBe(20);
      const late = store.createSession(amy.id, 30, 100);
      expect(store.sessionActive(late, amy.id, 50)).toBe(false);
      expect(store.openNotices().map((n) => n.kind)).toEqual(["user-created", "user-disabled"]);
    } finally { store.close(); }
  });
});

describe("store refusals, notices and the key file (spec §3.1, §3.3; Task 2 fix round 1)", () => {
  it("refuses roles outside a non-empty owner/member set, and an unknown user id, by name", async () => {
    const store = openAccountsStore(await root());
    try {
      for (const roles of [["admin"], [], ["owner", "root"]]) {
        expect(() => store.createUser({ name: "eve", password: "twelve chars!", roles: roles as never, now: 1, by: "t" })).toThrow(expect.objectContaining({ code: "user-role-invalid", status: 400 }));
      }
      expect(store.userCount()).toBe(0);
      expect(() => store.setPassword("user-nobody", "twelve chars!", 1, "t")).toThrow(expect.objectContaining({ code: "user-not-found", status: 404 }));
      expect(() => store.disableUser("user-nobody", 1, "t")).toThrow(expect.objectContaining({ code: "user-not-found", status: 404 }));
      expect(store.openNotices()).toEqual([]);
    } finally { store.close(); }
  });

  it("extends only an active session: not an expired one, a revoked one, or one whose user is disabled", async () => {
    const store = openAccountsStore(await root());
    try {
      const amy = store.createUser({ name: "amy", password: "twelve chars!", roles: ["member"], now: 1, by: "t" });
      const live = store.createSession(amy.id, 10, 100);
      store.extendSession(live, 50, 300);
      expect(store.sessionActive(live, amy.id, 200)).toBe(true);
      const expired = store.createSession(amy.id, 10, 100);
      expect(() => store.extendSession(expired, 150, 300)).toThrow(expect.objectContaining({ code: "login-required", status: 401 }));
      expect(store.sessionActive(expired, amy.id, 200)).toBe(false);
      const revoked = store.createSession(amy.id, 10, 100);
      store.revokeSession(revoked, 20);
      expect(() => store.extendSession(revoked, 50, 300)).toThrow(expect.objectContaining({ code: "login-required" }));
      // The disabled-user arm alone: a session row left unrevoked under a disabled user is not extended.
      const kept = store.createSession(amy.id, 10, 100);
      store.db.prepare("UPDATE users SET disabled_at = 60 WHERE id = ?").run(amy.id);
      expect(() => store.extendSession(kept, 70, 300)).toThrow(expect.objectContaining({ code: "login-required" }));
    } finally { store.close(); }
  });

  it("disabling twice is one disable; login-failed is never a notice; an acknowledged notice closes; an unknown seq is named", async () => {
    const store = openAccountsStore(await root());
    try {
      const amy = store.createUser({ name: "amy", password: "twelve chars!", roles: ["member"], now: 1, by: "t" });
      store.disableUser(amy.id, 20, "t");
      store.disableUser(amy.id, 30, "t");
      expect(store.findById(amy.id)!.disabledAt).toBe(20);
      const failed = store.appendSecurityEvent("login-failed", { name: "amy", failures: 5 }, 40);
      expect(store.openNotices().map((n) => n.kind)).toEqual(["user-created", "user-disabled"]);
      const [created] = store.openNotices();
      store.acknowledge(created!.seq, "owner", 50);
      expect(store.openNotices().map((n) => n.kind)).toEqual(["user-disabled"]);
      expect(() => store.acknowledge(9999, "owner", 50)).toThrow(expect.objectContaining({ code: "notice-not-found", status: 404 }));
      expect(() => store.acknowledge(failed, "owner", 50)).toThrow(expect.objectContaining({ code: "notice-not-found" }));
    } finally { store.close(); }
  });

  it("refuses a stored row whose roles are not owner/member rather than serving it", async () => {
    const store = openAccountsStore(await root());
    try {
      const amy = store.createUser({ name: "amy", password: "twelve chars!", roles: ["member"], now: 1, by: "t" });
      store.db.prepare("UPDATE users SET roles = ? WHERE id = ?").run(JSON.stringify(["admin"]), amy.id);
      expect(() => store.listUsers()).toThrow("accounts-row-invalid");
      expect(() => store.findById(amy.id)).toThrow("accounts-row-invalid");
    } finally { store.close(); }
  });

  it("refuses a jwt.key or accounts.sqlite that is a symlink, even to a well-formed file, and leaves the link alone", async () => {
    const r = await root();
    loadOrCreateSigningKey(r);
    const target = join(r, "..", "elsewhere.key");
    await writeFile(target, randomBytes(32));
    await rm(join(r, JWT_KEY_FILE));
    await symlink(target, join(r, JWT_KEY_FILE));
    expect(() => loadOrCreateSigningKey(r)).toThrow("jwt-key-invalid");
    const db = join(r, "..", "elsewhere.sqlite");
    await writeFile(db, "");
    await symlink(db, join(r, ACCOUNTS_FILE));
    expect(() => openAccountsStore(r)).toThrow("accounts-file-invalid");
    expect((await readFile(db)).length).toBe(0);
  });
});
