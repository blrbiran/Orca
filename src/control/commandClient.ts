import { AsyncLocalStorage } from "node:async_hooks";

/** Agent entry spec §4.2: which client sent a socket request. Attribution only, never authorization (§6). */
export const CLIENT_HEADER = "x-orca-client";
export const CLIENT_PATTERN = /^(cli|mcp)(:[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})?$/;
/**
 * CLI v2 spec §15.4, §15.5: every process Orca starts for work carries `ORCA_DISPATCHED_RUN=<runId>` (no KEY/SECRET/TOKEN
 * in the name, so environment filters keep it); the CLI sends it as this socket header, and the socket refuses the §15.1
 * verbs to it. A convention at Orca's interfaces, not a security boundary.
 */
export const DISPATCHED_RUN_ENV = "ORCA_DISPATCHED_RUN";
export const DISPATCHED_RUN_HEADER = "x-orca-dispatched-run";
/** CLI v2 spec §15.3: the panel state's empty directory every dispatched run's ORCA_PERSON_DIR names (controlAssembly.ts). */
export const DISPATCHED_PERSON_DIRNAME = "dispatched-person";
/**
 * Review I1/M1 (session b37f7ce9): who an agent-written command Orca runs itself runs as -- the run Orca dispatched, and
 * the empty person directory when one is known -- as the variables set over the inherited environment.
 */
export interface DispatchedAs { runId: string; personDir?: string }
export const dispatchedEnv = (as: DispatchedAs): Record<string, string> =>
  ({ [DISPATCHED_RUN_ENV]: as.runId, ...(as.personDir === undefined ? {} : { ORCA_PERSON_DIR: as.personDir }) });
/** The marker header for a request sent from this environment; empty when the variable is unset or empty. */
export const dispatchedRunHeaders = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const run = env[DISPATCHED_RUN_ENV];
  return run === undefined || run === "" ? {} : { [DISPATCHED_RUN_HEADER]: run };
};

/** CLI v2 spec §16: `by` the accountable person, `via` the channel (web, cli:<c>, mcp:<c>); two fields, never one string. */
export interface Attribution { by: string; via: string }

/**
 * Gaps spec §6.3 (Task 9 fix round, controller's ruling): `personAuthority` -- the permission layer established that a
 * person with the authority `flow-effect` needs sent it (an owner on the Web, or an owner's person token on the socket,
 * never a run Orca dispatched). Absent: no such authority.
 */
type CommandContext = { client: string; principal: string; attribution?: Attribution; personAuthority?: boolean; pauseAuthority?: boolean };
const current = new AsyncLocalStorage<{ commandId: string } & CommandContext>();

/** Accounts spec §3.5, D3: client (spec §6) and principal ride beside the command, outside the raw command, so in neither hash. */
export function withCommandContext<T>(commandId: string, context: CommandContext, fn: () => T): T {
  return current.run({ commandId, ...context }, fn);
}

/** Kept for the criteria that call it (accounts ruling Q1); the panel passes its principal to withCommandContext. */
export function withCommandClient<T>(commandId: string, client: string, fn: () => T): T {
  return withCommandContext(commandId, { client, principal: client === "web" ? "web" : `agent:${client}` }, fn);
}

/**
 * The context for the row being written, or null. Matched on commandId: work the call leaves running in the background
 * inherits the async context, and must not stamp a row it did not come from.
 */
const forCommand = (commandId: string) => { const c = current.getStore(); return c !== undefined && c.commandId === commandId ? c : null; };
export function commandClientFor(commandId: string): string | null { return forCommand(commandId)?.client ?? null; }
export function commandPrincipalFor(commandId: string): string | null { return forCommand(commandId)?.principal ?? null; }
/**
 * CLI v2 spec §16: who a writer records for this command. The control routes set it (controlApi.ts, from the principal);
 * a command issued inside the panel process (Orca's own, or a caller that skips the routes) is `via panel`, by `fallbackBy`.
 */
export function commandAttributionFor(commandId: string, fallbackBy: string): Attribution {
  return forCommand(commandId)?.attribution ?? { by: fallbackBy, via: "panel" };
}
/** The routed attribution only, or null: for a store whose rows predate `via` and stay as they were when none is known. */
export function routedAttributionFor(commandId: string): Attribution | null { return forCommand(commandId)?.attribution ?? null; }
/** Gaps spec §6.3: whether the routed principal of this command has person authority; false when none was routed. */
export function routedPersonAuthorityFor(commandId: string): boolean { return forCommand(commandId)?.personAuthority === true; }
/** Live transcript spec §10.5.3: whether the routed principal of this command may pause; false when none was routed. */
export function routedPauseAuthorityFor(commandId: string): boolean { return forCommand(commandId)?.pauseAuthority === true; }
/** CLI v2 spec §16: the attribution where a store holds one line of text. */
export const attributionText = (a: Attribution): string => `by ${a.by} via ${a.via}`;
