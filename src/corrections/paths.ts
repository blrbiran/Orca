import { homedir } from "node:os";
import { join } from "node:path";

/**
 * spec §4 + CLAUDE.md Rule 17. The environment variable is not a convenience:
 * without it every criterion in this subsystem would write into the developer's
 * real ~/.orca. A criterion that touches a person's actual user data is
 * unacceptable even if it only writes one line.
 *
 * ⚠️ os.homedir(), never the literal "~" — node does not expand it, so the
 * shell spelling would create a directory whose name really is "~".
 */
export function correctionsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ORCA_CORRECTIONS_DIR;
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), ".orca");
}

export const correctionsFile = (dir: string): string => join(dir, "corrections.jsonl");
export const storeLockDir = (dir: string): string => join(dir, ".corrections-lock");

/**
 * spec §14.17. Given explicitly, never inherited from the umask — this is user
 * data outside any repository. Existing files' modes are left alone: they are a
 * person's, and changing them is a decision this program does not get to make.
 */
export const CORRECTIONS_DIR_MODE = 0o700;
export const CORRECTIONS_FILE_MODE = 0o600;
