import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ensurePrivateDir, ensurePrivateFile } from "../../service/privateFiles.js";
import type { Role } from "./jwt.js";
import { MIN_PASSWORD_LENGTH, hashPassword } from "./password.js";

export const ACCOUNTS_FILE = "accounts.sqlite";
export const USER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** A refusal the routes answer with `status` and `{code,message}`; the CLI prints its code. */
export class AccountsRejection extends Error {
  constructor(readonly code: string, readonly status: number, message: string = code) {
    super(message);
    this.name = "AccountsRejection";
  }
}

export interface UserRow { id: string; name: string; roles: Role[]; createdAt: number; disabledAt: number | null; mustChangePassword: boolean }
export type SecurityEventKind = "user-created" | "password-changed" | "user-disabled" | "login-failed" | "key-rotated";
/** The kinds an owner is shown until acknowledged; `login-failed` is a log row only. */
const NOTICE_KINDS: SecurityEventKind[] = ["user-created", "password-changed", "user-disabled", "key-rotated"];

export interface AccountsStore {
  /** For criteria only (as `auth.store` is): production code goes through the methods. */
  readonly db: DatabaseSync;
  userCount(): number;
  listUsers(): UserRow[];
  findByName(name: string): (UserRow & { passwordHash: string }) | null;
  findById(id: string): UserRow | null;
  createUser(input: { name: string; password: string; roles: Role[]; mustChangePassword?: boolean; now: number; by: string; allowShort?: boolean }): UserRow;
  setPassword(userId: string, password: string, now: number, by: string): void;
  /** An administrator's reset: the new password and the logout of every session of the user, in one transaction. */
  resetPassword(userId: string, password: string, now: number, by: string): void;
  setName(userId: string, name: string): void;
  disableUser(userId: string, now: number, by: string): void;
  createSession(userId: string, now: number, expiresAt: number): string;
  /** Refuses (`login-required`) a session that is revoked, expired at `now`, or whose user is disabled. */
  extendSession(sid: string, now: number, expiresAt: number): void;
  sessionActive(sid: string, userId: string, now: number): boolean;
  revokeSession(sid: string, now: number): void;
  revokeAllSessions(now: number): void;
  /** Every session of the user but `keepSid` (a password change keeps the session that made it). */
  revokeOtherSessions(userId: string, keepSid: string, now: number): void;
  appendSecurityEvent(kind: SecurityEventKind, body: Record<string, unknown>, now: number): number;
  openNotices(): Array<{ seq: number; at: number; kind: SecurityEventKind; body: unknown }>;
  /** Refuses (`notice-not-found`) a seq that is not an open notice's. */
  acknowledge(seq: number, by: string, now: number): void;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, roles TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER, must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))) STRICT;
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER) STRICT;
CREATE TABLE IF NOT EXISTS security_events(seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS security_acks(seq INTEGER PRIMARY KEY REFERENCES security_events(seq), at INTEGER NOT NULL, by TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO meta VALUES ('accountsSchemaVersion','1');
`;

const USER_COLUMNS = "id, name, roles, created_at, disabled_at, must_change_password";
type Row = Record<string, unknown>;

function toUser(row: Row): UserRow {
  const roles: unknown = JSON.parse(String(row.roles));
  if (!Array.isArray(roles) || !roles.every((role) => role === "owner" || role === "member")) throw new Error("accounts-row-invalid");
  return {
    id: String(row.id), name: String(row.name), roles: roles as Role[], createdAt: Number(row.created_at),
    disabledAt: row.disabled_at === null ? null : Number(row.disabled_at), mustChangePassword: row.must_change_password === 1,
  };
}

function checkName(name: string): void {
  if (!USER_NAME_PATTERN.test(name)) throw new AccountsRejection("user-name-invalid", 400, "a user name is 1-64 letters, digits, '.', '_' or '-', starting with a letter or digit");
}

function checkRoles(roles: unknown): void {
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every((role) => role === "owner" || role === "member")) {
    throw new AccountsRejection("user-role-invalid", 400, "roles are a non-empty set of owner and member");
  }
}

function checkLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AccountsRejection("password-too-short", 400, `a password has at least ${MIN_PASSWORD_LENGTH} characters`);
}

/**
 * Accounts spec §3.1, D1: `<control root>/accounts.sqlite`, its own file beside the control stores. The directory and
 * the file are created 0700/0600 when absent (Rule 17); an existing one keeps its mode.
 */
export function openAccountsStore(root: string): AccountsStore {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  ensurePrivateDir(root);
  const path = join(root, ACCOUNTS_FILE);
  ensurePrivateFile(path);
  if (!lstatSync(path).isFile()) throw new Error("accounts-file-invalid");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;");
  db.exec(SCHEMA);

  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const appendEvent = (kind: SecurityEventKind, body: Record<string, unknown>, now: number): number =>
    Number(db.prepare("INSERT INTO security_events(at, kind, body) VALUES (?, ?, ?)").run(now, kind, JSON.stringify(body)).lastInsertRowid);
  const userById = (id: string): UserRow | null => {
    const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as Row | undefined;
    return row ? toUser(row) : null;
  };
  const requireUser = (id: string): UserRow => {
    const user = userById(id);
    if (!user) throw new AccountsRejection("user-not-found", 404, "no such user");
    return user;
  };

  return {
    db,
    userCount: () => Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as Row).n),
    listUsers: () => (db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at, name`).all() as Row[]).map(toUser),
    findByName(name) {
      const row = db.prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE name = ?`).get(name) as Row | undefined;
      return row ? { ...toUser(row), passwordHash: String(row.password_hash) } : null;
    },
    findById: userById,
    createUser(input) {
      checkName(input.name);
      checkRoles(input.roles);
      if (!input.allowShort) checkLength(input.password);
      const hash = hashPassword(input.password);
      const id = `user-${randomUUID()}`;
      return transaction(() => {
        if (db.prepare("SELECT 1 FROM users WHERE name = ?").get(input.name)) throw new AccountsRejection("user-name-taken", 409, `the name ${input.name} is taken`);
        db.prepare("INSERT INTO users(id, name, password_hash, roles, created_at, disabled_at, must_change_password) VALUES (?, ?, ?, ?, ?, NULL, ?)")
          .run(id, input.name, hash, JSON.stringify(input.roles), input.now, input.mustChangePassword ? 1 : 0);
        appendEvent("user-created", { userId: id, name: input.name, roles: input.roles, by: input.by }, input.now);
        return requireUser(id);
      });
    },
    setPassword(userId, password, now, by) {
      checkLength(password);
      const hash = hashPassword(password);
      transaction(() => {
        requireUser(userId);
        db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, userId);
        appendEvent("password-changed", { userId, by }, now);
      });
    },
    resetPassword(userId, password, now, by) {
      checkLength(password);
      const hash = hashPassword(password);
      transaction(() => {
        requireUser(userId);
        db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, userId);
        db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
        appendEvent("password-changed", { userId, by }, now);
      });
    },
    setName(userId, name) {
      checkName(name);
      transaction(() => {
        const user = requireUser(userId);
        if (user.name === name) return;
        if (db.prepare("SELECT 1 FROM users WHERE name = ?").get(name)) throw new AccountsRejection("user-name-taken", 409, `the name ${name} is taken`);
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, userId);
      });
    },
    disableUser(userId, now, by) {
      transaction(() => {
        if (requireUser(userId).disabledAt !== null) return;
        db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(now, userId);
        db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
        appendEvent("user-disabled", { userId, by }, now);
      });
    },
    createSession(userId, now, expiresAt) {
      const sid = randomUUID();
      db.prepare("INSERT INTO sessions(id, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)").run(sid, userId, now, expiresAt);
      return sid;
    },
    extendSession(sid, now, expiresAt) {
      const changed = db.prepare(
        "UPDATE sessions SET expires_at = ? WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND user_id IN (SELECT id FROM users WHERE disabled_at IS NULL)",
      ).run(expiresAt, sid, now).changes;
      if (Number(changed) !== 1) throw new AccountsRejection("login-required", 401, "the session is not active");
    },
    sessionActive(sid, userId, now) {
      return db.prepare(
        "SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled_at IS NULL",
      ).get(sid, userId, now) !== undefined;
    },
    revokeSession(sid, now) {
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, sid);
    },
    revokeOtherSessions(userId, keepSid, now) {
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL").run(now, userId, keepSid);
    },
    revokeAllSessions(now) {
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL").run(now);
    },
    appendSecurityEvent: appendEvent,
    openNotices() {
      const marks = NOTICE_KINDS.map(() => "?").join(", ");
      const rows = db.prepare(
        `SELECT e.seq, e.at, e.kind, e.body FROM security_events e LEFT JOIN security_acks a ON a.seq = e.seq WHERE a.seq IS NULL AND e.kind IN (${marks}) ORDER BY e.seq`,
      ).all(...NOTICE_KINDS) as Row[];
      return rows.map((row) => ({ seq: Number(row.seq), at: Number(row.at), kind: row.kind as SecurityEventKind, body: JSON.parse(String(row.body)) as unknown }));
    },
    acknowledge(seq, by, now) {
      transaction(() => {
        const kind = (db.prepare("SELECT kind FROM security_events WHERE seq = ?").get(seq) as Row | undefined)?.kind;
        if (!NOTICE_KINDS.includes(kind as SecurityEventKind)) throw new AccountsRejection("notice-not-found", 404, "no such notice");
        db.prepare("INSERT OR IGNORE INTO security_acks(seq, at, by) VALUES (?, ?, ?)").run(seq, now, by);
      });
    },
    close: () => db.close(),
  };
}
