/**
 * Dir-requirements spec §2, §5.1, §6.1: a dir group is a control group whose body carries `dirWorkspace = { dir, vaultId }`,
 * frozen when its requirement was opened on a registered `dir` project. These readers are the only code that reads that
 * field; the folder workspace itself is dirWorkspace.ts. This spec stores one object (Rule 2); the multi-dir spec (H7)
 * replaces it with a list and keeps a reader for the single object.
 */
import { flowGroupRepoId, flowVaultRepoId } from "../flow/groups.js";
import type { FrozenDirWorkspace } from "./dirWorkspace.js";
import { ControlError } from "./errors.js";
import { readGroup } from "./queries.js";
import type { ControlStore } from "./store.js";

/** §5.1: the registered `dir` project a repo id names (its folder as the projects file gives it), or null. Built by the panel. */
export type DirProjectOf = (repoId: string) => { path: string } | null;

/** The body's frozen dir workspace, or null for any other group. A field that is there but malformed is loud (Rule 12). */
export function dirWorkspaceOf(body: unknown): FrozenDirWorkspace | null {
  const field = (body as { dirWorkspace?: unknown } | null)?.dirWorkspace;
  if (field === undefined) return null;
  const { dir, vaultId } = (field ?? {}) as { dir?: unknown; vaultId?: unknown };
  if (typeof dir !== "string" || dir.length === 0 || typeof vaultId !== "string" || !/^[0-9a-f]{64}$/.test(vaultId)) {
    throw new ControlError("recovery-blocked", "dir-workspace-invalid");
  }
  return { dir, vaultId };
}

function bodyOf(store: ControlStore, groupId: string): unknown {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row === undefined ? null : JSON.parse(String(row.body));
}

export function isDirGroup(store: ControlStore, groupId: string): boolean {
  return dirWorkspaceOf(bodyOf(store, groupId)) !== null;
}

/** §6.1: a dir group's target repo id is its folder's vault (`flow-vault-<vaultId>`, resolved by vaultPathOfRepoId); null otherwise. */
export function dirGroupRepoId(store: ControlStore, groupId: string): string | null {
  const frozen = dirWorkspaceOf(bodyOf(store, groupId));
  return frozen === null ? null : flowVaultRepoId(frozen.vaultId);
}

/**
 * The repository a group's driver works in (the target repo id, §2). Moved here from executionDriver.ts, which
 * re-exports it, so requirementCalls.ts can read it without entering the driver's import cycle.
 */
export function groupRepoId(store: ControlStore, groupId: string): string {
  const group = readGroup(store, groupId) as unknown as { plan?: { repoId: string }; requirement?: { repoId: string } };
  // Flow engine spec §6.2: a `dir` flow group (parent or child) targets its run's vault, whatever else it names.
  // Dir-requirements spec §6.1: a dir group (a requirement opened on a `dir` project) targets its folder's vault.
  // N1 plan F16: a clarifying group has no plan yet; its requirement names the repository.
  const repoId = flowGroupRepoId(store, groupId) ?? dirGroupRepoId(store, groupId) ?? group.plan?.repoId ?? group.requirement?.repoId;
  if (repoId === undefined) throw new ControlError("recovery-blocked", `group-repository-missing:${groupId}`);
  return repoId;
}
