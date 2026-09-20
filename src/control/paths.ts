import { lstatSync, mkdirSync, realpathSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join, parse, resolve, sep } from "node:path";
import { ControlError } from "./errors.js";

export function privateDirectory(input: string): string {
  let path = resolve(input);
  // macOS system aliases are not user-provided state redirections.
  for (const alias of ["/tmp", "/var", "/etc"]) {
    if (path === alias || path.startsWith(alias + sep)) path = realpathSync(alias) + path.slice(alias.length);
  }
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { mkdirSync(cursor, {mode:0o700}); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new ControlError("control-path-symlink");
    if (!stat.isDirectory()) throw new ControlError("control-path-not-directory");
  }
  return realpathSync(path);
}
export function syncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function assertRegular(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw new ControlError("control-path-unsafe-file");
}
