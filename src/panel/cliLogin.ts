/**
 * CLI browser login spec (2026-11-11) §6, issue #208: the panel's open `orca auth login` requests, in memory only (a
 * restart forgets them, §6.9). Two ids per request (§6.4): an 8-character code the person compares between the terminal
 * and the page, and a request id (32 random bytes) only the CLI holds, to collect with. Approve, deny and cancel consume
 * the code; a collect consumes the request id. An approval records who approved; the token is minted by the caller at
 * collect, after reading the approver again (§6.5), so nothing here ever holds a token.
 */
import { randomBytes, randomInt } from "node:crypto";

/** Without 0 O 1 I L, so a code read aloud or retyped is not ambiguous. */
export const CLI_LOGIN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CLI_LOGIN_LIMITS = { max: 16, ttlMs: 300_000, pollMs: 1_000 };
/** How many ended requests (expired, cancelled) are remembered so a late poll or page can be told which; oldest dropped first. */
const ENDED_KEPT = 64;

/** What the requester says about itself (spec §6.2): shown labelled unverified; nothing here can check it. */
export interface CliLoginReported { client: string; pid: number | null; ppid: number | null; cwd: string | null; startedAt: number | null }
export type CliLoginState = "pending" | "approved" | "denied";
export interface CliLoginView { code: string; state: CliLoginState; reported: CliLoginReported; requestedAt: number; expiresAt: number }
export type CliLoginRefusal = "cli-login-unknown" | "cli-login-expired" | "cli-login-busy";
export type CliLoginCollect = { state: "pending" } | { state: "approved"; approverId: string } | { state: "denied" } | { refused: CliLoginRefusal };

interface Entry { requestId: string; code: string; reported: CliLoginReported; requestedAt: number; expiresAt: number; state: CliLoginState; approverId?: string }

export interface CliLoginRequests {
  readonly pollMs: number;
  start(reported: CliLoginReported): { requestId: string; code: string; expiresAt: number } | { refused: "cli-login-busy" };
  /** Spec §6.10: a request the CLI cancelled is shown as cancelled (no details) until it is forgotten. */
  view(code: string): CliLoginView | { code: string; state: "cancelled" } | { refused: CliLoginRefusal };
  approve(code: string, userId: string): { state: "approved" } | { refused: CliLoginRefusal };
  deny(code: string): { state: "denied" } | { refused: CliLoginRefusal };
  cancel(requestId: string): { state: "cancelled" } | { refused: CliLoginRefusal };
  collect(requestId: string): CliLoginCollect;
}

/** `XXXXXXXX` -> `XXXX-XXXX`, the only form shown. */
export const displayCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;
/** What a person types or a URL carries, back to the stored form: case and the dash do not matter. */
const normalCode = (typed: string): string => typed.toUpperCase().replace(/-/g, "");

export function createCliLoginRequests(input: { nowMs: () => number; max?: number; ttlMs?: number; pollMs?: number }): CliLoginRequests {
  const max = input.max ?? CLI_LOGIN_LIMITS.max;
  const ttlMs = input.ttlMs ?? CLI_LOGIN_LIMITS.ttlMs;
  const byRequest = new Map<string, Entry>();
  const byCode = new Map<string, Entry>();
  // Insertion order is end order; keyed by request id and by code, each mapping to why the request ended.
  const ended = new Map<string, "cli-login-expired" | "cli-login-cancelled">();

  const remember = (entry: Entry, why: "cli-login-expired" | "cli-login-cancelled"): void => {
    for (const key of [`r:${entry.requestId}`, `c:${entry.code}`]) { ended.delete(key); ended.set(key, why); }
    while (ended.size > ENDED_KEPT * 2) ended.delete(ended.keys().next().value!);
  };
  const drop = (entry: Entry): void => { byRequest.delete(entry.requestId); byCode.delete(entry.code); };
  /** Spec §6.9: expired entries go on every access. */
  const purge = (): void => {
    const now = input.nowMs();
    for (const entry of [...byRequest.values()]) if (now >= entry.expiresAt) { drop(entry); remember(entry, "cli-login-expired"); }
  };
  const missing = (key: string): CliLoginRefusal => (ended.get(key) === "cli-login-expired" ? "cli-login-expired" : "cli-login-unknown");
  const pendingByCode = (typed: string): Entry | { refused: CliLoginRefusal } => {
    purge();
    const code = normalCode(typed);
    const entry = byCode.get(code);
    if (entry === undefined) return { refused: missing(`c:${code}`) };
    return entry.state === "pending" ? entry : { refused: "cli-login-unknown" };
  };
  const newCode = (): string => {
    for (;;) {
      let code = "";
      for (let i = 0; i < 8; i += 1) code += CLI_LOGIN_ALPHABET[randomInt(CLI_LOGIN_ALPHABET.length)];
      if (!byCode.has(code)) return code;
    }
  };

  return {
    pollMs: input.pollMs ?? CLI_LOGIN_LIMITS.pollMs,
    start(reported) {
      purge();
      if (byRequest.size >= max) return { refused: "cli-login-busy" };
      const now = input.nowMs();
      const entry: Entry = { requestId: randomBytes(32).toString("base64url"), code: newCode(), reported, requestedAt: now, expiresAt: now + ttlMs, state: "pending" };
      byRequest.set(entry.requestId, entry);
      byCode.set(entry.code, entry);
      return { requestId: entry.requestId, code: displayCode(entry.code), expiresAt: entry.expiresAt };
    },
    view(typed) {
      purge();
      const code = normalCode(typed);
      const entry = byCode.get(code);
      if (entry === undefined) return ended.get(`c:${code}`) === "cli-login-cancelled" ? { code: displayCode(code), state: "cancelled" } : { refused: missing(`c:${code}`) };
      return { code: displayCode(entry.code), state: entry.state, reported: entry.reported, requestedAt: entry.requestedAt, expiresAt: entry.expiresAt };
    },
    approve(typed, userId) {
      const entry = pendingByCode(typed);
      if ("refused" in entry) return entry;
      entry.state = "approved";
      entry.approverId = userId;
      return { state: "approved" };
    },
    deny(typed) {
      const entry = pendingByCode(typed);
      if ("refused" in entry) return entry;
      entry.state = "denied";
      return { state: "denied" };
    },
    cancel(requestId) {
      purge();
      const entry = byRequest.get(requestId);
      if (entry === undefined) return { refused: missing(`r:${requestId}`) };
      drop(entry);
      remember(entry, "cli-login-cancelled");
      return { state: "cancelled" };
    },
    collect(requestId) {
      purge();
      const entry = byRequest.get(requestId);
      if (entry === undefined) return { refused: missing(`r:${requestId}`) };
      if (entry.state === "pending") return { state: "pending" };
      drop(entry);
      return entry.state === "approved" ? { state: "approved", approverId: entry.approverId! } : { state: "denied" };
    },
  };
}
