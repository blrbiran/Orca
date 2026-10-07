import { AsyncLocalStorage } from "node:async_hooks";

/** Agent entry spec §4.2: which client sent a socket request. Attribution only, never authorization (§6). */
export const CLIENT_HEADER = "x-orca-client";
export const CLIENT_PATTERN = /^(cli|mcp)(:[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})?$/;

const current = new AsyncLocalStorage<{ commandId: string; client: string; principal: string }>();

/** Accounts spec §3.5, D3: client (spec §6) and principal ride beside the command, outside the raw command, so in neither hash. */
export function withCommandContext<T>(commandId: string, context: { client: string; principal: string }, fn: () => T): T {
  return current.run({ commandId, ...context }, fn);
}

/** Kept for its callers until Task 5 passes a principal: the Web is "web", a socket client is its agent. */
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
