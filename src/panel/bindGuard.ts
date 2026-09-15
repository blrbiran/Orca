import { PanelRejection } from "./rejection.js";

export const EXTERNAL_BIND_NOT_CONFIRMED = "external-bind-not-confirmed";

/**
 * Loopback is the only address this panel opens on without a second, explicit
 * sentence from the person starting it.
 *
 * IPv4 loopback is the whole 127.0.0.0/8 block, not just 127.0.0.1: binding
 * 127.0.0.2 is as local as binding 127.0.0.1, and refusing it would be a guard
 * that is wrong in the safe direction but still wrong.
 */
function isLoopback(address: string): boolean {
  if (address === "::1" || address === "localhost") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!v4) return false;
  const octets = v4.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return false;
  return octets[0] === 127;
}

/**
 * spec section 3.2. Called BEFORE listen(), on purpose: if it ran after, an
 * address that is on no interface would come back as EADDRNOTAVAIL and the
 * criterion could not tell "the guard refused" from "the kernel refused".
 * Three different failures all leave nothing listening.
 */
export function assertBindAllowed(bind: string, confirmedExternal: boolean): void {
  if (isLoopback(bind) || confirmedExternal) return;
  throw new PanelRejection(
    EXTERNAL_BIND_NOT_CONFIRMED,
    `--bind ${bind} would open this panel to other machines. Pass ` +
      `--i-know-this-is-exposed as well if you mean it. What you are agreeing to: there is no ` +
      `TLS, the token travels in the HTML, it cannot be revoked or expired, and one process has ` +
      `exactly one identity -- so this suits you reaching your own panel from another of your ` +
      `machines, and does not suit a team.`,
  );
}
