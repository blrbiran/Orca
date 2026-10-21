/**
 * Flow engine spec §5.4 (H11) and §20: copy-back, the only way a flow writes into the person's folder.
 *
 * After a flow-head advance, only the change from the previous head (`from`) to the new one (`to`) is applied, path by
 * path -- never `git clean`, `checkout .` or a whole-tree overwrite, so a file the change does not name is never opened:
 *  - add: written when the path is free (a new file 0600, new directories 0700, set explicitly); a file the person put
 *    there is left alone and reported unless it already holds exactly the step's content;
 *  - modify: written in place when the folder still holds `from`'s blob (the file keeps its mode and inode); when the
 *    person edited it meanwhile, merged three-way (`git merge-file`); on a conflict the person's file stays
 *    byte-identical and the path is reported;
 *  - delete: applied only when the file still equals `from`'s blob;
 *  - never through a symlink: a path whose folder entry or any parent directory is a symlink is reported, not written;
 *    a new symlink is created only when its target stays inside the folder; a type change is reported.
 * Paths are the vault's (NFC); on a normalisation-insensitive file system they open the person's file whatever its form.
 */
import { lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { makePrivateDirs, vaultGit, vaultGitBytes, type Vault } from "./vault.js";

export interface CopyBackResult { written: string[]; conflicts: string[] }
interface Change { oldMode: string; newMode: string; oldBlob: string; newBlob: string; status: string; path: string }

const ZERO = /^0+$/;
const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

export async function changesBetween(vault: Vault, from: string, to: string): Promise<Change[]> {
  const raw = await vaultGit(vault, ["diff-tree", "-r", "-z", "--no-renames", "--raw", from, to]);
  const parts = raw.split("\0");
  const changes: Change[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]!.replace(/^:/, "").split(" ");
    if (meta.length < 5) continue;
    changes.push({ oldMode: meta[0]!, newMode: meta[1]!, oldBlob: meta[2]!, newBlob: meta[3]!, status: meta[4]!, path: parts[i + 1]! });
  }
  return changes;
}

type FolderEntry = { kind: "absent" } | { kind: "file"; bytes: Buffer } | { kind: "other" };

/** The folder's entry at `rel`, or null when reaching it would pass through a symlink or a non-directory. */
async function entryAt(dir: string, rel: string): Promise<FolderEntry | null> {
  const segments = rel.split("/");
  let cursor = dir;
  for (const segment of segments.slice(0, -1)) {
    cursor = join(cursor, segment);
    let stat;
    try { stat = await lstat(cursor); } catch { return { kind: "absent" }; }
    if (!stat.isDirectory()) return null;
  }
  const path = join(dir, rel);
  let stat;
  try { stat = await lstat(path); } catch { return { kind: "absent" }; }
  if (stat.isSymbolicLink()) return null;
  if (!stat.isFile()) return { kind: "other" };
  return { kind: "file", bytes: await readFile(path) };
}

/** A symlink target that, resolved from the link's directory, stays inside the folder. */
function staysInside(dir: string, rel: string, target: string): boolean {
  if (isAbsolute(target)) return false;
  const resolved = relative(dir, resolve(dirname(join(dir, rel)), target));
  return resolved !== "" && resolved !== ".." && !resolved.startsWith(`..${sep}`) && !isAbsolute(resolved);
}

export async function copyBack(vault: Vault, dir: string, from: string, to: string): Promise<CopyBackResult> {
  const written: string[] = [];
  const conflicts: string[] = [];
  const blob = (sha: string): Promise<Buffer> => vaultGitBytes(vault, ["cat-file", "blob", sha]);
  for (const change of (await changesBetween(vault, from, to)).sort((a, b) => byBytes(a.path, b.path))) {
    const target = join(dir, change.path);
    const entry = await entryAt(dir, change.path);
    if (entry === null) { conflicts.push(change.path); continue; }
    const isLink = (mode: string): boolean => mode === "120000";
    if (isLink(change.oldMode) || isLink(change.newMode)) {
      // Only a new link into a free path, pointing inside the folder.
      const target2 = change.status === "A" && isLink(change.newMode) ? (await blob(change.newBlob)).toString("utf8") : null;
      if (target2 !== null && entry.kind === "absent" && staysInside(dir, change.path, target2)) {
        makePrivateDirs(dirname(target));
        await symlink(target2, target);
        written.push(change.path);
      } else conflicts.push(change.path);
      continue;
    }
    if (change.status === "A") {
      const next = await blob(change.newBlob);
      if (entry.kind === "absent") {
        makePrivateDirs(dirname(target));
        await writeFile(target, next, { mode: 0o600, flag: "wx" });
        await chmod(target, 0o600);
        written.push(change.path);
      } else if (!(entry.kind === "file" && entry.bytes.equals(next))) conflicts.push(change.path);
      continue;
    }
    if (change.status === "D") {
      if (entry.kind === "absent") continue;
      if (entry.kind === "file" && entry.bytes.equals(await blob(change.oldBlob))) { await unlink(target); written.push(change.path); }
      else conflicts.push(change.path);
      continue;
    }
    if (change.status !== "M" || ZERO.test(change.newBlob) || entry.kind !== "file") { conflicts.push(change.path); continue; }
    const [before, after] = await Promise.all([blob(change.oldBlob), blob(change.newBlob)]);
    if (entry.bytes.equals(after)) continue;
    if (entry.bytes.equals(before)) { await writeFile(target, after); written.push(change.path); continue; }
    const merged = await mergeThreeWay(vault, entry.bytes, before, after);
    if (merged === null) { conflicts.push(change.path); continue; }
    await writeFile(target, merged);
    written.push(change.path);
  }
  return { written, conflicts };
}

/** `git merge-file -p` over temporary copies; null on a conflict (the person's file is then left as it is). */
async function mergeThreeWay(vault: Vault, current: Buffer, base: Buffer, other: Buffer): Promise<Buffer | null> {
  const scratch = await mkdtemp(join(tmpdir(), "orca-copy-back-"));
  try {
    const [c, b, o] = ["current", "base", "other"].map((name) => join(scratch, name)) as [string, string, string];
    await Promise.all([writeFile(c, current, { mode: 0o600 }), writeFile(b, base, { mode: 0o600 }), writeFile(o, other, { mode: 0o600 })]);
    try { return await vaultGitBytes(vault, ["merge-file", "-p", c, b, o]); }
    catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "number" && code > 0) return null;
      throw error;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
