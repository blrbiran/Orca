import type { Role } from "./accounts/jwt.js";
import type { CommandVerbV1 } from "../control/webProtocol.js";
import { DISPATCHED_RUN_REFUSED, humanOnlyRefusal, socketTier } from "./humanOnly.js";
import type { Attribution } from "../control/commandClient.js";
import type { DirProjectOf } from "../control/dirGroup.js";

/** Accounts spec §3.5: who sent a request. A logged-in user on the TCP app, or the control socket's agent. */
export type Principal = { kind: "user"; userId: string; name: string; roles: readonly Role[] }
  // CLI v2 spec §15.4: `dispatchedRun` is the run id a socket request from an Orca-dispatched run carries. §15.3:
  // `person` is the account of a verified person token (set only by the socket's token check), its roles as stored now.
  | { kind: "agent"; client: string; dispatchedRun?: string; person?: { userId: string; name: string; roles: readonly Role[] } };

/** The command ledger's label (decision D3): `user:<id>` or `agent:<client>`. */
export const principalLabel = (p: Principal): string => (p.kind === "user" ? `user:${p.userId}` : `agent:${p.client}`);

/**
 * CLI v2 spec §16: the person accountable for a command and the channel it came by. A logged-in account is its own
 * person, on the Web; a socket call is the panel owner's (`owner`, the panel's --by: the socket is local to the owner's
 * machine), or the person token's account when it carries one (§15.3), by its client (`cli:<c>`, `mcp:<c>`). Never an
 * agent in `by`.
 */
export const attributionOf = (p: Principal, owner: string): Attribution =>
  p.kind === "user" ? { by: p.name, via: "web" } : { by: p.person?.name ?? owner, via: p.client };

/**
 * Accounts spec §3.5, the one table: a row per role and one for the socket's agent (§3.1: adding a role is a row here).
 * Reading and every other command are open to every row; a column is what only some rows may do. `humanOnly` is the
 * human-only surface (verbs and fields, humanOnly.ts), refused by name; `accounts` is adding users and reading or
 * acknowledging security notices, refused `owner-required`. CLI v2 spec §15.1 (I3): the agent row's human-only surface is
 * tiered (SOCKET_TIER, consulted by permissionRefusal before this table); its `false` is the blanket answer, never used
 * for a command.
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

/**
 * Gaps spec §6.3 (Task 9 fix round, controller's ruling): the authority `flow-effect` needs, as a fact about the sender --
 * an owner on the Web, or the socket agent carrying an owner's person token and not running for a run Orca dispatched.
 * The control routes put it beside the command (withCommandContext); the flow kernel requires it to release a held effect.
 */
export const hasPersonAuthority = (p: Principal): boolean =>
  p.kind === "user" ? mayDoHumanOnly(p) : p.dispatchedRun === undefined && p.person !== undefined && mayDoHumanOnly({ kind: "user", ...p.person });

/**
 * The refusal a control command gets from this principal, or null. A member: today's human-only codes (I3). The socket
 * agent (CLI v2 spec §15.1): an `open` entry passes; a `token` entry wants a verified person token,
 * `control-person-token-required` without one; a run Orca dispatched is refused every entry (§15.4), token or not.
 * Dir-requirements spec §5.1, §12: a run Orca dispatched may not open a requirement on a `dir` project (it would make the
 * folder a write target); `dirProjectOf` is the panel's (controlAssembly.ts). On a repository project it may, as before.
 */
export function permissionRefusal(p: Principal, verb: CommandVerbV1, payload: unknown, dirProjectOf?: DirProjectOf):
  { code: "control-verb-human-only" | "control-field-human-only" | "control-dispatched-run-refused" | "control-person-token-required"; message: string } | null {
  if (p.kind === "agent" && p.dispatchedRun !== undefined && DISPATCHED_RUN_REFUSED.has(verb))
    return { code: "control-dispatched-run-refused", message: `${verb} is not done by a run Orca dispatched (${p.dispatchedRun}); a person or an attended session does it.` };
  const repoId = (payload as { repoId?: unknown } | null | undefined)?.repoId;
  if (p.kind === "agent" && p.dispatchedRun !== undefined && verb === "requirement-open" && typeof repoId === "string" && (dirProjectOf?.(repoId) ?? null) !== null)
    return { code: "control-dispatched-run-refused", message: `${verb} on a folder project (${repoId}) is not done by a run Orca dispatched (${p.dispatchedRun}); a person or an attended session does it.` };
  const humanOnly = humanOnlyRefusal(verb, payload);
  // Gaps spec §6.3, §13: an `any` verb whose SOCKET_TIER predicate calls this payload `token` (a `defer` releasing a held
  // effect): the socket agent needs a person token (any person's: the verb is not human-only), and a run Orca dispatched
  // is refused it with one or without. A Web user is not tiered.
  if (humanOnly === null) {
    if (p.kind === "user" || socketTier(verb, payload) !== "token") return null;
    if (p.dispatchedRun !== undefined)
      return { code: "control-dispatched-run-refused", message: `${verb}, as sent, is not done by a run Orca dispatched (${p.dispatchedRun}); a person does it, from the Web UI or an attended session.` };
    if (p.person !== undefined) return null;
    return { code: "control-person-token-required", message: `${verb}, as sent, wants a person: log in with \`orca login\` and resend it with --as-person, or do it from the Web UI.` };
  }
  if (p.kind === "user") return mayDoHumanOnly(p) ? null : humanOnly;
  // The classification is the verb's and fields', not the principal's: it holds whatever tier an entry is in.
  if (p.dispatchedRun !== undefined)
    return { code: "control-dispatched-run-refused", message: `${verb} is not done by a run Orca dispatched (${p.dispatchedRun}); a person does it, from the Web UI or an attended session.` };
  if (socketTier(verb, payload) === "open") return null;
  // A token is its person's: an owner's opens the token tier; a member's answers the member's own refusal (I3).
  if (p.person !== undefined) return mayDoHumanOnly({ kind: "user", ...p.person }) ? null : humanOnly;
  return { code: "control-person-token-required", message: `${verb}, as sent, wants a person: log in with \`orca login\` and resend it with --as-person, or do it from the Web UI.` };
}
