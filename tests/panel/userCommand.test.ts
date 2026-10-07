import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JWT_KEY_FILE, loadOrCreateSigningKey } from "../../src/panel/accounts/signingKey.js";
import { ACCOUNTS_FILE, openAccountsStore } from "../../src/panel/accounts/store.js";
import { runUserCommand, type UserIo } from "../../src/panel/accounts/userCommand.js";

let base = "", root = "", home = "";
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "uc-"));
  root = join(base, "control");
  home = join(base, "home");
  openAccountsStore(root).close(); // the panel has run once: the store exists at the resolved root
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const io = (over: Partial<UserIo> & { secrets?: string[] } = {}) => {
  const out: string[] = [], err: string[] = [], secrets = [...(over.secrets ?? [])], prompts: string[] = [];
  return { out, err, prompts, io: { stdinIsTTY: true, readSecret: async (p: string) => { prompts.push(p); return secrets.shift() ?? ""; }, out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: { ORCA_CONTROL_DIR: root }, nowMs: () => 1, ...over } as UserIo };
};
const withStore = <T>(fn: (s: ReturnType<typeof openAccountsStore>) => T): T => { const s = openAccountsStore(root); try { return fn(s); } finally { s.close(); } };

describe("orca user (spec §3.2, §10)", () => {
  it("adds a user from two matching TTY entries; refuses a mismatch and a short password", async () => {
    let h = io({ secrets: ["bobs own password", "bobs own password"] });
    expect(await runUserCommand(["add", "bob", "--role", "member"], h.io)).toBe(0);
    expect(withStore((s) => s.findByName("bob")?.roles)).toEqual(["member"]);
    h = io({ secrets: ["one long password", "another long one"] });
    expect(await runUserCommand(["add", "eve"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-passwords-differ");
    h = io({ secrets: ["short", "short"] });
    expect(await runUserCommand(["add", "eve"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("password-too-short");
    expect(withStore((s) => s.findByName("eve"))).toBe(null);
  });

  it("never echoes a password and a role must be owner or member", async () => {
    const h = io({ secrets: ["bobs own password", "bobs own password"] });
    expect(await runUserCommand(["add", "bob", "--role", "owner"], h.io)).toBe(0);
    expect(withStore((s) => s.findByName("bob")?.roles)).toEqual(["owner"]);
    expect(h.out.join("") + h.err.join("")).not.toContain("bobs own password");
    const bad = io({ secrets: ["bobs own password", "bobs own password"] });
    expect(await runUserCommand(["add", "zed", "--role", "root"], bad.io)).toBe(1);
    expect(bad.err.join("")).toContain("user-argument-invalid");
  });

  it("refuses a non-TTY stdin and never reads a password from argv or env", async () => {
    let h = io({ stdinIsTTY: false, env: { ORCA_CONTROL_DIR: root, ORCA_PASSWORD: "from env password" } });
    expect(await runUserCommand(["add", "eve"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-password-needs-tty");
    expect(h.prompts).toEqual([]);
    h = io({ stdinIsTTY: false });
    expect(await runUserCommand(["passwd", "eve"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-password-needs-tty");
    h = io({ secrets: ["x", "x"] });
    expect(await runUserCommand(["add", "eve", "--password", "from argv password"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-argument-invalid");
    expect(h.prompts).toEqual([]);
    h = io({ secrets: ["a long enough password", "a long enough password"] });
    expect(await runUserCommand(["add", "eve", "--password=from argv password"], h.io)).toBe(1); // one token: only the flag check can refuse it
    expect(h.err.join("")).toContain("user-argument-invalid");
    expect(h.prompts).toEqual([]);
    expect(withStore((s) => s.findByName("eve"))).toBe(null);
  });

  it("passwd changes the password and logs the user's sessions out; an unknown name is user-not-found", async () => {
    const id = withStore((s) => { const u = s.createUser({ name: "amy", password: "amys old password", roles: ["member"], now: 0, by: "t" }); return { u, sid: s.createSession(u.id, 0, 1e9) }; });
    let h = io({ secrets: ["amys new password", "amys new password"] });
    expect(await runUserCommand(["passwd", "amy"], h.io)).toBe(0);
    expect(withStore((s) => s.sessionActive(id.sid, id.u.id, 2))).toBe(false);
    h = io({ secrets: ["amys new password", "amys new password"] });
    expect(await runUserCommand(["passwd", "nobody"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-not-found");
    expect(h.prompts).toEqual([]);
  });

  it("passwd refuses a disabled user by name and add refuses an invalid name, both before any prompt", async () => {
    withStore((s) => { const u = s.createUser({ name: "old", password: "olds old password", roles: ["member"], now: 0, by: "t" }); s.disableUser(u.id, 1, "t"); });
    let h = io({ secrets: ["a long enough password", "a long enough password"] });
    expect(await runUserCommand(["passwd", "old"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-disabled");
    expect(h.prompts).toEqual([]);
    h = io({ secrets: ["a long enough password", "a long enough password"] });
    expect(await runUserCommand(["add", "bad name!"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-name-invalid");
    expect(h.prompts).toEqual([]);
  });

  it("disable revokes the user's sessions; unknown name is user-not-found; list shows state", async () => {
    const { amy, sid } = withStore((s) => { const amy = s.createUser({ name: "amy", password: "amys old password", roles: ["member"], now: 0, by: "t" }); return { amy, sid: s.createSession(amy.id, 0, 1e9) }; });
    let h = io();
    expect(await runUserCommand(["disable", "amy"], h.io)).toBe(0);
    expect(withStore((s) => s.sessionActive(sid, amy.id, 2))).toBe(false);
    h = io();
    expect(await runUserCommand(["disable", "nobody"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-not-found");
    h = io();
    expect(await runUserCommand(["list"], h.io)).toBe(0);
    expect(h.out.join("")).toBe("amy\tmember\tdisabled\n");
  });

  it("rotate-key replaces jwt.key, revokes every session and records key-rotated", async () => {
    const before = loadOrCreateSigningKey(root);
    const { amy, bea, sa, sb } = withStore((s) => {
      const amy = s.createUser({ name: "amy", password: "amys old password", roles: ["member"], now: 0, by: "t" });
      const bea = s.createUser({ name: "bea", password: "beas old password", roles: ["owner"], now: 0, by: "t" });
      return { amy, bea, sa: s.createSession(amy.id, 0, 1e9), sb: s.createSession(bea.id, 0, 1e9) };
    });
    const h = io({ nowMs: () => 5 });
    expect(await runUserCommand(["rotate-key"], h.io)).toBe(0);
    expect(h.out.join("")).toContain("restart the panel");
    expect((await readFile(join(root, JWT_KEY_FILE))).equals(before)).toBe(false);
    withStore((s) => {
      expect(s.sessionActive(sa, amy.id, 6)).toBe(false);
      expect(s.sessionActive(sb, bea.id, 6)).toBe(false);
      expect(s.openNotices().some((n) => n.kind === "key-rotated")).toBe(true);
    });
  });

  it("never creates a second accounts store: a root without one is refused by name and stays empty (X13)", async () => {
    const elsewhere = join(base, "other-control");
    const h = io({ secrets: ["bobs own password", "bobs own password"], env: { ORCA_CONTROL_DIR: elsewhere } });
    expect(await runUserCommand(["add", "bob"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-store-missing");
    expect(existsSync(elsewhere)).toBe(false);
    const rk = io({ env: { ORCA_CONTROL_DIR: elsewhere } });
    expect(await runUserCommand(["rotate-key"], rk.io)).toBe(1);
    expect(existsSync(elsewhere)).toBe(false);
    expect(existsSync(join(root, ACCOUNTS_FILE))).toBe(true);
  });

  it("names the accounts store it opened (X13)", async () => {
    const h = io();
    expect(await runUserCommand(["list"], h.io)).toBe(0);
    expect(h.err.join("")).toContain(join(root, ACCOUNTS_FILE));
  });

  it("the real CLI refuses piped stdin (spawned)", () => {
    const run = spawnSync(resolve("node_modules/.bin/tsx"), ["src/cli.ts", "user", "add", "eve"], { input: "pw\npw\n", env: { ...process.env, ORCA_CONTROL_DIR: root, HOME: home }, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("user-password-needs-tty");
  });
});
