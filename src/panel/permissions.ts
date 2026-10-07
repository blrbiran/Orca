import type { Role } from "./accounts/jwt.js";
import type { CommandVerbV1 } from "../control/webProtocol.js";
import { humanOnlyRefusal } from "./humanOnly.js";

/** Accounts spec §3.5: who sent a request. A logged-in user on the TCP app, or the control socket's agent. */
export type Principal = { kind: "user"; userId: string; name: string; roles: readonly Role[] } | { kind: "agent"; client: string };

/** The command ledger's label (decision D3): `user:<id>` or `agent:<client>`. */
export const principalLabel = (p: Principal): string => (p.kind === "user" ? `user:${p.userId}` : `agent:${p.client}`);

/**
 * Accounts spec §3.5, the one table: a row per role and one for the socket's agent (§3.1: adding a role is a row here).
 * Reading and every other command are open to every row; a column is what only some rows may do. `humanOnly` is the
 * human-only surface (verbs and fields, humanOnly.ts), refused by name; `accounts` is adding users and reading or
 * acknowledging security notices, refused `owner-required`.
 */
export const PERMISSIONS = {
  owner: { humanOnly: true, accounts: true },
  member: { humanOnly: false, accounts: false },
  agent: { humanOnly: false, accounts: false },
} as const satisfies Record<Role | "agent", { humanOnly: boolean; accounts: boolean }>;

export type Permission = keyof (typeof PERMISSIONS)["owner"];

/** A user with several roles may do what any of them may. */
export const may = (p: Principal, permission: Permission): boolean =>
  (p.kind === "agent" ? ["agent" as const] : p.roles).some((row) => PERMISSIONS[row][permission]);

export const mayDoHumanOnly = (p: Principal): boolean => may(p, "humanOnly");

/** The refusal a control command gets from this principal, or null: by the same codes for a member and an agent. */
export function permissionRefusal(p: Principal, verb: CommandVerbV1, payload: unknown):
  { code: "control-verb-human-only" | "control-field-human-only"; message: string } | null {
  return mayDoHumanOnly(p) ? null : humanOnlyRefusal(verb, payload);
}
