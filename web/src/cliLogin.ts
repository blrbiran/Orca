/**
 * CLI browser login spec (2026-11-11) §6 (#208): the page `orca auth login` opens is `<panel>/#cli-login/<CODE>` -- a hash,
 * so the code never reaches a request line or a Referer. Every call goes through web/src/api.ts (CSRF on every POST).
 */
import { getJson, postJson } from "./api.js";
import type { PostResult } from "./api.js";

/** `XXXX-XXXX` from the panel's alphabet (no 0 O 1 I L); anything else is not a CLI login link. */
const HASH = /^#cli-login\/([2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4})$/;

export function parseCliLoginHash(hash: string): string | null {
  return HASH.exec(hash)?.[1] ?? null;
}

/** GET /api/auth/cli-login/:code -- src/panel/authRoutes.ts. `reported` is what the terminal says, never verified. */
export interface CliLoginView {
  code: string;
  state: "pending" | "approved" | "denied";
  requestedAt: number;
  expiresAt: number;
  reported: { client: string; pid: number | null; ppid: number | null; cwd: string | null; startedAt: number | null; verified: false };
  account: { name: string };
  tokenDays: number;
}
export type CliLoginAnswer = CliLoginView | { code: string; state: "cancelled" };

const path = (code: string): string => `/api/auth/cli-login/${encodeURIComponent(code)}`;
export const fetchCliLogin = (code: string): Promise<CliLoginAnswer> => getJson<CliLoginAnswer>(path(code));
export const approveCliLogin = (code: string): Promise<PostResult<{ state: "approved" }>> => postJson(`${path(code)}/approve`, {});
export const denyCliLogin = (code: string): Promise<PostResult<{ state: "denied" }>> => postJson(`${path(code)}/deny`, {});
