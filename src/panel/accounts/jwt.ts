import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "owner" | "member";
export interface AccessClaims { sub: string; roles: Role[]; sid: string; iat: number; exp: number }
const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const CLAIM_KEYS = ["exp", "iat", "roles", "sid", "sub"];

export function signAccessToken(key: Buffer, claims: AccessClaims): string {
  const body = Buffer.from(JSON.stringify({ sub: claims.sub, roles: claims.roles, sid: claims.sid, iat: claims.iat, exp: claims.exp })).toString("base64url");
  return `${HEADER}.${body}.${createHmac("sha256", key).update(`${HEADER}.${body}`).digest("base64url")}`;
}

/** Spec §3.3: only this exact header, only these claims, only before exp. Anything else is no token. */
export function verifyAccessToken(key: Buffer, token: string, nowSec: number): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = createHmac("sha256", key).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2]!, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>; } catch { return null; }
  if (Object.keys(claims).sort().join(",") !== CLAIM_KEYS.join(",")) return null;
  const { sub, roles, sid, iat, exp } = claims;
  if (typeof sub !== "string" || typeof sid !== "string" || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
  if (!Array.isArray(roles) || !roles.every((role) => role === "owner" || role === "member")) return null;
  if ((exp as number) <= nowSec) return null;
  return { sub, roles: roles as Role[], sid, iat: iat as number, exp: exp as number };
}
