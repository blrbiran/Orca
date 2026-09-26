import { isAbsolute, join } from "node:path";

/**
 * Agent selection spec §3, §8 and CLAUDE.md Rule 17. The installation table lives outside any repository, in
 * the user's own data, so the environment variable is not a convenience: every criterion points it at a temporary
 * directory, and without it a criterion would write into the developer's real ~/.orca.
 *
 * ⚠️ Plan review P1 (2026-09-26, a plan-writing mutation once wrote real files into a real ~/.orca): the default
 * branch uses the PASSED environment's `HOME`, never `os.homedir()`. A caller that wants the real home passes the
 * real `process.env`; a criterion passes a temporary one. A missing or non-absolute `HOME` is refused rather than
 * silently falling back to the process's real home.
 */
export class AgentsPathError extends Error {}

export function agentsTablePath(env: { HOME?: string; ORCA_AGENTS_TABLE?: string }): string {
  const override = env.ORCA_AGENTS_TABLE;
  if (override !== undefined && override.length > 0) return override;
  const home = env.HOME;
  if (home === undefined || home.length === 0 || !isAbsolute(home)) {
    throw new AgentsPathError(`ORCA_AGENTS_TABLE is not set and HOME is not an absolute path (got ${JSON.stringify(home)}); refusing to default the agents table location`);
  }
  return join(home, ".orca", "agents.json");
}

/** Given explicitly, never inherited from the umask; an existing directory or file keeps the mode its owner gave it. */
export const AGENTS_DIR_MODE = 0o700;
export const AGENTS_FILE_MODE = 0o600;

/** spec §6.7: an existing table is never overwritten; the new detection goes beside it. */
export const draftPathOf = (table: string): string => `${table}.draft.json`;
