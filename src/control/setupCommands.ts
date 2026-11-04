import type { DispatchedAs } from "./commandClient.js";
import { exitsZero } from "./debugRepro.js";

/**
 * Task setup spec 2026-11-04 §4.6: Orca runs a task's required checks itself in directories that would otherwise have no
 * dependencies (the criteria base run, the debug reproduce-first check), so the task's setup commands run there first,
 * each as a check runs (exitsZero: `sh -lc`, inherited environment, `as` the dispatched run, bounded by `timeoutMs`), in
 * order, stopping at the first that does not exit 0. The integration check runs its setup through its own spawn path
 * (integrationCheck.ts), not through here.
 */
export async function runSetup(workdir: string, commands: readonly string[], timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; command: string }> {
  for (const command of commands) {
    if (!(await exitsZero(workdir, command, timeoutMs, as, signal))) return { ok: false, command };
  }
  return { ok: true };
}

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
