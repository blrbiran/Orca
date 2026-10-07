import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { hashPassword } from "../../../src/panel/accounts/password.js";
import { ACCOUNTS_FILE, openAccountsStore } from "../../../src/panel/accounts/store.js";
import type { Role } from "../../../src/panel/accounts/jwt.js";
import { createPanelAuth, type PanelAuth } from "../../../src/panel/auth.js";
import { controlRoot } from "../../../src/panel/controlOptions.js";

export const TEST_PASSWORD = "orca-test-password";
let testHash: string | null = null;

/** A user the criterion can log in as: created, or reset to TEST_PASSWORD with no forced change. The criterion's own temp store. */
export function seedUser(accountsDir: string, name: string, role: Role = "owner"): void {
  openAccountsStore(accountsDir).close();
  testHash ??= hashPassword(TEST_PASSWORD);
  const db = new DatabaseSync(join(accountsDir, ACCOUNTS_FILE));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare(`INSERT INTO users(id,name,password_hash,roles,created_at,disabled_at,must_change_password) VALUES (?,?,?,?,?,NULL,0)
      ON CONFLICT(name) DO UPDATE SET password_hash=excluded.password_hash, roles=excluded.roles, disabled_at=NULL, must_change_password=0`)
      .run(`user-${randomUUID()}`, name, testHash, JSON.stringify([role]), Date.now());
  } finally { db.close(); }
}

export interface Session { cookie: string; csrf: string; fetch(path: string, init?: RequestInit): Promise<Response> }

const cookieValue = (setCookies: string[], name: string): string | undefined =>
  setCookies.map((line) => line.split(";")[0]!).find((pair) => pair.startsWith(`${name}=`))?.slice(name.length + 1);

export async function login(baseUrl: string, name = "tester", password = TEST_PASSWORD): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, password }) });
  if (res.status !== 200) throw new Error(`login as ${name} answered ${res.status}: ${await res.text()}`);
  const set = res.headers.getSetCookie();
  const at = cookieValue(set, "orca_at"), csrf = cookieValue(set, "orca_csrf");
  if (at === undefined || csrf === undefined) throw new Error(`login set no session cookies: ${JSON.stringify(set)}`);
  const cookie = `orca_at=${at}; orca_csrf=${csrf}`;
  return {
    cookie, csrf,
    fetch: (path, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const headers = new Headers(init.headers);
      headers.set("cookie", cookie);
      if (method !== "GET" && method !== "HEAD") headers.set("x-orca-csrf", csrf);
      return fetch(`${baseUrl}${path}`, { ...init, headers });
    },
  };
}

const sessions = new Map<string, Promise<Session>>();
/** Seeds `name` into the panel's accounts dir (ORCA_CONTROL_DIR of `env`) and logs in once per panel and name. */
export function sessionFor(panel: { url: string }, env: NodeJS.ProcessEnv = process.env, name = "tester", role: Role = "owner"): Promise<Session> {
  const key = `${panel.url}\0${name}`;
  let session = sessions.get(key);
  if (session === undefined) {
    seedUser(controlRoot(env), name, role);
    session = login(panel.url, name);
    sessions.set(key, session);
  }
  return session;
}

/** For a criterion that builds the app with `buildApi` itself and still sends the page token (Task 4 moves it to a session). */
export function quietPanelAuth(root: string): PanelAuth {
  return createPanelAuth({ root, by: "operator", sessionDays: 15, log: () => undefined, nowMs: Date.now });
}
