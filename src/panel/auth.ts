import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { INITIAL_PASSWORD_FILE, ensureDefaultOwner } from "./accounts/initialOwner.js";
import { signAccessToken, verifyAccessToken, type AccessClaims } from "./accounts/jwt.js";
import { hashPassword, verifyPassword } from "./accounts/password.js";
import { loadOrCreateSigningKey } from "./accounts/signingKey.js";
import { openAccountsStore, type AccountsStore, type UserRow } from "./accounts/store.js";

export interface AuthenticatedUser { user: UserRow; claims: AccessClaims }

export type LoginResult =
  | { ok: true; token: string; csrf: string; user: UserRow }
  | { ok: false; code: "login-failed" }
  | { ok: false; code: "login-throttled"; retryAfterSec: number };

export interface PanelAuth {
  /** For criteria only (as `store.db` is): production code goes through the methods. */
  readonly store: AccountsStore;
  readonly sessionDays: number;
  /** The panel's one clock (PanelOptions.now), read by the routes so a criterion can move time. */
  nowMs(): number;
  login(name: string, password: string, nowMs: number): LoginResult;
  authenticate(token: string | undefined, nowMs: number): AuthenticatedUser | null;
  /** A token with a new exp and the same sid; refuses (`login-required`) a session no longer active. */
  refresh(current: AuthenticatedUser, nowMs: number): string;
  /** `login-failed` on a wrong current password; the store's refusal (`password-too-short`) is thrown. */
  changePassword(current: AuthenticatedUser, currentPassword: string, next: string, nowMs: number): "ok" | "login-failed";
  logout(sid: string, nowMs: number): void;
  close(): void;
}

/** D13: 5 consecutive failures for a name, then min(2^(n-5), 300) seconds of 429. */
const THROTTLE_AFTER = 5;
const THROTTLE_MAX_SEC = 300;
/** Verified against when the name is unknown or disabled, so the answer's timing does not say which names exist. */
let dummyHash: string | null = null;

/** Spec §3.3: the token's exp, in seconds, for a token minted at `nowMs`. */
export function expiryOf(nowMs: number, sessionDays: number): { iat: number; exp: number } {
  const iat = Math.floor(nowMs / 1000);
  return { iat, exp: iat + sessionDays * 86_400 };
}

/**
 * Accounts spec §3.2-§3.3 (D1, D2, D13): the panel's accounts, opened once per panel from `<control root>`. Creates the
 * default owner on a store with no user. Roles are read from the user row on every request (a role change applies at
 * once), never from the token's claim.
 */
export function createPanelAuth(input: { root: string; by: string; sessionDays: number; log: (line: string) => void; nowMs: () => number }): PanelAuth {
  const key = loadOrCreateSigningKey(input.root);
  const store = openAccountsStore(input.root);
  try {
    ensureDefaultOwner(store, input.root, input.by, input.log, input.nowMs());
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  } catch (error) { store.close(); throw error; }
  const days = input.sessionDays;
  const throttle = new Map<string, { failures: number; until: number }>();

  const mint = (user: UserRow, sid: string, nowMs: number): { token: string; exp: number } => {
    const { iat, exp } = expiryOf(nowMs, days);
    return { token: signAccessToken(key, { sub: user.id, roles: user.roles, sid, iat, exp }), exp };
  };

  return {
    store,
    sessionDays: days,
    nowMs: input.nowMs,
    login(name, password, nowMs) {
      const entry = throttle.get(name);
      if (entry !== undefined && entry.failures >= THROTTLE_AFTER && nowMs < entry.until) {
        return { ok: false, code: "login-throttled", retryAfterSec: Math.ceil((entry.until - nowMs) / 1000) };
      }
      const found = store.findByName(name);
      const usable = found !== null && found.disabledAt === null;
      const verified = verifyPassword(password, usable ? found.passwordHash : dummyHash!);
      if (!usable || !verified) {
        const failures = (entry?.failures ?? 0) + 1;
        const until = failures >= THROTTLE_AFTER ? nowMs + Math.min(2 ** (failures - THROTTLE_AFTER), THROTTLE_MAX_SEC) * 1000 : 0;
        throttle.set(name, { failures, until });
        // One summary row per streak (D13), not one per attempt.
        if (failures === THROTTLE_AFTER) store.appendSecurityEvent("login-failed", { name, failures }, nowMs);
        return { ok: false, code: "login-failed" };
      }
      throttle.delete(name);
      const { passwordHash: _hash, ...user } = found;
      const { exp } = expiryOf(nowMs, days);
      const sid = store.createSession(user.id, nowMs, exp * 1000);
      return { ok: true, token: mint(user, sid, nowMs).token, csrf: randomBytes(32).toString("base64url"), user };
    },
    authenticate(token, nowMs) {
      if (token === undefined || token.length === 0) return null;
      const claims = verifyAccessToken(key, token, Math.floor(nowMs / 1000));
      if (claims === null || !store.sessionActive(claims.sid, claims.sub, nowMs)) return null;
      const user = store.findById(claims.sub);
      return user === null ? null : { user, claims };
    },
    refresh(current, nowMs) {
      const { token, exp } = mint(current.user, current.claims.sid, nowMs);
      store.extendSession(current.claims.sid, nowMs, exp * 1000);
      return token;
    },
    changePassword(current, currentPassword, next, nowMs) {
      const found = store.findByName(current.user.name);
      if (found === null || found.id !== current.user.id || !verifyPassword(currentPassword, found.passwordHash)) return "login-failed";
      store.setPassword(current.user.id, next, nowMs, `user:${current.user.id}`);
      // Spec §3.2: the forced change consumes the initial password; its file goes with it.
      if (found.mustChangePassword) rmSync(join(input.root, INITIAL_PASSWORD_FILE), { force: true });
      return "ok";
    },
    logout(sid, nowMs) {
      store.revokeSession(sid, nowMs);
    },
    close: () => store.close(),
  };
}
