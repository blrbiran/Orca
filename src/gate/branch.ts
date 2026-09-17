import { execFile } from "node:child_process";
import type { BranchOf } from "./classify.js";

/** Tier 0 gate spec 4: one deadline for every branch lookup, strictly inside the hook's 10 s timeout. */
export const GATE_DEADLINE_MS = 5_000;
export const DEADLINE_MESSAGE = "the gate's 5 s deadline ran out";

export function gitBranchOf(deadline: number): BranchOf {
  const cache = new Map<string, Promise<string>>();
  return (dir) => {
    let pending = cache.get(dir);
    if (pending === undefined) {
      pending = new Promise<string>((resolve, reject) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          reject(new Error(DEADLINE_MESSAGE));
          return;
        }
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeout: remaining }, (err, stdout) => {
          if (err !== null) reject(new Error((err as { killed?: boolean }).killed ? DEADLINE_MESSAGE : err.message.trim()));
          else resolve(stdout.trim());
        });
      });
      cache.set(dir, pending);
    }
    return pending;
  };
}
