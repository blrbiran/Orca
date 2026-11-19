import { chmodSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { acceptanceOf, groupBaseCommit } from "./groupAcceptanceRecord.js";
import { prerequisitesOf } from "./groupEdges.js";
import { dirWorkspaceOf } from "./dirGroup.js";
import { multiDirOf } from "./multiGroup.js";
import { ChildTimeout, gitChild, oneLine, refTip, runChild } from "./integrationGit.js";
import { readGroupIntegration, type GroupIntegration } from "./integrationScheme.js";
import { workBranchRef } from "./workspace.js";
import type { ControlStore } from "./store.js";

/**
 * Working-tree delivery spec 2026-11-19 §4.4 (#365, #328): a complete, accepted group's change `from..tip` is written
 * into the registered repository's checkout as uncommitted changes. Every path is guarded by "its current entry in the
 * checkout is one Orca can reproduce from git" (`from`'s, a crashed attempt's `pending.tip`'s, or already the tip's);
 * anything else is refused by name and nothing is written. No commit, ref, index entry, stash or config of the person's
 * is written; the files come from `git checkout-index` of a temporary index in `<git-dir>/orca/deliver-<g>/`.
 */
export type WorkingTreeOutcome =
  | { kind: "done"; tip: string; integrated: null }
  | { kind: "blocked"; reason: string }
  | { kind: "transient"; message: string }
  | { kind: "dropped" };

export type WorkingTreeCrashPoint = "wt-before-recheck" | "wt-after-unlink" | "wt-after-rename";

export interface WorkingTreeHooks {
  /** The pass's write-ahead (`pending`); false when the scheme changed meanwhile. */
  recordPending(pending: NonNullable<GroupIntegration["pending"]>): boolean;
  /** The pass's crash hook: a throw here ends the pass as a process death would. */
  crash(point: WorkingTreeCrashPoint): void;
  /** Whether an error is the crash hook's (carried past every catch here unchanged). */
  isCrash(error: unknown): boolean;
  /** Test seams: the device of a path (step 4) and the rename of a staged file (WT-11); real fs calls otherwise. */
  devOf?(path: string): number;
  rename?(from: string, to: string): void;
}

/** The staging directory of a group's delivery, inside the repository's own git directory (spec §7). */
export const stagingOf = (gitDir: string, groupId: string): string => join(gitDir, "orca", `deliver-${groupId}`);

/** A tree entry: git mode and object id; null is absent. */
type Entry = { mode: string; oid: string } | null;
/** What sits at a path in the checkout: an entry, or a directory (which no tip entry matches). */
type Have = Entry | "dir";

const BUSY: ReadonlyArray<[string, string]> = [
  ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"], ["sequencer", "sequencer"], ["BISECT_LOG", "bisect"],
];
const ABSENT_MODE = "000000";
const quietTop = ["--no-optional-locks", "--literal-pathspecs"];

class WriteFailed extends Error { constructor(readonly path: string, readonly code: string) { super(`${path}:${code}`); } }

async function git(repo: string, args: string[], input?: string, env?: Record<string, string>): Promise<string> {
  const answer = env === undefined ? await gitChild(repo, [...quietTop, ...args], input)
    : await runChild("git", [...quietTop, ...args], { cwd: repo, quiet: true, env, ...(input === undefined ? {} : { input }) });
  if (answer.code !== 0) throw new Error(`git ${args[0]}: ${oneLine(answer.stderr) || `exit ${answer.code}`}`);
  return answer.stdout;
}

const lstatOrNull = (path: string): Stats | null => {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return null; throw error; }
};

/**
 * Step 5: relative, non-empty components, no `.` / `..`, no `.git` in any case; a newline cannot pass `--stdin-paths`.
 * U+FFFD (spec §16): git's raw bytes of a path that is not valid UTF-8 decode to it, and that mangled name must never be
 * written; refused by name (a valid path holding U+FFFD itself is refused too -- accepted).
 */
function safePath(path: string): boolean {
  if (path === "" || isAbsolute(path) || path.includes("\n") || path.includes("\0") || path.includes("\uFFFD")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}

/** `git diff --raw -z --no-renames from to`: each path's old and new entry. */
async function rawDiff(repo: string, from: string, to: string): Promise<Map<string, { old: Entry; new: Entry }>> {
  const fields = (await git(repo, ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", from, to])).split("\0");
  const out = new Map<string, { old: Entry; new: Entry }>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [oldMode, newMode, oldOid, newOid] = fields[i]!.replace(/^:/, "").split(" ");
    out.set(fields[i + 1]!, {
      old: oldMode === ABSENT_MODE ? null : { mode: oldMode!, oid: oldOid! },
      new: newMode === ABSENT_MODE ? null : { mode: newMode!, oid: newOid! },
    });
  }
  return out;
}

const sameEntry = (have: Have, entry: Entry, fileMode: boolean, symlinks: boolean): boolean => {
  if (have === "dir") return false;
  if (have === null || entry === null) return have === entry;
  if (have.oid !== entry.oid) return false;
  if (have.mode === entry.mode) return true;
  const regular = (mode: string): boolean => mode === "100644" || mode === "100755";
  // Step 6: with core.fileMode=false the executable bit is not compared (git semantics).
  if (!fileMode && regular(have.mode) && regular(entry.mode)) return true;
  // #400: with core.symlinks=false git writes a 120000 entry as a regular file holding the link target, so that
  // regular file is the entry's own shape -- in either direction, and only while the checkout cannot hold symlinks.
  return !symlinks && (have.mode === "120000" ? regular(entry.mode) : (regular(have.mode) && entry.mode === "120000"));
};

/** Step 6, `have`: from `lstat`, never following a link; regular files hashed with clean filters, as `git status` does. */
async function readHaves(repo: string, paths: readonly string[]): Promise<Map<string, Have>> {
  const haves = new Map<string, Have>();
  const files: string[] = [];
  const modes = new Map<string, string>();
  for (const path of paths) {
    const stat = lstatOrNull(join(repo, path));
    if (stat === null) haves.set(path, null);
    else if (stat.isSymbolicLink()) {
      // `hash-object <path>` would follow the link: the target string is hashed as a blob, without filters.
      const oid = (await git(repo, ["hash-object", "--stdin", "--no-filters"], readlinkSync(join(repo, path)))).trim();
      haves.set(path, { mode: "120000", oid });
    } else if (stat.isDirectory()) haves.set(path, "dir");
    else if (stat.isFile()) { files.push(path); modes.set(path, (stat.mode & 0o100) !== 0 ? "100755" : "100644"); }
    else haves.set(path, { mode: "special", oid: "" });
  }
  if (files.length > 0) {
    const oids = (await git(repo, ["hash-object", "--stdin-paths"], `${files.join("\n")}\n`)).trim().split("\n");
    files.forEach((path, i) => haves.set(path, { mode: modes.get(path)!, oid: oids[i]! }));
  }
  return haves;
}

/** Step 6, leading components: each existing leading directory is a real directory and not a nested repository. */
function leadingUnsafe(repo: string, path: string): boolean {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const dir = join(repo, ...parts.slice(0, i));
    const stat = lstatOrNull(dir);
    if (stat === null) return false;
    if (!stat.isDirectory() || lstatOrNull(join(dir, ".git")) !== null) return true;
  }
  return false;
}

type Judged = { kind: "ok"; done: string[]; writable: string[] } | { kind: "blocked"; reason: string };

/** Step 6, the whole safety rule: every path is done (`have == want`), writable (`have ∈ was`) or a conflict. */
async function judge(repo: string, set: Map<string, { want: Entry; was: Entry[] }>, fileMode: boolean, symlinks: boolean): Promise<Judged> {
  const paths = [...set.keys()];
  for (const path of paths) if (leadingUnsafe(repo, path)) return { kind: "blocked", reason: `integration-working-tree-unsafe-path:${path}` };
  const haves = await readHaves(repo, paths);
  const done: string[] = [], writable: string[] = [], conflicts: string[] = [];
  for (const path of paths) {
    const have = haves.get(path)!, { want, was } = set.get(path)!;
    if (have === "dir") return { kind: "blocked", reason: `integration-working-tree-unsupported:dir:${path}` };
    if (sameEntry(have, want, fileMode, symlinks)) done.push(path);
    else if (was.some((entry) => sameEntry(have, entry, fileMode, symlinks))) writable.push(path);
    else conflicts.push(path);
  }
  if (conflicts.length > 0) {
    const more = conflicts.length > 5 ? `,+${conflicts.length - 5}` : "";
    return { kind: "blocked", reason: `integration-working-tree-conflict:${conflicts.slice(0, 5).join(",")}${more}` };
  }
  return { kind: "ok", done, writable };
}

/**
 * Step 1 (controller ruling I3): each prerequisite this group stacks on (one that does not deliver locally) must have
 * been written into the working tree first -- not yet: not due; any other delivery: blocked by name.
 */
async function prerequisiteGate(store: ControlStore, repo: string, groupId: string): Promise<"go" | "wait" | { blocked: string }> {
  for (const prerequisite of prerequisitesOf(store, groupId)) {
    const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(prerequisite);
    if (row === undefined) continue;
    const body = JSON.parse(String(row.body)) as Record<string, unknown>;
    const record = readGroupIntegration(body);
    if (dirWorkspaceOf(body) !== null || multiDirOf(body) !== null || record?.scheme.delivery === "local") continue;
    if (record?.scheme.delivery !== "working-tree") return { blocked: `integration-working-tree-prerequisite:${prerequisite}` };
    const tip = await refTip(repo, workBranchRef(prerequisite));
    if (tip === null || record.lastIntegrated !== tip || record.pending !== null || record.state !== "idle") return "wait";
  }
  return "go";
}

/**
 * The read side of step 1 (spec §4.4, §4.6 "waiting on a prerequisite"): the first prerequisite this working-tree group
 * stacks on that is itself `working-tree` and not yet written -- from the store alone (a prerequisite's accepted tip
 * stands for `orca/<P>`, which the pass reads from git), so a read never runs git. Null when none, or when this group's
 * own record is not `working-tree`, not idle, or already written (at its accepted tip, when the acceptance names one).
 */
export function workingTreeWaitingFor(store: ControlStore, groupId: string, body: unknown): string | null {
  const own = readGroupIntegration(body);
  if (own?.scheme.delivery !== "working-tree" || own.state !== "idle") return null;
  const ownTip = acceptanceOf(body)?.tip ?? null;
  if (own.lastIntegrated !== null && (ownTip === null || own.lastIntegrated === ownTip) && own.pending === null) return null;
  for (const prerequisite of prerequisitesOf(store, groupId)) {
    const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(prerequisite);
    if (row === undefined) continue;
    const other = JSON.parse(String(row.body)) as Record<string, unknown>;
    const record = readGroupIntegration(other);
    if (dirWorkspaceOf(other) !== null || multiDirOf(other) !== null || record?.scheme.delivery !== "working-tree") continue;
    const tip = acceptanceOf(other)?.tip ?? null;
    // An acceptance that names no tip (not-needed, not-run) leaves "written at least once" as the store's only evidence.
    if (record.lastIntegrated === null || (tip !== null && record.lastIntegrated !== tip) || record.pending !== null || record.state !== "idle") return prerequisite;
  }
  return null;
}

/** The new permission bits of a staged file replacing (or creating) `path` (step 9; controller ruling I8). */
function modeFor(existing: Stats | null, want: string, fileMode: boolean): number {
  const exec = want === "100755";
  if (existing === null || !existing.isFile()) return exec ? 0o755 : 0o644;
  let perm = existing.mode & 0o7777;
  const had = (perm & 0o100) !== 0;
  // Only the group's change of the executable bit is applied (git's rule: x wherever r is); no other bit is touched.
  if (fileMode && had !== exec) perm = exec ? perm | ((perm & 0o444) >> 2) : perm & ~0o111;
  return perm;
}

/** Parents a new file needs, created 0755 explicitly (never from the umask). */
function makeParents(repo: string, path: string): void {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const dir = join(repo, ...parts.slice(0, i));
    if (lstatOrNull(dir) !== null) continue;
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
  }
}

/** Step 10: each parent of a deleted path, up to the checkout root, removed while it is empty (never forced). */
function removeEmptyParents(repo: string, deleted: readonly string[]): void {
  for (const path of deleted) {
    for (let dir = dirname(path); dir !== "." && dir !== ""; dir = dirname(dir)) {
      try { rmdirSync(join(repo, dir)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; break; }
    }
  }
}

/** spec §4.4: the delivery itself. `integration` is the frozen `working-tree` record; `tip` is `orca/<g>`. */
export async function integrateWorkingTree(store: ControlStore, repo: string, groupId: string, integration: GroupIntegration, tip: string, hooks: WorkingTreeHooks): Promise<WorkingTreeOutcome | null> {
  // Step 1.
  const gate = await prerequisiteGate(store, repo, groupId);
  if (gate === "wait") return null;
  if (gate !== "go") return { kind: "blocked", reason: gate.blocked };
  // Step 2: from the last delivered tip, else the group's base; nothing landed settles done with nothing written.
  const pending = integration.pending !== null && integration.pending.schemeHash === integration.schemeHash ? integration.pending : null;
  const from = integration.lastIntegrated ?? groupBaseCommit(store, groupId);
  if (from === null || (from === tip && pending === null)) return { kind: "done", tip, integrated: null };
  // Step 3: a busy checkout is refused; another git running (index.lock) is a backoff.
  const gitDir = resolve(repo, (await git(repo, ["rev-parse", "--git-dir"])).trim());
  for (const [marker, op] of BUSY) if (lstatOrNull(join(gitDir, marker)) !== null) return { kind: "blocked", reason: `integration-working-tree-busy:${op}` };
  if (lstatOrNull(join(gitDir, "index.lock")) !== null) return { kind: "transient", message: "integration-working-tree: index.lock present (another git is running)" };
  // Step 4: the staging directory must be on the checkout's device, or `rename` fails with EXDEV.
  const devOf = hooks.devOf ?? ((path: string) => statSync(path).dev);
  if (devOf(gitDir) !== devOf(repo)) return { kind: "blocked", reason: "integration-working-tree-unsupported:cross-device" };
  // The staging parent must be Orca's own directory, never a link elsewhere (#365 review): `rmSync` / `mkdirSync` below
  // would follow a symlinked `<git-dir>/orca` and remove or write another directory's `deliver-<g>`.
  const stagingParent = join(gitDir, "orca");
  const parentStat = lstatOrNull(stagingParent);
  if (parentStat !== null && !parentStat.isDirectory()) {
    return { kind: "blocked", reason: `integration-working-tree-write-failed:${relative(repo, stagingParent)}:not-a-directory:written 0` };
  }
  const staging = stagingOf(gitDir, groupId);
  const written: string[] = [];
  let at = "-";
  try {
    // Step 5: the paths, validated. Steps 5-6 read the checkout and run git; a failure there (a required clean filter that
    // fails, a directory the panel may not read) is blocked by name like a write's (#365 review), never a backoff.
    const diff = await rawDiff(repo, from, tip);
    const pendingTip = pending !== null && pending.tip !== tip && pending.tip !== from ? await rawDiff(repo, from, pending.tip) : null;
    const set = new Map<string, { want: Entry; was: Entry[] }>();
    // `was` (review M1): `from`'s entry, and a crashed attempt's `pending.tip`'s.
    for (const [path, entry] of diff) set.set(path, { want: entry.new, was: [entry.old, ...(pendingTip === null ? [] : [pendingTip.has(path) ? pendingTip.get(path)!.new : entry.old])] });
    // #365 review: a path the crashed attempt's tip changed and this tip does not (the tip moved back) may hold that
    // attempt's bytes, which Orca wrote; it is put back to the tip's entry (= `from`'s), else it would stay half-delivered.
    for (const [path, entry] of pendingTip ?? []) if (!set.has(path)) set.set(path, { want: entry.old, was: [entry.new] });
    const lower = new Map<string, string>();
    for (const [path, { want, was }] of set) {
      if (!safePath(path)) return { kind: "blocked", reason: `integration-working-tree-unsafe-path:${path}` };
      if ([want, ...was].some((entry) => entry?.mode === "160000")) return { kind: "blocked", reason: `integration-working-tree-unsupported:gitlink:${path}` };
      const folded = path.toLowerCase();
      if (lower.has(folded)) return { kind: "blocked", reason: `integration-working-tree-unsupported:case-rename:${path}` };
      lower.set(folded, path);
    }
    if (set.size === 0) return { kind: "done", tip, integrated: null };
    const fileMode = (await gitChild(repo, ["config", "--bool", "core.fileMode"])).stdout.trim() !== "false";
    // #400: read the same way -- only an explicit `false` turns symlinks off (unset means git's default, on).
    const symlinks = (await gitChild(repo, ["config", "--bool", "core.symlinks"])).stdout.trim() !== "false";
    // Step 6.
    const first = await judge(repo, set, fileMode, symlinks);
    if (first.kind === "blocked") return first;
    // Step 7: write-ahead.
    if (!hooks.recordPending({ schemeHash: integration.schemeHash, tip, base: from, new: tip })) return { kind: "dropped" };
    // Step 8: stage the writable non-deleted paths through a temporary index (the live index is never touched).
    rmSync(staging, { recursive: true, force: true });
    if (parentStat === null) { mkdirSync(stagingParent, { mode: 0o700 }); chmodSync(stagingParent, 0o700); }
    mkdirSync(staging, { mode: 0o700 });
    chmodSync(staging, 0o700);
    const toWrite = first.writable.filter((path) => set.get(path)!.want !== null);
    const toDelete = first.writable.filter((path) => set.get(path)!.want === null);
    if (toWrite.length > 0) {
      const env = { GIT_INDEX_FILE: join(staging, "index") };
      at = "update-index";
      await git(repo, ["update-index", "-z", "--index-info"], toWrite.map((path) => `${set.get(path)!.want!.mode} ${set.get(path)!.want!.oid}\t${path}\0`).join(""), env);
      at = "checkout-index";
      await git(repo, ["checkout-index", "-z", "--stdin", `--prefix=${join(staging, "tree")}/`], toWrite.map((path) => `${path}\0`).join(""), env);
    }
    // Step 9: every path judged again immediately before the first write (review M10).
    hooks.crash("wt-before-recheck");
    at = "-";
    const again = await judge(repo, set, fileMode, symlinks);
    if (again.kind === "blocked") return again;
    const writeNow = new Set(again.writable);
    for (const path of toDelete) {
      if (!writeNow.has(path)) continue;
      at = path;
      unlinkSync(join(repo, path));
      written.push(path);
      hooks.crash("wt-after-unlink");
    }
    const rename = hooks.rename ?? renameSync;
    for (const path of toWrite) {
      if (!writeNow.has(path)) continue;
      at = path;
      const staged = join(staging, "tree", path), target = join(repo, path);
      const want = set.get(path)!.want!;
      if (want.mode !== "120000") chmodSync(staged, modeFor(lstatOrNull(target), want.mode, fileMode));
      makeParents(repo, path);
      rename(staged, target);
      written.push(path);
      hooks.crash("wt-after-rename");
    }
    // Step 10, on every pass: the emptied parents of every path from..tip deletes.
    at = "-";
    removeEmptyParents(repo, [...set].filter(([, { want }]) => want === null).map(([path]) => path));
    // Step 11.
    const haves = await readHaves(repo, [...set.keys()]);
    for (const [path, { want }] of set) if (!sameEntry(haves.get(path)!, want, fileMode, symlinks)) throw new WriteFailed(path, "not-at-tip");
    return { kind: "done", tip, integrated: null };
  } catch (error) {
    // Errors are caught where they happen (review I9): a disk-full write is blocked by name, never a backoff. Only a
    // timed-out git child (and the crash hook) leave this function.
    if (hooks.isCrash(error) || error instanceof ChildTimeout) throw error;
    const path = error instanceof WriteFailed ? error.path : at;
    const code = error instanceof WriteFailed ? error.code : ((error as NodeJS.ErrnoException).code ?? (at === "update-index" || at === "checkout-index" ? at : "error"));
    const shown = written.slice(0, 5).join(",");
    return { kind: "blocked", reason: `integration-working-tree-write-failed:${path}:${code}:written ${written.length}${shown === "" ? "" : ` (${shown}${written.length > 5 ? ",..." : ""})`}` };
  } finally {
    if (lstatOrNull(staging) !== null) rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * spec §7 (controller ruling Q4): at panel start, before the driver's first round, every `<git-dir>/orca/deliver-*` of
 * every registered repository is removed. A repository whose path does not resolve (gone, permission) is logged and
 * left; the sweep never throws.
 */
export async function sweepWorkingTreeStaging(repoPaths: readonly string[], log: (line: string) => void): Promise<void> {
  for (const repo of repoPaths) {
    try {
      const answer = await gitChild(repo, ["rev-parse", "--git-dir"]);
      if (answer.code !== 0) throw new Error(oneLine(answer.stderr) || `exit ${answer.code}`);
      const dir = join(resolve(repo, answer.stdout.trim()), "orca");
      const stat = lstatOrNull(dir);
      if (stat === null) continue;
      // #365 review: never through a link -- a symlinked `<git-dir>/orca` names another directory's entries.
      if (!stat.isDirectory()) throw new Error(`${dir} is not a directory`);
      for (const name of readdirSync(dir)) if (name.startsWith("deliver-")) rmSync(join(dir, name), { recursive: true, force: true });
    } catch (error) {
      log(`orca-panel: working-tree staging sweep ${repo}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
