import { AsyncLocalStorage } from "node:async_hooks";

/** Agent entry spec §4.2: which client sent a socket request. Attribution only, never authorization (§6). */
export const CLIENT_HEADER = "x-orca-client";
export const CLIENT_PATTERN = /^(cli|mcp)(:[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})?$/;

const current = new AsyncLocalStorage<{ commandId: string; client: string }>();

/** Spec §6: set by the route around the service call; outside the raw command, so in neither hash. */
export function withCommandClient<T>(commandId: string, client: string, fn: () => T): T {
  return current.run({ commandId, client }, fn);
}

/**
 * The client for the row being written, or null. Matched on commandId: work the call leaves running in the background
 * inherits the async context, and must not stamp a row it did not come from.
 */
export function commandClientFor(commandId: string): string | null {
  const context = current.getStore();
  return context !== undefined && context.commandId === commandId ? context.client : null;
}
