import { afterEach, beforeEach } from "vitest";

export const CHAIN_ENV = ["ORCA_CHAIN_ID", "ORCA_CHAIN_SESSION"] as const;

/**
 * D-launch spec §8.2-5 (review I5): a test never inherits a chain session's variables. The suite may itself run
 * inside a chain session, where both are set. Same shape as tests/level/hook.test.ts:31-40 for CLAUDE_PROJECT_DIR.
 * Call it inside a describe; a test that wants chain mode sets the variable itself and afterEach puts it back.
 */
export function isolateChainEnv(): void {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const key of CHAIN_ENV) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of CHAIN_ENV) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
