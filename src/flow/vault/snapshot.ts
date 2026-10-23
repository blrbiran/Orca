/**
 * Flow engine spec §5.2 [IR-I6]: import and drift snapshots of the person's folder, made by code.
 *
 * The folder is listed by git itself (`ls-files -o --exclude-standard` against an empty temporary index, so the vault's
 * `info/exclude`, the folder's own `.gitignore` files and git's rule of never descending into a `.git` all apply), then
 * each entry is looked at with `lstat` and never followed: a symlink is stored as a link (its target text), a regular
 * file as a blob, anything else (fifo, socket, device, a nested repository) is excluded and listed. Files over the
 * per-file cap, or past the per-snapshot cap in path order, are excluded and listed -- never dropped silently. Nothing
 * is written into the folder, and the folder's own `.git` is never read or written.
 *
 * An import commit's parent is the previous import; its number `n` in `refs/orca/import/<n>` is taken by a create-only
 * `update-ref` (compare-and-swap against "absent"), so two runs starting at once never get the same `n`.
 */
import { lstat, mkdtemp, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORCA_IDENTITY } from "../../scheduler/gitExec.js";
import { vaultGit, type Vault } from "./vault.js";

export interface SnapshotCaps { perFileBytes: number; perSnapshotBytes: number }
/** §5.2 defaults (writer's call, settings-overridable): 50 MB per file, 500 MB per snapshot. */
export const DEFAULT_CAPS: SnapshotCaps = { perFileBytes: 50 * 1024 * 1024, perSnapshotBytes: 500 * 1024 * 1024 };
export interface SnapshotTree { tree: string; overCap: string[]; excluded: string[] }

const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** `excludes`: the run's own patterns (its template's `workspace.excludes`), on top of the vault's shared defaults. */
export async function snapshotTree(vault: Vault, dir: string, caps: SnapshotCaps, excludes: readonly string[] = []): Promise<SnapshotTree> {
  const scratch = await mkdtemp(join(tmpdir(), "orca-vault-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    const listed = (await vaultGit(vault, ["ls-files", "-z", "-o", "--exclude-standard", ...excludes.map((pattern) => `--exclude=${pattern}`)], { workTree: dir, env })).split("\0").filter((p) => p.length > 0).sort(byBytes);
    const overCap: string[] = [];
    const excluded: string[] = [];
    const lines: string[] = [];
    const files: string[] = [];
    const fileModes: string[] = [];
    let total = 0;
    for (const rel of listed) {
      // A nested repository is listed as a directory (trailing slash); a newline cannot pass --stdin-paths.
      if (rel.endsWith("/") || rel.includes("\n")) { excluded.push(rel.replace(/\/$/, "")); continue; }
      const stat = await lstat(join(dir, rel));
      if (stat.isSymbolicLink()) {
        const blob = await vaultGit(vault, ["hash-object", "-w", "--stdin"], { input: await readlink(join(dir, rel)) });
        lines.push(`120000 ${blob.trim()}\t${rel}`);
        continue;
      }
      if (!stat.isFile()) { excluded.push(rel); continue; }
      if (stat.size > caps.perFileBytes || total + stat.size > caps.perSnapshotBytes) { overCap.push(rel); continue; }
      total += stat.size;
      files.push(rel);
      fileModes.push((stat.mode & 0o111) !== 0 ? "100755" : "100644");
    }
    // git lists no fifo, socket or device; they are looked for beside what it listed, and named.
    excluded.push(...await specialFiles(dir, listed));
    excluded.sort(byBytes);
    if (files.length > 0) {
      const blobs = (await vaultGit(vault, ["hash-object", "-w", "--no-filters", "--stdin-paths"], { input: files.map((f) => join(dir, f)).join("\n") })).trim().split("\n");
      files.forEach((rel, i) => lines.push(`${fileModes[i]} ${blobs[i]}\t${rel}`));
    }
    await vaultGit(vault, ["update-index", "-z", "--add", "--index-info"], { env, input: lines.map((line) => `${line}\0`).join("") });
    const tree = (await vaultGit(vault, ["write-tree"], { env })).trim();
    return { tree, overCap, excluded };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Entries of the folder's root and of every directory git listed a path in that are neither file, directory nor link. */
async function specialFiles(dir: string, listed: readonly string[]): Promise<string[]> {
  const dirs = new Set([""]);
  for (const rel of listed) for (let at = rel.lastIndexOf("/"); at > 0; at = rel.lastIndexOf("/", at - 1)) dirs.add(rel.slice(0, at));
  const found: string[] = [];
  for (const sub of dirs) {
    let entries;
    try { entries = await readdir(join(dir, sub), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isFile() || entry.isDirectory() || entry.isSymbolicLink()) continue;
      found.push((sub === "" ? entry.name : `${sub}/${entry.name}`).normalize("NFC"));
    }
  }
  return found;
}

export const importRef = (n: number): string => `refs/orca/import/${n}`;
async function readRef(vault: Vault, ref: string): Promise<string | null> {
  try { return (await vaultGit(vault, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])).trim(); }
  catch { return null; }
}
export const baseRef = (flowRunId: string): string => `refs/orca/${flowRunId}/base`;

/** The highest-numbered import, or null in a vault that has none. Never HEAD. */
async function lastImport(vault: Vault): Promise<{ n: number; commit: string } | null> {
  const refs = (await vaultGit(vault, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/orca/import/"])).split("\n").filter((l) => l.length > 0);
  let best: { n: number; commit: string } | null = null;
  for (const line of refs) {
    const [ref, commit] = line.split(" ");
    const n = Number(ref!.slice("refs/orca/import/".length));
    if (Number.isSafeInteger(n) && n > 0 && (best === null || n > best.n)) best = { n, commit: commit! };
  }
  return best;
}

/**
 * Two forms. `flowRunId` is the flow's (unchanged): the base ref `refs/orca/<flowRunId>/base` is derived and an orphan
 * left by a crashed start is replaced. `baseRef` is a dir group's (dir-requirements spec §6.1): the named ref, or none
 * (null), is written create-only and an existing one is answered as it is, never replaced; with `reuseUnchanged` the
 * newest import is answered when its tree is this snapshot's tree. `commit` is what the base ref names when one is
 * given; `n` is the import this call made or reused.
 */
export type ImportOptions = { caps: SnapshotCaps; excludes?: readonly string[] } & ({ flowRunId: string } | { baseRef: string | null; reuseUnchanged?: boolean });

export async function importSnapshot(vault: Vault, dir: string, opts: ImportOptions): Promise<{ commit: string; n: number; overCap: string[]; excluded: string[] }> {
  if ("flowRunId" in opts && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(opts.flowRunId)) throw new Error(`orca: ${JSON.stringify(opts.flowRunId)} is not a flow run id`);
  const snap = await snapshotTree(vault, dir, opts.caps, opts.excludes ?? []);
  const answer = (commit: string, n: number) => ({ commit, n, overCap: snap.overCap, excluded: snap.excluded });
  if ("flowRunId" in opts) {
    // Review M1: a start that crashed after its import and before its run row left this run id's base. Nothing else has
    // the id (the kernel found no run with it), so the ref is that start's: it is replaced by compare-and-swap from the
    // value read, with this snapshot.
    const orphan = await readRef(vault, baseRef(opts.flowRunId));
    const made = await newImport(vault, snap.tree);
    await vaultGit(vault, ["update-ref", baseRef(opts.flowRunId), made.commit, orphan ?? ""]);
    return answer(made.commit, made.n);
  }
  const last = opts.reuseUnchanged === true ? await lastImport(vault) : null;
  const made = last !== null && (await vaultGit(vault, ["rev-parse", `${last.commit}^{tree}`])).trim() === snap.tree ? last : await newImport(vault, snap.tree);
  if (opts.baseRef === null) return answer(made.commit, made.n);
  try { await vaultGit(vault, ["update-ref", opts.baseRef, made.commit, ""]); }
  catch (error) {
    // A group base is never replaced: one already there (a replay, or a racing pass) is the answer.
    const existing = await readRef(vault, opts.baseRef);
    if (existing === null) throw error;
    return answer(existing, made.n);
  }
  return answer(made.commit, made.n);
}

/** A new import commit of `tree` on top of the newest import, numbered by a create-only `update-ref`. */
async function newImport(vault: Vault, tree: string): Promise<{ commit: string; n: number }> {
  for (;;) {
    const previous = await lastImport(vault);
    const commit = (await vaultGit(vault, [...ORCA_IDENTITY, "commit-tree", tree, ...(previous === null ? [] : ["-p", previous.commit]), "-m", "orca: import"])).trim();
    const n = (previous?.n ?? 0) + 1;
    try { await vaultGit(vault, ["update-ref", importRef(n), commit, ""]); }
    catch (error) {
      // Another run took n first: number after it, on top of it. Any other refusal is git's to name.
      if (((await lastImport(vault))?.n ?? 0) >= n) continue;
      throw error;
    }
    return { commit, n };
  }
}
