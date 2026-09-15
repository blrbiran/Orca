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

export const PANEL_HOST_NOT_ALLOWED = "panel-host-not-allowed";

/** The names a panel answers to whatever it is bound to: the browser reached it through loopback. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * `Host` header -> hostname, lowercased, port dropped. `[::1]:7777` -> `::1`;
 * `localhost:7777` -> `localhost`. Anything else that is not one of those two
 * shapes (an unbracketed IPv6 literal, an empty header) yields undefined and is
 * refused -- a guard that guesses at a malformed header is not a guard.
 */
function hostnameOf(host: string): string | undefined {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
  if (bracketed) return bracketed[1]!.toLowerCase();
  const plain = /^([^:[\]]+)(?::\d+)?$/.exec(host);
  return plain ? plain[1]!.toLowerCase() : undefined;
}

/**
 * Final review I-4 / ruling R67: DNS rebinding. Binding to loopback keeps
 * other machines out; it does not keep out a page in the person's own browser
 * whose hostname re-resolves to 127.0.0.1 -- that page's requests are
 * same-origin, so it could read the token-carrying HTML and then use the whole
 * API. Such a request still names the attacker's hostname in `Host`, and that
 * is what this refuses.
 *
 * Accepted: the loopback names, plus the bind address itself. For a confirmed
 * external bind that is the address the person chose to expose; for a
 * loopback bind other than 127.0.0.1 (the guard above allows all of
 * 127.0.0.0/8) it is the address the panel's own printed URL names, and an IP
 * literal cannot be rebound. Exact matches only -- never a suffix match, which
 * would let `evil.localhost` through.
 */
export function isHostAllowed(bind: string, host: string | undefined): boolean {
  if (host === undefined) return false;
  const hostname = hostnameOf(host);
  if (hostname === undefined) return false;
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname === bind.toLowerCase();
}
