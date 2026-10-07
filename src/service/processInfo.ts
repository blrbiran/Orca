import { spawnSync } from "node:child_process";

/** Plan D9: the kernel's start time of a pid, or null when there is no such process. */
export function processStartTime(pid: number): string | null {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  const text = (result.stdout ?? "").trim();
  return result.status === 0 && text.length > 0 ? text : null;
}

export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
