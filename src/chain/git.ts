import { git } from "../scheduler/gitExec.js";

/**
 * Plan PC-20 (review I4): every git call the supervisor makes carries these two settings. It only ever commits the
 * one record file it wrote, so a hook means nothing to it; and a session that edits .git/config or .git/hooks must not
 * get the supervisor to run its code. Sessions themselves are untouched: this is used only under src/chain/**.
 */
export const SUPERVISOR_GIT_CONFIG = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"] as const;

export function chainGit(repo: string, args: string[]): Promise<string> {
  return git(repo, [...SUPERVISOR_GIT_CONFIG, ...args]);
}
