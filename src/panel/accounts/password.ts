import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Accounts spec §3.1: scrypt from node:crypto, no native dependency. D17: N=2^17, r=8 needs 128 MiB. */
const N = 131072, R = 8, P = 1, KEY_BYTES = 64, SALT_BYTES = 32, MAXMEM = 256 * 1024 * 1024;
export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (n !== N || r !== R || p !== P) return false;
  const salt = Buffer.from(parts[4]!, "base64"), expected = Buffer.from(parts[5]!, "base64");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  return timingSafeEqual(scryptSync(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM }), expected);
}
