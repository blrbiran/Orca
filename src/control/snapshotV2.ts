import { randomUUID, createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git, gitBytes } from "../scheduler/gitExec.js";
import { archiveFile, readArtifact, writeArtifact, type ArchiveDependencies } from "./archive.js";
import { NO_GC } from "./attemptPin.js";
import { ControlError } from "./errors.js";
import { privateDirectory } from "./paths.js";
import { artifactSchema } from "./schema.js";
import type { ControlStore } from "./store.js";
import type { ArtifactRef } from "./types.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Change-sized runs spec 2026-11-19 §7 (P2; #363 #366): snapshot v2. The attempt is a commit the target repository keeps
 * under Orca's pin `ref`; `bundle` is `git bundle create <base>..<ref>` (null iff the attempt is the base, since git refuses
 * an empty bundle), so it carries only the change and is readable only where `base` is. The refinements are ccloop P1's
 * (its snapshotV2.ts), so a snapshot Orca writes is one ccloop's continuation and recovery readers accept.
 */
const oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const snapshotV2Schema = z.object({
  version: z.literal(2),
  objectFormat: z.enum(["sha1", "sha256"]),
  base: oid,
  attempt: oid,
  tree: oid,
  head: oid,
  ref: z.string().regex(/^refs\/orca\/runs\/run-[A-Za-z0-9-]+$/),
  source: z.enum(["ccloop-published", "ccloop-live", "orca-commit", "base"]),
  bundle: artifactSchema.nullable(),
  missing: z.array(z.string()),
}).strict()
  .refine((snapshot) => (snapshot.bundle === null) === (snapshot.attempt === snapshot.base))
  .refine((snapshot) => [snapshot.base, snapshot.attempt, snapshot.tree, snapshot.head].every((value) => value.length === (snapshot.objectFormat === "sha256" ? 64 : 40)));
export type SnapshotV2 = z.infer<typeof snapshotV2Schema>;
export type SnapshotSource = SnapshotV2["source"];

/** The version a stored snapshot declares, read before either schema; readers dispatch on it (§5.8 last row). */
export function snapshotVersionOf(bytes: Buffer): number | null {
  try { const value = JSON.parse(bytes.toString()) as { version?: unknown }; return typeof value?.version === "number" ? value.version : null; } catch { return null; }
}

export interface SnapshotV2Input {
  runId: string; targetRepo: string; base: string;
  /** The pinned attempt (refs/orca/runs/<runId> must hold it), or null when the run has no attempt (the base is archived). */
  attempt: string | null;
  head: string; source: SnapshotSource;
}

/**
 * §5.4 step 2: one range bundle of the pinned attempt and the v1 missing evidence (submodules; LFS pointers among the
 * changed blobs under 1,024 bytes), then the snapshot artifact. `missing` is the archive's list, appended to, and stored in
 * the snapshot as v1 stores it. Every git command in the target carries NO_GC; the bundle's staging copy goes in `finally`.
 */
export async function captureSnapshotV2(store: ControlStore, input: SnapshotV2Input, missing: string[], deps: ArchiveDependencies = {}): Promise<ArtifactRef> {
  const ref = `refs/orca/runs/${input.runId}`;
  const run = (args: string[]) => git(input.targetRepo, [...QUIET_GIT, ...NO_GC, ...args], { maxBuffer: 256 * 1024 * 1024 });
  const objectFormat = (await run(["rev-parse", "--show-object-format"])).trim() === "sha256" ? "sha256" : "sha1";
  const attempt = input.attempt ?? input.base;
  let bundle: ArtifactRef | null = null;
  if (attempt !== input.base) {
    if ((await run(["rev-parse", "-q", "--verify", ref])).trim() !== attempt) throw new ControlError("snapshot-invalid", "attempt-not-pinned");
    const staging = privateDirectory(join(store.stateDir, "staging"));
    const path = join(staging, `${randomUUID()}.bundle`);
    try {
      await run(["bundle", "create", "-q", path, `${input.base}..${ref}`]);
      bundle = await archiveFile(store, path, deps);
    } finally { await rm(path, { force: true }); }
  }
  for (const entry of (await run(["ls-tree", "-r", "-z", attempt])).split("\0").filter(Boolean)) {
    if (entry.startsWith("160000 ")) missing.push(`submodule:${entry.slice(entry.indexOf("\t") + 1)}`);
  }
  if (attempt !== input.base) {
    const changed = (await run(["diff", "--no-renames", "--name-only", "-z", input.base, attempt])).split("\0").filter(Boolean);
    const blobs: Array<{ path: string; spec: string }> = changed.map((path) => ({ path, spec: `${attempt}:${path}` }));
    if (blobs.length > 0) {
      const checked = (await git(input.targetRepo, [...QUIET_GIT, ...NO_GC, "cat-file", "--batch-check=%(objecttype) %(objectsize)"], { input: blobs.map((blob) => `${blob.spec}\n`).join("") })).split("\n");
      const small = blobs.filter((_, index) => /^blob (\d+)$/.exec(checked[index] ?? "")?.[1] !== undefined && Number(/^blob (\d+)$/.exec(checked[index]!)![1]) < 1024);
      for (const blob of small) {
        const bytes = await gitBytes(input.targetRepo, [...QUIET_GIT, "cat-file", "blob", blob.spec]);
        if (bytes.toString().startsWith("version https://git-lfs.github.com/spec/v1")) missing.push(`lfs-pointer:repo/${blob.path}`);
      }
    }
  }
  const tree = (await run(["rev-parse", `${attempt}^{tree}`])).trim();
  const snapshot = snapshotV2Schema.parse({ version: 2, objectFormat, base: input.base, attempt, tree, head: input.head, ref, source: input.attempt === null ? "base" : input.source, bundle, missing: [...missing] });
  const bytes = Buffer.from(JSON.stringify(snapshot));
  return writeArtifact(store, `snapshot-${createHash("sha256").update(bytes).digest("hex")}`, bytes, deps);
}

/** The header of a git bundle (v2, or v3 with @object-format): its prerequisites and its heads, read in code. */
export function bundleHeader(bytes: Buffer): { prerequisites: string[]; heads: Array<{ oid: string; ref: string }> } | null {
  const end = bytes.indexOf("\n\n");
  if (end < 0) return null;
  const lines = bytes.subarray(0, end).toString("utf8").split("\n");
  const signature = lines.shift();
  if (signature !== "# v2 git bundle" && signature !== "# v3 git bundle") return null;
  const prerequisites: string[] = [], heads: Array<{ oid: string; ref: string }> = [];
  for (const line of lines) {
    if (line.startsWith("@")) { if (signature === "# v3 git bundle") continue; return null; }
    const match = /^(-?)([a-f0-9]{40}|[a-f0-9]{64})(?: (.*))?$/.exec(line);
    if (match === null) return null;
    if (match[1] === "-") prerequisites.push(match[2]!);
    else heads.push({ oid: match[2]!, ref: match[3] ?? "" });
  }
  return { prerequisites, heads };
}

function parseV2(bytes: Buffer): SnapshotV2 {
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString()); } catch { throw new ControlError("snapshot-invalid"); }
  const parsed = snapshotV2Schema.safeParse(raw);
  if (!parsed.success) throw new ControlError("snapshot-invalid");
  return parsed.data;
}

/**
 * §7.2 level 1, for callers with no repository handle (recovery.ts, cleanup.ts, checkpoints.ts): the snapshot parses, holds
 * no missing evidence, and its bundle artifact (sha256-checked by readArtifact) has exactly one prerequisite, the base, and
 * exactly one head, the attempt at the pin.
 */
export async function verifySnapshotArtifacts(store: ControlStore, ref: ArtifactRef): Promise<{ snapshot: SnapshotV2; bundle: Buffer | null }> {
  const snapshot = parseV2(await readArtifact(store, ref));
  if (snapshot.missing.length > 0) throw new ControlError("snapshot-partial");
  if (snapshot.bundle === null) return { snapshot, bundle: null };
  const bundle = await readArtifact(store, snapshot.bundle);
  const header = bundleHeader(bundle);
  if (header === null || header.prerequisites.length !== 1 || header.prerequisites[0] !== snapshot.base
    || header.heads.length !== 1 || header.heads[0]!.oid !== snapshot.attempt || header.heads[0]!.ref !== snapshot.ref) {
    throw new ControlError("snapshot-bundle-heads-mismatch");
  }
  return { snapshot, bundle };
}

/**
 * §7.2 level 2: the artifact level first, then in the target repository: `bundle verify` (a missing base is
 * snapshot-base-unavailable) and `<attempt>^{tree} == tree`, the attempt read from the target if it holds it, otherwise from
 * a temporary bare repository that borrows the target's objects through alternates. It never writes the target: the bundle
 * and the temporary repository live under <stateDir>/staging and go in `finally` (Rule 17, spec §9).
 */
export async function verifySnapshotInRepository(store: ControlStore, ref: ArtifactRef, resolveRepository: () => string): Promise<SnapshotV2> {
  const { snapshot, bundle } = await verifySnapshotArtifacts(store, ref);
  let repo: string;
  try { repo = resolveRepository(); await git(repo, [...QUIET_GIT, "rev-parse", "--git-dir"]); }
  catch { throw new ControlError("snapshot-repository-unavailable"); }
  const has = async (spec: string) => git(repo, [...QUIET_GIT, "cat-file", "-e", spec]).then(() => true, () => false);
  if (!(await has(`${snapshot.base}^{commit}`))) throw new ControlError("snapshot-base-unavailable");
  if (bundle === null) {
    if ((await git(repo, [...QUIET_GIT, "rev-parse", `${snapshot.base}^{tree}`])).trim() !== snapshot.tree) throw new ControlError("snapshot-tree-mismatch");
    return snapshot;
  }
  const scratch = join(privateDirectory(join(store.stateDir, "staging")), `verify-${randomUUID()}`);
  try {
    await mkdir(scratch, { mode: 0o700 });
    const file = join(scratch, "input.bundle");
    await writeFile(file, bundle, { mode: 0o600 });
    try { await git(repo, [...QUIET_GIT, ...NO_GC, "bundle", "verify", "-q", file]); }
    catch { throw new ControlError("snapshot-base-unavailable"); }
    let reader = repo;
    if (!(await has(`${snapshot.attempt}^{commit}`))) {
      const common = (await git(repo, [...QUIET_GIT, "rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
      reader = join(scratch, "alt.git");
      await git(scratch, ["init", "-q", "--bare", `--object-format=${snapshot.objectFormat}`, reader]);
      await writeFile(join(reader, "objects", "info", "alternates"), `${join(common, "objects")}\n`, { mode: 0o600 });
      await git(reader, [...QUIET_GIT, ...NO_GC, "fetch", "-q", "--no-tags", file, snapshot.ref]);
    }
    if ((await git(reader, [...QUIET_GIT, "rev-parse", `${snapshot.attempt}^{tree}`])).trim() !== snapshot.tree) throw new ControlError("snapshot-tree-mismatch");
    return snapshot;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
