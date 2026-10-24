/**
 * Dir-requirements spec §8 and §9.1: placement, the only way a dir group's landed work reaches the person's folder.
 *
 * - `classifyLandingPaths` (§8.3): each path of a `from → to` change between two folder commits, judged by reading the
 *   folder directly (`lstat`, never followed, never through a snapshot): `unwritable` (symlink / type-change over the
 *   whole swapped prefix / case-clash, on every file system), else `at-to` (skipped), `at-from` (written) or `changed`
 *   (a collision).
 * - `placeChange` (§8.4): one `at-from` path written with no merge and no clobber -- journaled `.orca-<8 hex>` names,
 *   the old entry moved aside and compared with `from` before anything is put at the path, the new version put there by
 *   `link` (fails when the path exists again), modes set explicitly.
 * - `prepareFolderPlacement` (§8.5 steps 1–6) and `writeFolderPlacement` (steps 6–8, with 9 and 10): one folder of one
 *   group, given the frozen `{ dir, vaultId }`, explicit refs and a `save` that updates a plain placement record -- they
 *   never read a group body, so the multi-dir spec (H7) calls them per folder.
 * - `placeDirGroups` (§8.5): the driver pass, once per round after the integration pass: each dir group in id order,
 *   steps 1–8 under ONE `withDirLock(dir)` (not re-entrant: nothing inside takes it again).
 *
 * Code only (Rule 5). The folder's files are the person's: new files 0644/0755, new directories 0755, set by chmod (§8.4,
 * review C2); Orca's own temporaries are 0600 while they exist.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dirWorkspaceOf, readPlacement, STOP_KEPT, type PlacementRecord } from "./dirGroup.js";
import { DirFolderMissing, nextFolderCommit, openDirWorkspace, type DirWorkspace, type FrozenDirWorkspace } from "./dirWorkspace.js";
import { ControlError } from "./errors.js";
import { groupStopped } from "./executionDriver.js";
import { archivedMarkOf } from "./archivedMark.js";
import { groupHasReconcilingRun, readGroup, saveGroup } from "./queries.js";
import { compareAndSwap, workBranchRef } from "./workspace.js";
import { changesBetween } from "../flow/vault/copyBack.js";
import { commitDriftOnto, treeWith } from "../flow/vault/drift.js";
import { withDirLock } from "../flow/vault/dirLock.js";
import { vaultGit, vaultGitBytes } from "../flow/vault/vault.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";

/**
 * Test-only fault injection and test hooks (plan, builder's decision "crash hooks"; the pattern of IntegrationCrashPoint):
 * a throw ends the pass as a process death would (no record is written after it); a hook that returns lets the pass go on
 * (the lossless criteria write into the folder there). `path` is the landing path being written.
 */
export type DirPlacementCrashPoint =
  /** §8.5 step 6: after classification, before any stop or write. */
  | "after-classify"
  /** §8.5 step 7: after the `pending` ref and the journal, before any folder write. */
  | "after-journal"
  /** After one `at-from` path is written. */
  | "after-path"
  /** §8.4: inside a write, the temporary created and half-filled. */
  | "tmp-half-written"
  /** §8.4: after classification, before `rename(p, a)`. */
  | "before-aside"
  /** §8.4: after `rename(p, a)`, before the comparison. */
  | "after-aside"
  /** §8.4: after the comparison found `from`, before `link(t, p)`. */
  | "before-link"
  /** §8.4: after `link(t, p)`, before `unlink(a)`. */
  | "after-link"
  /** §8.5 step 8: after the `placed` CAS, before the body update. */
  | "after-placed-cas"
  /** §9.2 step 4: after the `T′` CAS of a take-folder, before the `placed` CAS. */
  | "after-tip-cas"
  /** §9.2 step 5: after the `placed` CAS of a take-folder, before the body update. */
  | "after-take-placed-cas";
export type PlacementHook = (point: DirPlacementCrashPoint, path?: string) => void;

const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const ZERO = /^0+$/;
const fold = (name: string): string => name.normalize("NFC").toLowerCase();
const nfc = (name: string): string => name.normalize("NFC");

/** One side of a landing path: its mode and blob in that folder commit; null when the path is absent there. */
export interface Side { readonly mode: string; readonly blob: string }
export interface LandingPath { readonly path: string; readonly from: Side | null; readonly to: Side | null }
export type UnwritableReason = "symlink" | "type-change" | "case-clash";
export interface Classification {
  /** Every landing path of the change, in byte order. */
  landing: LandingPath[];
  atFrom: LandingPath[]; atTo: string[]; changed: string[];
  unwritable: Array<{ path: string; reason: UnwritableReason }>;
}

/** The landing paths of `from → to` (`--no-renames`), in byte order. */
export async function landingPaths(ws: DirWorkspace, from: string, to: string): Promise<LandingPath[]> {
  return (await changesBetween(ws.vault, from, to)).map((c) => ({
    path: c.path,
    from: ZERO.test(c.oldMode) ? null : { mode: c.oldMode, blob: c.oldBlob },
    to: ZERO.test(c.newMode) ? null : { mode: c.newMode, blob: c.newBlob },
  })).sort((a, b) => byBytes(a.path, b.path));
}

type Entry = { kind: "absent" } | { kind: "file"; mode: number; path: string } | { kind: "dir" } | { kind: "symlink" } | { kind: "other" };
async function entryAt(abs: string): Promise<Entry> {
  let stat;
  try { stat = await lstat(abs); }
  catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" }; throw error; }
  if (stat.isSymbolicLink()) return { kind: "symlink" };
  if (stat.isDirectory()) return { kind: "dir" };
  if (stat.isFile()) return { kind: "file", mode: stat.mode & 0o7777, path: abs };
  return { kind: "other" };
}

/** git's blob id of these bytes, in the vault's object format (sha1: 40 hex, sha256: 64). */
function blobId(bytes: Buffer, like: string): string {
  return createHash(like.length === 64 ? "sha256" : "sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * §8.3 "equals a side": absent and absent, or a regular file with the same bytes and the same executable state (any x bit
 * set ⇔ `100755`).
 */
async function equalsSide(entry: Entry, side: Side | null): Promise<boolean> {
  if (side === null) return entry.kind === "absent";
  if (entry.kind !== "file" || (side.mode !== "100644" && side.mode !== "100755")) return false;
  if (((entry.mode & 0o111) !== 0) !== (side.mode === "100755")) return false;
  return blobId(await readFile(entry.path), side.blob) === side.blob;
}

const ancestors = (path: string): string[] => {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join("/"));
};

/** §8.3 step 1: the static reasons a landing path cannot be written as is, by path. */
async function unwritableOf(dir: string, landing: readonly LandingPath[]): Promise<Map<string, UnwritableReason>> {
  const reasons = new Map<string, UnwritableReason>();
  const paths = new Set(landing.map((l) => l.path));
  const prefixes = new Set<string>();
  for (const l of landing) {
    // symlink: a link on either side, or a link among the path's parents in the folder.
    if (l.from?.mode === "120000" || l.to?.mode === "120000") { reasons.set(l.path, "symlink"); continue; }
    let parentFile: string | null = null;
    for (const parent of ancestors(l.path)) {
      const entry = await entryAt(join(dir, parent));
      if (entry.kind === "symlink") { reasons.set(l.path, "symlink"); break; }
      if (entry.kind === "absent") break;
      if (entry.kind !== "dir") { parentFile = parent; break; }
    }
    if (reasons.has(l.path)) continue;
    // type-change: a submodule (or any other mode); one side's file is the other side's directory (both are then landing
    // paths); a file in `to` where the folder has a directory; a directory `to` needs where the folder has a file.
    const odd = (side: Side | null): boolean => side !== null && !["100644", "100755", "120000"].includes(side.mode);
    if (odd(l.from) || odd(l.to)) prefixes.add(l.path);
    for (const parent of ancestors(l.path)) if (paths.has(parent)) prefixes.add(parent);
    if (l.to !== null) {
      if ((await entryAt(join(dir, l.path))).kind === "dir") prefixes.add(l.path);
      if (parentFile !== null) prefixes.add(parentFile);
    }
  }
  // review N4: the reason covers every landing path under the swapped prefix.
  for (const l of landing) {
    if (reasons.has(l.path)) continue;
    if ([...prefixes].some((prefix) => l.path === prefix || l.path.startsWith(`${prefix}/`))) reasons.set(l.path, "type-change");
  }
  // case-clash (on every file system, plan builder's decision: NFC then toLowerCase): an added path whose name folds to
  // another landing path's, or to a differently spelt entry of its parent directory in the folder (each segment).
  const folded = new Map<string, string[]>();
  for (const l of landing) folded.set(fold(l.path), [...(folded.get(fold(l.path)) ?? []), nfc(l.path)]);
  for (const l of landing) {
    if (reasons.has(l.path) || l.from !== null || l.to === null) continue;
    if ((folded.get(fold(l.path)) ?? []).some((other) => other !== nfc(l.path))) { reasons.set(l.path, "case-clash"); continue; }
    const segments = l.path.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      let names: string[];
      try { names = await readdir(join(dir, ...segments.slice(0, i))); } catch { break; }
      if (names.some((name) => fold(name) === fold(segments[i]!) && nfc(name) !== nfc(segments[i]!))) { reasons.set(l.path, "case-clash"); break; }
    }
  }
  return reasons;
}

/** §8.3: every landing path of `from → to` classified, in this order: unwritable; at-to; at-from; changed. */
export async function classifyLandingPaths(ws: DirWorkspace, from: string, to: string): Promise<Classification> {
  return classifyLanding(ws.frozen.dir, await landingPaths(ws, from, to));
}

async function classifyLanding(dir: string, landing: LandingPath[]): Promise<Classification> {
  const reasons = await unwritableOf(dir, landing);
  const out: Classification = { landing, atFrom: [], atTo: [], changed: [], unwritable: [] };
  for (const l of landing) {
    const reason = reasons.get(l.path);
    if (reason !== undefined) { out.unwritable.push({ path: l.path, reason }); continue; }
    const entry = await entryAt(join(dir, l.path));
    if (await equalsSide(entry, l.to)) out.atTo.push(l.path);
    else if (await equalsSide(entry, l.from)) out.atFrom.push(l);
    else out.changed.push(l.path);
  }
  return out;
}

/** §8.4: what placement journals before it creates a name in the folder (folder-relative paths). */
export interface PlacementJournal {
  tmp(path: string, name: string): void;
  aside(path: string, name: string): void;
  dir(rel: string): void;
}
export type PlaceResult = { kind: "written" } | { kind: "changed"; residue: string | null };

/** §8.4 (review C2): a new file's mode from its vault mode. */
const newFileMode = (mode: string): number => (mode === "100755" ? 0o755 : 0o644);
/** §8.4: a changed file keeps its permission bits; the executable state follows `to`. */
const keptMode = (mode: number, to: string): number => (to === "100755" ? mode | ((mode & 0o444) >> 2) : mode & ~0o111);
const siblingOf = (path: string): string => posix.join(posix.dirname(path), `.orca-${randomBytes(4).toString("hex")}`);

async function removeIfThere(abs: string): Promise<void> {
  try { await unlink(abs); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** §8.4: the new version `t`, journaled before it is created (`wx`, 0600), filled, fsynced. */
async function writeTemp(ws: DirWorkspace, change: LandingPath, journal: PlacementJournal, hook: PlacementHook | undefined): Promise<string> {
  const bytes = await vaultGitBytes(ws.vault, ["cat-file", "blob", change.to!.blob]);
  const name = siblingOf(change.path);
  journal.tmp(change.path, name);
  const abs = join(ws.frozen.dir, name);
  const handle = await open(abs, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    const half = Math.floor(bytes.length / 2);
    await handle.write(bytes, 0, half);
    hook?.("tmp-half-written", change.path);
    await handle.write(bytes, half, bytes.length - half);
    await handle.sync();
  } finally { await handle.close(); }
  return abs;
}

/** §8.4 add: the parents an add needs, each journaled before its `mkdir`, then 0755 by chmod. */
async function makeFolderDirs(dir: string, rel: string, journal: PlacementJournal): Promise<void> {
  if (rel === "." || rel === "") return;
  for (const parent of [...ancestors(rel), rel]) {
    if ((await entryAt(join(dir, parent))).kind !== "absent") continue;
    journal.dir(parent);
    try { await mkdir(join(dir, parent)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") continue; throw error; }
    await chmod(join(dir, parent), 0o755);
  }
}

/**
 * §8.4: write one `at-from` path. The person's bytes are never lost: the old entry is moved aside and compared with
 * `from` before anything is put at the path; a different one goes back (or stays aside, named, when the path was
 * re-created meanwhile); the new version is put by `link`, which fails when the path exists again.
 */
export async function placeChange(ws: DirWorkspace, change: LandingPath, journal: PlacementJournal, hook?: PlacementHook): Promise<PlaceResult> {
  const dir = ws.frozen.dir;
  const abs = join(dir, change.path);
  const { from, to } = change;
  if (from !== null && to !== null && from.blob === to.blob) {
    // A mode-only change: re-read, compare, chmod.
    const entry = await entryAt(abs);
    if (entry.kind !== "file" || !(await equalsSide(entry, from))) return { kind: "changed", residue: null };
    await chmod(abs, keptMode(entry.mode, to.mode));
    return { kind: "written" };
  }
  if (from === null) {
    await makeFolderDirs(dir, posix.dirname(change.path), journal);
    const t = await writeTemp(ws, change, journal, hook);
    await chmod(t, newFileMode(to!.mode));
    try { await link(t, abs); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await unlink(t);
      return { kind: "changed", residue: null };
    }
    await unlink(t);
    return { kind: "written" };
  }
  const t = to === null ? null : await writeTemp(ws, change, journal, hook);
  const asideName = siblingOf(change.path);
  journal.aside(change.path, asideName);
  const a = join(dir, asideName);
  hook?.("before-aside", change.path);
  try { await rename(abs, a); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (t !== null) await unlink(t);
    return { kind: "changed", residue: null };
  }
  hook?.("after-aside", change.path);
  const aside = await entryAt(a);
  if (!(await equalsSide(aside, from))) {
    if (t !== null) await unlink(t);
    return { kind: "changed", residue: await putBack(a, abs, asideName) };
  }
  hook?.("before-link", change.path);
  if (t !== null) {
    await chmod(t, keptMode((aside as { mode: number }).mode, to!.mode));
    try { await link(t, abs); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // `a` holds only Orca's last version (it equals `from`, which the vault keeps).
      await unlink(t);
      await unlink(a);
      return { kind: "changed", residue: null };
    }
    hook?.("after-link", change.path);
    await unlink(t);
  }
  await unlink(a);
  return { kind: "written" };
}

/** The person's entry at `a` goes back to `abs` without clobbering; when `abs` exists again it stays aside: its name. */
async function putBack(a: string, abs: string, asideName: string): Promise<string | null> {
  const entry = await entryAt(a);
  if (entry.kind === "file") {
    try { await link(a, abs); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return asideName; throw error; }
    await unlink(a);
    return null;
  }
  if ((await entryAt(abs)).kind !== "absent") return asideName;
  await rename(a, abs);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The pass (§8.5)

/** The refs of one folder of one group (§8.2, §11.1), in the folder's vault. */
export interface FolderPlacementTarget {
  groupId: string;
  frozen: FrozenDirWorkspace;
  /** The work branch whose tip is placed (`refs/heads/orca/<g>`). */
  workBranch: string;
  refs: { placed: string; pending: string; stop: string };
  /** The Orca-own paths besides `.decisions/` (the requirement document), never written into the folder. */
  orcaOwn: readonly string[];
}
/** Updates the placement record from its current stored value (the caller stamps `at` and writes it in one transaction). */
export type SavePlacement = (update: (current: PlacementRecord) => PlacementRecord) => PlacementRecord;
/** §9.2 step 2: another owner's current folder commit in this vault (a dir group's `placed`, a flow run's `head`). */
export interface PlacementOwner { readonly id: string; readonly commit: string }
export interface FolderPlacementIo {
  env: NodeJS.ProcessEnv; save: SavePlacement;
  /** The placement record as stored now. */
  load: () => PlacementRecord;
  /** take-folder's attribution: the other owners in this vault, read on the pass's own vault (`placeDirGroups` gives it). */
  owners?: (ws: DirWorkspace) => Promise<{ dirGroups: PlacementOwner[]; flowRuns: PlacementOwner[] }>;
  hook?: PlacementHook; log?: (line: string) => void;
}

export const placementRefs = (groupId: string) => ({
  placed: `refs/orca/group/${groupId}/placed`, pending: `refs/orca/group/${groupId}/pending`, stop: `refs/orca/group/${groupId}/stop`,
});

export type Prepared =
  | { kind: "done" }
  | { kind: "write"; ws: DirWorkspace; from: string; to: string; tip: string; owed: boolean; classified: Classification; withheld: PlacementRecord["withheld"]; consumed: string | null };

const STOPPED = new Set(["folder-changed", "folder-unwritable"]);
const revParse = async (ws: DirWorkspace, rev: string): Promise<string> => (await vaultGit(ws.vault, ["rev-parse", "--verify", "-q", rev])).trim();

/** "<mode> <blob>" for every path of a commit's tree. */
async function entriesOf(ws: DirWorkspace, commit: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  for (const line of (await vaultGit(ws.vault, ["ls-tree", "-r", "-z", "--full-tree", commit])).split("\0")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [mode, , oid] = line.slice(0, tab).split(" ");
    entries.set(line.slice(tab + 1), `${mode} ${oid}`);
  }
  return entries;
}

/**
 * §8.6: the stat signature of the stopping paths and their parents, with the landed tip it was taken at (so a new
 * landing re-runs the classification as a changed signature does). `lstat` only: no snapshot, no git child. Times and
 * sizes are taken in nanoseconds as strings (canonical JSON holds safe integers only).
 */
async function watchOf(dir: string, landedTip: string | null, paths: readonly string[]): Promise<string> {
  const stat = async (rel: string): Promise<unknown> => {
    try {
      const s = await lstat(join(dir, rel), { bigint: true });
      const kind = s.isSymbolicLink() ? "symlink" : s.isDirectory() ? "dir" : s.isFile() ? "file" : "other";
      return { kind, size: String(s.size), mode: Number(s.mode), ino: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) };
    } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code === "ENOENT" || code === "ENOTDIR") return "absent"; throw error; }
  };
  const list: unknown[] = [];
  for (const path of [...paths].sort(byBytes)) list.push([path, await stat(path), await stat(posix.dirname(path))]);
  return sha256Canonical({ landedTip, paths: list });
}

/** The full stopping lists: the body's when it holds them all, else the stop record's (one git child). */
async function stoppingPaths(ws: DirWorkspace | null, env: NodeJS.ProcessEnv, frozen: FrozenDirWorkspace, record: PlacementRecord): Promise<string[]> {
  if (record.changedTotal <= record.changed.length && record.unwritableTotal <= record.unwritable.length) return [...record.changed, ...record.unwritable.map((u) => u.path)];
  const open = ws ?? await openDirWorkspace(env, frozen);
  const full = JSON.parse(await vaultGit(open.vault, ["cat-file", "blob", record.stopRecord!])) as { changed: string[]; unwritable: Array<{ path: string }> };
  return [...full.changed, ...full.unwritable.map((u) => u.path)];
}

const cleanStop = (): Pick<PlacementRecord, "changed" | "changedTotal" | "unwritable" | "unwritableTotal" | "watch" | "stopRecord"> =>
  ({ changed: [], changedTotal: 0, unwritable: [], unwritableTotal: 0, watch: null, stopRecord: null });

/**
 * §8.5 step 9: stop. The first STOP_KEPT paths of each list in the body with exact totals; the full canonical lists (with
 * the change's `to` and tip, which a `withhold` needs) in a vault blob under `refs.stop`; the watch signature. A
 * resolution this pass acted on is answered by this stop (a new stop asks again).
 */
async function stop(ws: DirWorkspace, target: FolderPlacementTarget, io: FolderPlacementIo, input: { changed: string[]; unwritable: Array<{ path: string; reason: string }>; to: string; tip: string; consumed: string | null; detail: string | null; patch?: Partial<PlacementRecord> }): Promise<void> {
  const changed = [...input.changed].sort(byBytes), unwritable = [...input.unwritable].sort((a, b) => byBytes(a.path, b.path));
  const blob = (await vaultGit(ws.vault, ["hash-object", "-w", "--stdin"], { input: canonicalBytes({ changed, tip: input.tip, to: input.to, unwritable }) })).trim();
  await vaultGit(ws.vault, ["update-ref", target.refs.stop, blob]);
  // Signed at the landed tip step 2 will compare it with: the stored one.
  const watch = await watchOf(ws.frozen.dir, io.load().landedTip, [...changed, ...unwritable.map((u) => u.path)]);
  io.save((current) => ({
    ...current, ...input.patch,
    state: changed.length > 0 ? "folder-changed" : "folder-unwritable",
    changed: changed.slice(0, STOP_KEPT), changedTotal: changed.length, unwritable: unwritable.slice(0, STOP_KEPT), unwritableTotal: unwritable.length,
    stopRecord: blob, watch, detail: input.detail,
    resolution: current.resolution !== null && current.resolution.id === input.consumed ? null : current.resolution,
  }));
}

/**
 * §8.5 step 3: settle what an earlier attempt journaled. An aside whose path is absent goes back (the person's bytes, or
 * `from` for a modify that had not put its new version yet); one equal to `from` is removed once its path holds something
 * else or the change is a delete; one holding the person's bytes while the path was re-created stays, named. Every
 * temporary is removed. Answers the asides kept.
 */
async function settleJournal(ws: DirWorkspace, pending: NonNullable<PlacementRecord["pending"]>, landing: readonly LandingPath[]): Promise<string[]> {
  const dir = ws.frozen.dir;
  const byPath = new Map(landing.map((l) => [l.path, l]));
  const kept: string[] = [];
  for (const { path, name } of pending.aside) {
    const a = join(dir, name), abs = join(dir, path);
    const entry = await entryAt(a);
    if (entry.kind === "absent") continue;
    const change = byPath.get(path);
    const isFrom = change !== undefined && await equalsSide(entry, change.from);
    if ((await entryAt(abs)).kind === "absent" && (!isFrom || change?.to !== null)) {
      const residue = await putBack(a, abs, name);
      if (residue !== null) kept.push(residue);
    } else if (isFrom) await unlink(a);
    else kept.push(name);
  }
  for (const { name } of pending.tmp) await removeIfThere(join(dir, name));
  return kept;
}

// ---------------------------------------------------------------------------------------------------------------------
// The person's answers (§9.2)

/** §9.2: the full stopping lists and the `to` folder commit they belong to (the stop record's, else the body's). */
async function stopLists(ws: DirWorkspace, record: PlacementRecord): Promise<{ changed: string[]; unwritable: Array<{ path: string; reason: string }>; to: string }> {
  if (record.stopRecord !== null) {
    const full = JSON.parse(await vaultGit(ws.vault, ["cat-file", "blob", record.stopRecord])) as { changed?: unknown; unwritable?: unknown; to?: unknown };
    if (Array.isArray(full.changed) && Array.isArray(full.unwritable) && typeof full.to === "string") {
      return { changed: full.changed as string[], unwritable: full.unwritable as Array<{ path: string; reason: string }>, to: full.to };
    }
  }
  const to = record.pending?.to ?? record.tip;
  if (to === null) throw new ControlError("recovery-blocked", "dir-placement-stop-record-missing");
  return { changed: [...record.changed], unwritable: [...record.unwritable], to };
}

const bodyOfCommit = (ws: DirWorkspace, commit: string): Promise<string> => vaultGit(ws.vault, ["show", "-s", "--format=%B", commit]);
const resolutionTrailer = (id: string): string => `Orca-Resolution: ${id}`;
const carriesTrailer = (body: string, trailer: string): boolean => body.split("\n").some((line) => line.trim() === trailer);

/** §9.2 step 0: the `rev` itself or a first-parent ancestor newer than `floor` carrying this answer's trailer. */
async function adoptedOnBranch(ws: DirWorkspace, rev: string, floor: string | null, trailer: string): Promise<string | null> {
  const revs = (await vaultGit(ws.vault, ["rev-list", "--first-parent", rev, ...(floor === null ? [] : [`^${floor}`])])).split("\n").filter((line) => line.length > 0);
  for (const sha of revs) if (carriesTrailer(await bodyOfCommit(ws, sha), trailer)) return sha;
  return null;
}

async function commitTree(ws: DirWorkspace, tree: string, parent: string, message: string): Promise<string> {
  return (await vaultGit(ws.vault, [...ORCA_IDENTITY, "commit-tree", tree, "-p", parent, "-F", "-"], { input: message })).trim();
}

/** §9.2 step 1: `base`'s tree with these entries set ("<mode> <blob>") or removed (null). Removals go first. */
async function folderEditTree(ws: DirWorkspace, base: string, entries: ReadonlyMap<string, string | null>): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "orca-vault-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    await vaultGit(ws.vault, ["read-tree", base], { env });
    const removals: string[] = [], puts: string[] = [];
    for (const [path, entry] of entries) {
      if (entry === null) removals.push(`0 ${"0".repeat(base.length)}\t${path}`);
      else puts.push(`${entry}\t${path}`);
    }
    if (removals.length + puts.length > 0) {
      await vaultGit(ws.vault, ["update-index", "-z", "--index-info"], { env, input: [...removals, ...puts].map((line) => `${line}\0`).join("") });
    }
    return (await vaultGit(ws.vault, ["write-tree"], { env })).trim();
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** §9.2 step 1: the drift commit is kept (review I4): `refs/orca/group/<g>/drift/<n>`, create-only. */
async function writeDriftRef(ws: DirWorkspace, groupId: string, commit: string): Promise<void> {
  const base = `refs/orca/group/${groupId}/drift/`;
  const used = new Set((await vaultGit(ws.vault, ["for-each-ref", "--format=%(refname)", base])).split("\n").filter((ref) => ref.startsWith(base)).map((ref) => ref.slice(base.length)));
  let n = 1;
  while (used.has(String(n))) n += 1;
  await vaultGit(ws.vault, ["update-ref", `${base}${n}`, commit, ""]);
}

/** §9.2 step 1: exactly the `changed` paths, read directly (no snapshot, so caps and excludes never apply). */
async function takenEntries(ws: DirWorkspace, changed: readonly string[]): Promise<{ entries: Map<string, string | null>; notTaken: string[] }> {
  const entries = new Map<string, string | null>();
  const notTaken: string[] = [];
  for (const path of changed) {
    const entry = await entryAt(join(ws.frozen.dir, path));
    if (entry.kind === "absent") { entries.set(path, null); continue; }
    if (entry.kind !== "file") { notTaken.push(path); continue; }
    const blob = (await vaultGit(ws.vault, ["hash-object", "-w", "--no-filters", "--stdin"], { input: await readFile(entry.path) })).trim();
    entries.set(path, `${(entry.mode & 0o111) !== 0 ? "100755" : "100644"} ${blob}`);
  }
  return { entries, notTaken };
}

/** §9.2 step 2: the blob at `path` in a commit, or null when the commit does not hold the path. */
async function blobAt(ws: DirWorkspace, commit: string, path: string): Promise<string | null> {
  const line = (await vaultGit(ws.vault, ["ls-tree", "-z", commit, "--", path])).split("\0")[0] ?? "";
  const tab = line.indexOf("\t");
  if (tab < 0 || line.slice(tab + 1) !== path) return null;
  return line.slice(0, tab).split(" ")[2] ?? null;
}

interface Attribution { byOwner: Map<string, number>; person: number }

/** §9.2 step 2: a taken file equal to another owner's current entry at that path is theirs; the rest are the person's. */
async function attribute(ws: DirWorkspace, io: FolderPlacementIo, entries: ReadonlyMap<string, string | null>): Promise<Attribution> {
  const owners = await io.owners?.(ws) ?? { dirGroups: [], flowRuns: [] };
  const byOwner = new Map<string, number>();
  let person = 0;
  for (const [path, entry] of entries) {
    const blob = entry === null ? null : entry.split(" ")[1] ?? null;
    let owner: string | null = null;
    if (blob !== null) {
      for (const candidate of [...owners.dirGroups, ...owners.flowRuns]) {
        if (await blobAt(ws, candidate.commit, path) === blob) { owner = candidate.id; break; }
      }
    }
    if (owner === null) person += 1;
    else byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
  }
  return { byOwner, person };
}

const editMessage = (groupId: string, attribution: Attribution, resolutionId: string): string => [
  `orca: folder edit ${groupId}`,
  "",
  ...[...attribution.byOwner.entries()].sort(([a], [b]) => byBytes(a, b)).map(([owner, count]) => `Orca-Placed-By: ${owner} ${count} paths`),
  `Orca-Person-Edit: ${attribution.person} paths`,
  resolutionTrailer(resolutionId),
].join("\n");

const dropRef = async (ws: DirWorkspace, ref: string): Promise<void> => { await vaultGit(ws.vault, ["update-ref", "-d", ref]).catch(() => undefined); };

/**
 * §9.2 `take-folder`: the person's version of exactly the `changed` paths joins the work branch and the folder commit,
 * one `Orca-Resolution` trailer making a replay adopt what an earlier attempt committed. The answer stays on the record
 * (Rule 13); a path that cannot be taken (a symlink, anything not a regular file) stops the group again, named.
 */
async function takeFolder(ws: DirWorkspace, target: FolderPlacementTarget, io: FolderPlacementIo, record: PlacementRecord, resolution: NonNullable<PlacementRecord["resolution"]>): Promise<Prepared> {
  const trailer = resolutionTrailer(resolution.id);
  const lists = await stopLists(ws, record);
  const orcaOwn = new Set(target.orcaOwn);
  let detail: string | null = null;
  if (record.pending !== null) {
    const kept = await settleJournal(ws, record.pending, await landingPaths(ws, record.pending.from, record.pending.to));
    if (kept.length > 0) detail = `kept aside: ${kept.join(", ")}`;
  }
  const placed = await revParse(ws, target.refs.placed);
  const base = record.pending?.to ?? placed;
  const tip = await revParse(ws, target.workBranch);
  let tprime = await adoptedOnBranch(ws, tip, record.tip, trailer);
  let p = carriesTrailer(await bodyOfCommit(ws, placed), trailer) ? placed : null;
  let notTaken: string[] = [];
  if (tprime === null) {
    const changed = [...new Set(lists.changed)].filter((path) => !orcaOwn.has(path)).sort(byBytes);
    const { entries, notTaken: skipped } = await takenEntries(ws, changed);
    notTaken = skipped;
    const taken = [...entries.keys()];
    const drift = await commitTree(ws, await folderEditTree(ws, base, entries), base, "orca: person edit");
    await writeDriftRef(ws, target.groupId, drift);
    const message = editMessage(target.groupId, await attribute(ws, io, entries), resolution.id);
    const folderCommit = p ?? await commitDriftOnto(ws.vault, base, drift, taken, message);
    const tree = await treeWith(ws.vault, tip, drift, taken);
    tprime = await commitTree(ws, tree, tip, message);
    if (!(await compareAndSwap(ws.vault.path, target.workBranch, tprime, tip))) return { kind: "done" };
    io.hook?.("after-tip-cas");
    p = folderCommit;
  } else {
    // Adopted `T′`: its own parent shows the paths it took. A path it did not take is still the person's answer's
    // business (reported again), and a folder commit it never wrote (a crash between the two CASes) is rebuilt from
    // the folder's current bytes.
    const parent = await revParse(ws, `${tprime}^`);
    const taken = new Set((await vaultGit(ws.vault, ["diff-tree", "-r", "-z", "--no-renames", "--name-only", parent, tprime])).split("\0").filter((path) => path.length > 0));
    notTaken = [...new Set(lists.changed)].filter((path) => !orcaOwn.has(path) && !taken.has(path)).sort(byBytes);
    if (p === null) {
      const paths = [...taken].sort(byBytes);
      const { entries } = await takenEntries(ws, paths);
      const drift = await commitTree(ws, await folderEditTree(ws, base, entries), base, "orca: person edit");
      await writeDriftRef(ws, target.groupId, drift);
      const message = editMessage(target.groupId, await attribute(ws, io, entries), resolution.id);
      p = await commitDriftOnto(ws.vault, base, drift, paths, message);
    }
  }
  if (p === null) throw new ControlError("recovery-blocked", "dir-placement-take-missing");
  if (p !== placed) {
    try { await vaultGit(ws.vault, ["update-ref", target.refs.placed, p, placed]); }
    catch { if ((await revParse(ws, target.refs.placed).catch(() => null)) !== p) return { kind: "done" }; }
  }
  io.hook?.("after-take-placed-cas");
  io.save((current) => ({ ...current, ...cleanStop(), tip: tprime, landedTip: tprime, pending: null, state: "idle", detail, resolution: { ...resolution } }));
  await dropRef(ws, target.refs.pending);
  await dropRef(ws, target.refs.stop);
  if (notTaken.length === 0) return { kind: "done" };
  // The paths that could not be taken stay changed; the answer is consumed, so the person is asked again (to withhold
  // them, or to change the folder and recheck).
  await stop(ws, target, io, { changed: notTaken, unwritable: [], to: tprime, tip: tprime, consumed: resolution.id, detail: `not taken: ${notTaken.join(", ")}` });
  return { kind: "done" };
}

/**
 * §9.2 `withhold`: every `changed` and `unwritable` path (whole type-change prefixes) becomes withheld with its `to`
 * entry and the answer's `by`/`at`; the stopped state clears so §8.5 goes on and places the rest. Answers the record.
 */
async function withholdPaths(ws: DirWorkspace, target: FolderPlacementTarget, io: FolderPlacementIo, record: PlacementRecord, resolution: NonNullable<PlacementRecord["resolution"]>): Promise<PlacementRecord> {
  const lists = await stopLists(ws, record);
  const entries = await entriesOf(ws, lists.to);
  let detail: string | null = null;
  if (record.pending !== null) {
    const kept = await settleJournal(ws, record.pending, await landingPaths(ws, record.pending.from, record.pending.to));
    if (kept.length > 0) detail = `kept aside: ${kept.join(", ")}`;
  }
  const unwritable = new Map(lists.unwritable.map((entry) => [entry.path, entry.reason]));
  const added = [...new Set([...lists.changed, ...lists.unwritable.map((entry) => entry.path)])].sort(byBytes).map((path) => ({
    path, reason: unwritable.get(path) ?? "changed", toEntry: entries.get(path) ?? "absent", by: resolution.by, at: resolution.at,
  }));
  const merged = new Map(record.withheld.map((entry) => [entry.path, entry]));
  for (const entry of added) merged.set(entry.path, entry);
  const withheld = [...merged.values()].sort((a, b) => byBytes(a.path, b.path));
  const saved = io.save((current) => ({ ...current, ...cleanStop(), state: "idle", detail, pending: null, resolution: null, withheld }));
  await dropRef(ws, target.refs.pending);
  await dropRef(ws, target.refs.stop);
  return saved;
}

/**
 * §8.5 steps 1–6 for one folder of one group, under the caller's `withDirLock(frozen.dir)`. Answers "done" when nothing
 * is to be written this round (the record is saved as it ended), or the change to write.
 */
export async function prepareFolderPlacement(target: FolderPlacementTarget, record: PlacementRecord, io: FolderPlacementIo): Promise<Prepared> {
  // Step 2 (before any git child): a stopped group stays stopped while nothing it waits on moved.
  // A resolution there now is answered by any stop this pass records (a new stop asks again).
  const consumed = record.resolution?.id ?? null;
  if (STOPPED.has(record.state) && record.resolution === null) {
    const paths = await stoppingPaths(null, io.env, target.frozen, record);
    if (await watchOf(target.frozen.dir, record.landedTip, paths) === record.watch) return { kind: "done" };
  }
  // Step 1.
  const ws = await openDirWorkspace(io.env, target.frozen);
  // §9.2: the person's answer, under the folder lock. take-folder does its own steps and answers; withhold writes the
  // withheld entries and lets §8.5 place the rest; recheck clears the stopped state and starts again from step 1.
  if (record.resolution !== null) {
    const resolution = record.resolution;
    if (resolution.action === "take-folder" && record.state === "folder-changed") return takeFolder(ws, target, io, record, resolution);
    if (resolution.action === "withhold") record = await withholdPaths(ws, target, io, record, resolution);
    else {
      // recheck -- and a take-folder whose state moved (the folder went missing) since the command was recorded.
      record = io.save((current) => ({ ...current, ...cleanStop(), state: "idle", detail: null, resolution: null }));
      await dropRef(ws, target.refs.stop);
    }
  }
  // Step 3: an owed write first.
  if (record.pending !== null) {
    const pending = record.pending;
    const landing = await landingPaths(ws, pending.from, pending.to);
    const kept = await settleJournal(ws, pending, landing);
    io.save((current) => ({ ...current, pending: { ...pending, tmp: [], aside: [] } }));
    const classified = await classifyLanding(ws.frozen.dir, landing);
    const detail = kept.length === 0 ? null : `kept aside: ${kept.join(", ")}`;
    if (classified.changed.length > 0 || classified.unwritable.length > 0) {
      await stop(ws, target, io, { changed: classified.changed, unwritable: classified.unwritable, to: pending.to, tip: pending.tip, consumed, detail });
      return { kind: "done" };
    }
    return { kind: "write", ws, from: pending.from, to: pending.to, tip: pending.tip, owed: true, classified, withheld: record.withheld, consumed };
  }
  // Step 4: git wins over the recorded landed tip.
  // (Also corrects a landing replay that recorded a stale tip.)
  const tip = await revParse(ws, target.workBranch);
  if (tip !== record.landedTip) {
    io.log?.(`orca-driver: placement ${target.groupId}: landedTip ${record.landedTip ?? "null"} corrected to ${tip} (the work branch)`);
    io.save((current) => ({ ...current, landedTip: tip }));
  }
  const idle = (patch: Partial<PlacementRecord>): Prepared => {
    io.save((current) => ({ ...current, ...cleanStop(), state: "idle", detail: null, ...patch }));
    return { kind: "done" };
  };
  if (tip === record.tip) {
    if (record.state === "idle" && record.changed.length === 0 && record.unwritable.length === 0) return { kind: "done" };
    return idle({});
  }
  // Step 5: the next folder commit; Orca-own paths and the withheld paths whose `to` entry is unchanged stay as placed.
  const placed = await revParse(ws, target.refs.placed);
  const tipEntries = await entriesOf(ws, tip);
  const entryAtTip = (path: string): string => tipEntries.get(path) ?? "absent";
  // review N4: a withhold lasts until the path's `to` entry changes; a type-change prefix is withheld, and judged again,
  // as a whole (one changed path under it drops all of it).
  const personal = record.withheld.filter((w) => w.reason !== "orca-own");
  const swapped = personal.filter((w) => w.reason === "type-change").map((w) => w.path);
  const rootOf = (path: string): string => swapped.filter((root) => path === root || path.startsWith(`${root}/`)).sort((a, b) => a.length - b.length)[0] ?? path;
  const dropped = new Set(personal.filter((w) => entryAtTip(w.path) !== w.toEntry).map((w) => (w.reason === "type-change" ? rootOf(w.path) : w.path)));
  const stillWithheld = personal.filter((w) => !dropped.has(w.reason === "type-change" ? rootOf(w.path) : w.path));
  const next = await nextFolderCommit(ws, { groupId: target.groupId, tip, placed, keepFromPlaced: [...target.orcaOwn, ...stillWithheld.map((w) => w.path)] });
  const byPath = new Map(stillWithheld.map((w) => [w.path, w]));
  const withheld = next.differs.map((path) => byPath.get(path) ?? { path, reason: "orca-own", toEntry: entryAtTip(path) });
  const [placedTree, nextTree] = await Promise.all([revParse(ws, `${placed}^{tree}`), revParse(ws, `${next.commit}^{tree}`)]);
  if (placedTree === nextTree) return idle({ tip, withheld });
  // Step 6: classify; anything unwritable or changed stops before any write.
  const classified = await classifyLandingPaths(ws, placed, next.commit);
  io.hook?.("after-classify");
  if (classified.changed.length > 0 || classified.unwritable.length > 0) {
    await stop(ws, target, io, { changed: classified.changed, unwritable: classified.unwritable, to: next.commit, tip, consumed, detail: null, patch: { withheld } });
    return { kind: "done" };
  }
  return { kind: "write", ws, from: placed, to: next.commit, tip, owed: false, classified, withheld, consumed };
}

/** §8.5 steps 7–8 (9 when a path turns out changed while being written) for what prepareFolderPlacement answered. */
export async function writeFolderPlacement(target: FolderPlacementTarget, prepared: Extract<Prepared, { kind: "write" }>, io: FolderPlacementIo): Promise<void> {
  const { ws, from, to, tip } = prepared;
  if (!prepared.owed) {
    // Step 7: the ref first (review I4: F′ stays referenced), then the journal, then the writes.
    await vaultGit(ws.vault, ["update-ref", target.refs.pending, to]);
    io.save((current) => ({ ...current, withheld: prepared.withheld, pending: { from, to, tip, tmp: [], aside: [], dirs: [] } }));
    io.hook?.("after-journal");
  }
  const journalOf = (key: "tmp" | "aside") => (path: string, name: string) => {
    io.save((current) => ({ ...current, pending: { ...current.pending!, [key]: [...current.pending![key], { path, name }] } }));
  };
  const journal: PlacementJournal = {
    tmp: journalOf("tmp"), aside: journalOf("aside"),
    dir: (rel) => { io.save((current) => ({ ...current, pending: { ...current.pending!, dirs: [...current.pending!.dirs, rel] } })); },
  };
  const changed: string[] = [];
  const residue: string[] = [];
  for (const change of prepared.classified.atFrom) {
    const result = await placeChange(ws, change, journal, io.hook);
    if (result.kind === "changed") {
      changed.push(change.path);
      if (result.residue !== null) residue.push(result.residue);
      continue;
    }
    io.hook?.("after-path", change.path);
  }
  const detail = residue.length === 0 ? null : `kept aside: ${residue.join(", ")}`;
  if (changed.length > 0) {
    // Step 9 with `pending` kept: what was written stays (it equals F′, `at-to` next time).
    await stop(ws, target, io, { changed, unwritable: [], to, tip, consumed: prepared.consumed, detail });
    return;
  }
  // Step 8: the swap. `placed` already at `to` is a swap done before a crash.
  try { await vaultGit(ws.vault, ["update-ref", target.refs.placed, to, from]); }
  catch (error) {
    if ((await revParse(ws, target.refs.placed).catch(() => null)) !== to) throw error;
  }
  io.hook?.("after-placed-cas");
  io.save((current) => ({ ...current, ...cleanStop(), tip, pending: null, state: "idle", detail }));
  await vaultGit(ws.vault, ["update-ref", "-d", target.refs.pending]);
  await vaultGit(ws.vault, ["update-ref", "-d", target.refs.stop]).catch(() => undefined);
}

export interface PlacementDeps {
  store: ControlStore; admissionGate?: AdmissionGate;
  /** Dir-requirements spec §6.1 (Rule 17): where the vaults are ($ORCA_VAULT_DIR). */
  env?: NodeJS.ProcessEnv;
  /** Test-only: see DirPlacementCrashPoint. */
  crash?: PlacementHook;
  stopped?: () => boolean;
}

/** A throw from the crash hook, carried past the per-group handler unchanged (as integrationPass.ts). */
class Crashed { constructor(readonly error: unknown) {} }

/** What counts as the record moving (§8.5 step 2, review N8): not the time, the detail, the signature or the journal names. */
const movedPart = (r: PlacementRecord | null): unknown => r === null ? null : ({
  state: r.state, tip: r.tip, landedTip: r.landedTip, pending: r.pending === null ? null : { from: r.pending.from, to: r.pending.to, tip: r.pending.tip },
  changed: r.changed, changedTotal: r.changedTotal, unwritable: r.unwritable, unwritableTotal: r.unwritableTotal, withheld: r.withheld, resolution: r.resolution,
});

function readBody(store: ControlStore, groupId: string): Record<string, unknown> {
  return readGroup(store, groupId) as unknown as Record<string, unknown>;
}

/**
 * §8.5: once per driver round, after the integration pass, each dir group in id order (archived, stopped and reconciling
 * groups wait). Answers whether any placement record moved; a group that stays stopped, `failed` or `folder-missing`
 * is no progress, so a stuck group never makes the driver start rounds by itself.
 */
export async function placeDirGroups(deps: PlacementDeps): Promise<boolean> {
  let moved = false;
  for (const row of deps.store.db.prepare("SELECT id, body FROM groups ORDER BY id").all()) {
    if (deps.stopped?.() === true || deps.admissionGate?.draining === true) break;
    const groupId = String(row.id);
    let frozen: FrozenDirWorkspace | null, before: PlacementRecord | null, orcaOwn: string[];
    try {
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      frozen = dirWorkspaceOf(body);
      if (frozen === null) continue;
      before = readPlacement(body.placement);
      if (before === null || archivedMarkOf(body) !== null) continue;
      const documentPath = (body as { requirement?: { export?: { path?: unknown } } }).requirement?.export?.path;
      orcaOwn = typeof documentPath === "string" ? [documentPath] : [];
    } catch (error) { process.stderr.write(`orca-driver: placement ${groupId}: ${describe(error)}\n`); continue; }
    if (groupStopped(deps.store, groupId) || groupHasReconcilingRun(deps.store, groupId)) continue;
    const load = (): PlacementRecord => readPlacement(readBody(deps.store, groupId).placement)!;
    const save: SavePlacement = (update) => {
      const release = deps.admissionGate?.enter();
      try {
        return deps.store.transaction(() => {
          const body = readBody(deps.store, groupId);
          const current = readPlacement(body.placement);
          if (current === null) throw new ControlError("recovery-blocked", `dir-placement-missing:${groupId}`);
          const next = readPlacement({ ...update(current), at: deps.store.now() })!;
          saveGroup(deps.store, { ...body, placement: next } as never);
          return next;
        });
      } finally { release?.(); }
    };
    const hook: PlacementHook | undefined = deps.crash === undefined ? undefined : (point, path) => {
      try { deps.crash!(point, path); } catch (error) { throw new Crashed(error); }
    };
    const target: FolderPlacementTarget = { groupId, frozen, workBranch: workBranchRef(groupId), refs: placementRefs(groupId), orcaOwn };
    const vaultId = frozen.vaultId;
    try {
      if (deps.env === undefined) throw new Error("orca: a dir group's placement needs the driver's env ($ORCA_VAULT_DIR)");
      // §9.2 step 2: take-folder attributes a taken path to the other owner whose current folder commit holds its blob --
      // another dir group on this vault, or a flow run's head. Read on the pass's vault, once per take.
      const owners = async (ws: DirWorkspace): Promise<{ dirGroups: PlacementOwner[]; flowRuns: PlacementOwner[] }> => {
        const dirGroups: PlacementOwner[] = [];
        for (const other of deps.store.db.prepare("SELECT id, body FROM groups ORDER BY id").all()) {
          const id = String(other.id);
          if (id === groupId) continue;
          let otherFrozen: FrozenDirWorkspace | null = null;
          try { otherFrozen = dirWorkspaceOf(JSON.parse(String(other.body))); } catch { continue; }
          if (otherFrozen === null || otherFrozen.vaultId !== vaultId) continue;
          const commit = (await vaultGit(ws.vault, ["rev-parse", "--verify", "-q", placementRefs(id).placed]).catch(() => "")).trim();
          if (commit.length > 0) dirGroups.push({ id, commit });
        }
        const flowRuns: PlacementOwner[] = [];
        for (const line of (await vaultGit(ws.vault, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/orca/"])).split("\n")) {
          const [name, object] = line.split(" ");
          if (name === undefined || object === undefined) continue;
          const parts = name.split("/");
          if (parts.length === 4 && parts[1] === "orca" && parts[3] === "head") flowRuns.push({ id: parts[2]!, commit: object });
        }
        return { dirGroups, flowRuns };
      };
      const io: FolderPlacementIo = { env: deps.env, save, load, hook, owners, log: (line) => process.stderr.write(`${line}\n`) };
      await withDirLock(frozen.dir, async () => {
        const prepared = await prepareFolderPlacement(target, before!, io);
        if (prepared.kind === "write") await writeFolderPlacement(target, prepared, io);
      });
    } catch (error) {
      if (error instanceof Crashed) throw error.error;
      if (error instanceof ControlError && error.code === "panel-draining") throw error;
      // Step 1's refusal: folder-missing; step 10: anything else is `failed`, tried again next round.
      const missing = error instanceof DirFolderMissing;
      if (!missing) process.stderr.write(`orca-driver: placement ${groupId}: ${describe(error)}\n`);
      save((current) => ({ ...current, state: missing ? "folder-missing" : "failed", detail: missing ? (error as DirFolderMissing).dir : describe(error) }));
    }
    const after = readPlacement(readBody(deps.store, groupId).placement);
    if (JSON.stringify(movedPart(after)) !== JSON.stringify(movedPart(before))) moved = true;
  }
  return moved;
}

function describe(error: unknown): string {
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}
