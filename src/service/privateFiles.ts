// Dependency-free on purpose (node built-ins only): discovery and the accounts code load this without the panel server.
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Rule 17: new levels 0700 with an explicit chmod (umask may be anything); an existing directory is not ours to change. */
export function ensurePrivateDir(dir: string): void {
  const first = mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (first === undefined) return;
  for (let path = dir; ; path = dirname(path)) {
    chmodSync(path, 0o700);
    if (path === first) break;
  }
}

export function ensurePrivateFile(path: string): void {
  try { closeSync(openSync(path, "wx", 0o600)); chmodSync(path, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

/** A temp file created 0600 and renamed over the target: a reader sees the old bytes or the new ones. */
export function writePrivateFile(path: string, text: string): void {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, text, { mode: 0o600, flag: "wx" });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export function readTextOrNull(path: string): string | null {
  try { return readFileSync(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export function tailLines(path: string, n: number): string[] {
  const text = readTextOrNull(path);
  if (text === null) return [];
  return text.split("\n").filter((line) => line.length > 0).slice(-n);
}
