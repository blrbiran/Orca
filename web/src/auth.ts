/**
 * Accounts spec §3.2-§3.4, §8: the page's half of logging in. Every call is one request through web/src/api.ts (the
 * CSRF header rides on every non-GET there); `fetchMe` turns its 401 into null, because "not logged in" is an answer the
 * gate acts on, not a failure.
 */
import { getJson, PanelRequestError, postJson } from "./api.js";
import type { PostResult } from "./api.js";

export type Role = "owner" | "member";

/** GET /api/auth/me -- src/panel/authRoutes.ts. `expiresAt` is epoch ms. */
export interface Me {
  user: { id: string; name: string; roles: Role[]; mustChangePassword: boolean };
  expiresAt: number;
  sessionDays: number;
}

/** A security event an owner is shown until acknowledged (spec §3.2); `body` is what the server recorded. */
export interface Notice {
  seq: number;
  at: number;
  kind: string;
  body: unknown;
}

export const isOwner = (me: Me | null): boolean => me?.user.roles.includes("owner") ?? false;

/** The session, or null when the panel answers 401 (no session, or one that ended); any other refusal is thrown. */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await getJson<Me>("/api/auth/me");
  } catch (err) {
    if (err instanceof PanelRequestError && err.refusal.status === 401) return null;
    throw err;
  }
}

export const login = (name: string, password: string): Promise<PostResult<{ user: Me["user"] }>> =>
  postJson("/api/auth/login", { name, password });
export const logout = (): Promise<PostResult<unknown>> => postJson("/api/auth/logout", {});
export const changePassword = (current: string, next: string): Promise<PostResult<unknown>> =>
  postJson("/api/auth/password", { current, next });

/** POST /api/auth/refresh: the new expiry, or null when the panel refused. */
export async function refreshSession(): Promise<{ expiresAt: number } | null> {
  const answer = await postJson<{ expiresAt: number }>("/api/auth/refresh", {});
  return answer.ok ? answer.body : null;
}

export const addUser = (input: { name: string; role: Role; password: string }): Promise<PostResult<unknown>> =>
  postJson("/api/auth/users", input);
export const fetchNotices = (): Promise<{ notices: Notice[] }> => getJson<{ notices: Notice[] }>("/api/auth/notices");
export const ackNotice = (seq: number): Promise<PostResult<unknown>> => postJson(`/api/auth/notices/${seq}/ack`, {});

/** Spec §3.3: refresh once less than half of the session's lifetime is left, so an active person is never logged out. */
export function shouldRefresh(me: Me, nowMs: number): boolean {
  return me.expiresAt - nowMs < (me.sessionDays * 86_400_000) / 2;
}

/** Spec §3.2: changed and added passwords are at least 12 characters (the server checks it too). */
export const MIN_PASSWORD_LENGTH = 12;
