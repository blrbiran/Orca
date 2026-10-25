/**
 * Multi-directory projects spec §4.3, §5.2-§5.3: a multi-dir project's members, and the frozen list an open group keeps.
 *
 * The runtime map is the registry's answer by control repo id (`addMulti`/`setMultiDirs` fill it); a multi id is known and
 * has no single path. `freezeMultiDir` is the read `requirement-open` performs: each member's `realpathSync`, a `dir`
 * member's folder frozen as DIR §5.1 freezes one. It creates no vault and imports nothing. The readers below are the only
 * code that reads the body's top-level `multiDir`.
 */
import { realpathSync } from "node:fs";
import { z } from "zod";
import { flowVaultRepoId } from "../flow/groups.js";
import { vaultKeyOf } from "../flow/vault/paths.js";
import type { FrozenDirWorkspace } from "./dirWorkspace.js";
import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";

/** §4.3: a member as the registry knows it. The path is the registered spelling; the frozen list below holds real paths. */
export interface MultiDirTarget { key: string; name: string; repoId: string; kind: "repo" | "dir"; path: string }

/**
 * §4.3: the registry's multi-dir projects by control repo id. Every write and every read copies the list and each member,
 * so a caller's array never aliases the map (an edit after open cannot change a frozen group).
 */
export interface MultiDirProjects {
  add(entry: { repoId: string; dirs: readonly MultiDirTarget[] }): void;
  setDirs(repoId: string, dirs: readonly MultiDirTarget[]): void;
  remove(repoId: string): void;
  has(repoId: string): boolean;
  of(repoId: string): { id: string; dirs: MultiDirTarget[] } | null;
}

export function createMultiDirProjects(): MultiDirProjects {
  const map = new Map<string, { id: string; dirs: MultiDirTarget[] }>();
  const copy = (dirs: readonly MultiDirTarget[]): MultiDirTarget[] => dirs.map((dir) => ({ ...dir }));
  return {
    add(entry) { map.set(entry.repoId, { id: entry.repoId, dirs: copy(entry.dirs) }); },
    setDirs(repoId, dirs) { map.set(repoId, { id: repoId, dirs: copy(dirs) }); },
    remove(repoId) { map.delete(repoId); },
    has(repoId) { return map.has(repoId); },
    of(repoId) {
      const found = map.get(repoId);
      return found === undefined ? null : { id: found.id, dirs: copy(found.dirs) };
    },
  };
}

/** §5.3: a member of the list an open group keeps; `dirs[0]` is the primary. */
export interface FrozenMultiDirTarget { key: string; repoId: string; kind: "repo" | "dir"; dirWorkspace?: FrozenDirWorkspace }
/**
 * §5.3: the body's top-level `multiDir`. `landing` is written at accept (§9.2, a later task); null until then. It is
 * read back as-is so a later writer's value is not dropped by a read-modify-write here.
 */
export interface FrozenMultiDir { project: string; dirs: FrozenMultiDirTarget[]; landing: unknown }

/** §5.2: the registered members of the multi-dir project a repo id names, or null for any other id. */
export type MultiDirProjectOf = (repoId: string) => { dirs: readonly MultiDirTarget[] } | null;

/**
 * §5.3: the list a group freezes at open, in registered order, with each member's real path (NFC): a `dir` member also
 * carries the DIR frozen workspace `{ dir, vaultId }`. A read only -- no vault is opened and nothing is imported.
 */
export function freezeMultiDir(project: string, dirs: readonly { key: string; repoId: string; kind: "repo" | "dir"; path: string }[]): FrozenMultiDir {
  if (dirs.length < 2 || dirs.length > 8) throw new ControlError("multi-dir-invalid", `dirs:${dirs.length}`);
  const keys = new Set<string>();
  const frozen = dirs.map((entry): FrozenMultiDirTarget => {
    if (keys.has(entry.key)) throw new ControlError("multi-dir-invalid", `duplicate:${entry.key}`);
    keys.add(entry.key);
    let real: string;
    try { real = realpathSync(entry.path); }
    catch (error) { throw new ControlError("multi-dir-invalid", `${entry.key}:${entry.path}:${(error as NodeJS.ErrnoException).code ?? String(error)}`); }
    const dir = real.normalize("NFC");
    return entry.kind === "dir"
      ? { key: entry.key, repoId: entry.repoId, kind: "dir", dirWorkspace: { dir, vaultId: vaultKeyOf(dir) } }
      : { key: entry.key, repoId: entry.repoId, kind: "repo" };
  });
  return { project, dirs: frozen, landing: null };
}

const dirWorkspaceSchema = z.object({ dir: z.string().min(1), vaultId: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const targetSchema = z.object({
  key: z.string().min(1), repoId: z.string().min(1), kind: z.enum(["repo", "dir"]), dirWorkspace: dirWorkspaceSchema.optional(),
}).strict().superRefine((target, context) => {
  if (target.kind === "dir" && target.dirWorkspace === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["dirWorkspace"], message: "required for a dir member" });
  if (target.kind === "repo" && target.dirWorkspace !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["dirWorkspace"], message: "forbidden for a repo member" });
});
const multiDirSchema = z.object({
  project: z.string().min(1), dirs: z.array(targetSchema).min(2).max(8), landing: z.unknown().optional(),
}).strict();

/** §5.3: the body's frozen list, or null for any other group. A field that is there but malformed is loud (Rule 12). */
export function multiDirOf(body: unknown): FrozenMultiDir | null {
  const field = (body as { multiDir?: unknown } | null)?.multiDir;
  if (field === undefined) return null;
  const parsed = multiDirSchema.safeParse(field);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ControlError("multi-dir-invalid", `${issue?.path.join(".") ?? "multiDir"}: ${issue?.message ?? "invalid"}`);
  }
  return {
    project: parsed.data.project,
    dirs: parsed.data.dirs.map((target): FrozenMultiDirTarget => target.dirWorkspace === undefined
      ? { key: target.key, repoId: target.repoId, kind: target.kind }
      : { key: target.key, repoId: target.repoId, kind: target.kind, dirWorkspace: { dir: target.dirWorkspace.dir, vaultId: target.dirWorkspace.vaultId } }),
    landing: parsed.data.landing ?? null,
  };
}

function bodyOf(store: ControlStore, groupId: string): unknown {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row === undefined ? null : JSON.parse(String(row.body));
}

export function isMultiGroup(store: ControlStore, groupId: string): boolean {
  return multiDirOf(bodyOf(store, groupId)) !== null;
}

/** §5.3: the repository a member writes: its own repo id for a `repo` member, its folder's vault for a `dir` member. */
export function dirTargetRepoId(store: ControlStore, groupId: string, key: string): string {
  const multi = multiDirOf(bodyOf(store, groupId));
  if (multi === null) throw new ControlError("multi-dir-invalid", `not-multi:${groupId}`);
  const target = multi.dirs.find((dir) => dir.key === key);
  if (target === undefined) throw new ControlError("multi-dir-invalid", `dir:${key}`);
  if (target.kind === "repo") return target.repoId;
  if (target.dirWorkspace === undefined) throw new ControlError("multi-dir-invalid", `dir-workspace:${key}`);
  return flowVaultRepoId(target.dirWorkspace.vaultId);
}

/** §5.3: the repository of the primary (registered first) member. */
export function multiPrimaryRepoId(store: ControlStore, groupId: string): string {
  const multi = multiDirOf(bodyOf(store, groupId));
  if (multi === null || multi.dirs.length === 0) throw new ControlError("multi-dir-invalid", `not-multi:${groupId}`);
  return dirTargetRepoId(store, groupId, multi.dirs[0]!.key);
}
