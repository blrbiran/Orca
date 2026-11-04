/**
 * Task setup spec 2026-11-04 §4.6: several tasks' setup commands as one list, for the integration check and the
 * conflict-resolution contracts. No imports, so src/scheduler can use it without pulling in the check runners.
 */

/** A contract's `context.setupCommands`, read defensively (a contract may arrive as opaque JSON). */
export function setupCommandsOf(contract: unknown): readonly string[] | undefined {
  const setup = (contract as { context?: { setupCommands?: unknown } } | null | undefined)?.context?.setupCommands;
  return Array.isArray(setup) ? setup.filter((command): command is string => typeof command === "string") : undefined;
}

/**
 * The setup commands of several tasks as one list: first-seen order, each command once. `undefined` when no task has
 * any, so a contract built from it omits the key (spec §4.2: absent, never `[]`).
 */
export function unionSetup(lists: Iterable<readonly string[] | undefined>): string[] | undefined {
  const out: string[] = [];
  for (const list of lists) for (const command of list ?? []) if (!out.includes(command)) out.push(command);
  return out.length === 0 ? undefined : out;
}
