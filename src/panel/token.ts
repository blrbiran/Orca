import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-time, per-process. 32 bytes of CSPRNG output, hex encoded.
 *
 * spec section 3.3 registers what this does NOT buy: there is no TLS, the token
 * travels inside the HTML, there is no revocation and no expiry. It is the
 * whole of authorisation, and authorisation is not identity -- who someone is
 * comes from --by, stored separately, so wiring a real authenticator later
 * replaces only that half.
 */
export function mintToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  // timingSafeEqual throws on a length mismatch, which would turn a wrong-length
  // guess into an exception instead of a 401 -- and leak the length by the
  // difference in response.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
