import { randomBytes } from "node:crypto";
import { closeSync, fchmodSync, lstatSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import { ensurePrivateDir } from "../../service/privateFiles.js";

export const JWT_KEY_FILE = "jwt.key";
const KEY_BYTES = 32;

/** Rule 17: only ever a new file, created 0600 with an explicit chmod (umask may be anything). */
function writeNew(path: string, bytes: Buffer): void {
  const fd = openSync(path, "wx", 0o600);
  try { fchmodSync(fd, 0o600); writeSync(fd, bytes); } finally { closeSync(fd); }
}

/**
 * Spec §3.3: 32 random bytes, created once with mode 0600, persisted so a restart logs nobody out. An existing file is
 * read as it is (its mode is the person's); anything but a regular file of 32 bytes is refused, never replaced.
 */
export function loadOrCreateSigningKey(root: string): Buffer {
  ensurePrivateDir(root);
  const path = join(root, JWT_KEY_FILE);
  try { writeNew(path, randomBytes(KEY_BYTES)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const key = lstatSync(path).isFile() ? readFileSync(path) : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) throw new Error("jwt-key-invalid");
  return key;
}

/**
 * D12: a new key under a fresh temp name, renamed over the old one; the caller also revokes every session. The temp
 * name carries random bytes so a temp file left by a crashed rotation never blocks the next one.
 */
export function rotateSigningKey(root: string): void {
  ensurePrivateDir(root);
  const temp = join(root, `${JWT_KEY_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeNew(temp, randomBytes(KEY_BYTES));
  renameSync(temp, join(root, JWT_KEY_FILE));
}
