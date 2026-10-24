/**
 * Dir-requirements spec §2, §5.1, §6.1: a dir group is a control group whose body carries `dirWorkspace = { dir, vaultId }`,
 * frozen when its requirement was opened on a registered `dir` project. These readers are the only code that reads that
 * field; the folder workspace itself is dirWorkspace.ts. This spec stores one object (Rule 2); the multi-dir spec (H7)
 * replaces it with a list and keeps a reader for the single object.
 */
import { z } from "zod";
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

const sha = z.string().regex(/^[0-9a-f]{40,64}$/);
const sibling = z.object({ path: z.string(), name: z.string() }).strict();
/** The body keeps this many stopping paths of each list (plan, builder's decision "full stop list"). */
export const STOP_KEPT = 200;
/**
 * §8.2: a dir group's placement record. Read and written as a plain record (never through the group body here), so the
 * multi-dir spec (H7) can keep one per folder elsewhere. The export makes the first one (§6.4 step 3); placement (§8)
 * moves it.
 */
export const placementSchema = z.object({
  state: z.enum(["idle", "folder-changed", "folder-unwritable", "folder-missing", "failed"]),
  tip: sha.nullable(),
  landedTip: sha.nullable(),
  // §8.4: each journaled sibling name (`.orca-<8 hex>`, folder-relative) with the landing path it belongs to, so the redo
  // can settle it against that path's `from` side (§8.5 step 3). `dirs`: the directories an add created.
  pending: z.object({ from: sha, to: sha, tip: sha, tmp: z.array(sibling), aside: z.array(sibling), dirs: z.array(z.string()) }).strict().nullable(),
  // §9.1, plan builder's decision "full stop list": the first STOP_KEPT of each list, the exact totals, and the vault blob
  // (`refs/orca/group/<g>/stop`) holding the full canonical lists.
  changed: z.array(z.string()), changedTotal: z.number().int().nonnegative(),
  unwritable: z.array(z.object({ path: z.string(), reason: z.string() }).strict()), unwritableTotal: z.number().int().nonnegative(),
  stopRecord: sha.nullable(),
  // §8.5 step 5, §9.2: `toEntry` is the withheld `to` entry, "<mode> <blob>", or "absent".
  withheld: z.array(z.object({ path: z.string(), reason: z.string(), toEntry: z.string() }).strict()),
  watch: z.string().nullable(),
  detail: z.string().nullable(),
  resolution: z.object({ id: z.string(), action: z.enum(["take-folder", "recheck", "withhold"]), by: z.string(), at: z.number() }).strict().nullable(),
  at: z.number(),
}).strict();
export type PlacementRecord = z.infer<typeof placementSchema>;

/** A stored placement record, or null when there is none yet; one that is there but malformed is loud (Rule 12). */
export function readPlacement(value: unknown): PlacementRecord | null {
  if (value === undefined || value === null) return null;
  const parsed = placementSchema.safeParse(value);
  if (!parsed.success) throw new ControlError("recovery-blocked", `dir-placement-invalid:${parsed.error.issues[0]?.path.join(".") ?? "invalid"}`);
  return parsed.data;
}

/** §6.4 step 3: the record the export writes: nothing placed beyond the base, the document commit landed. */
export function initialPlacement(input: { base: string; landedTip: string; at: number }): PlacementRecord {
  return placementSchema.parse({ state: "idle", tip: input.base, landedTip: input.landedTip, pending: null, changed: [], changedTotal: 0, unwritable: [], unwritableTotal: 0, stopRecord: null,
    withheld: [], watch: null, detail: null, resolution: null, at: input.at });
}

/**
 * §6.5: a landing that moved a dir group's work branch records the new tip as `placement.landedTip`, inside the caller's
 * write transaction -- markLanded (D), finishReconcile's landed write (R), recordEmptyResultDecisions's ledger-commit
 * write (E) -- so prerequisiteDone reads it with no git child (§7). Any other group is left as it is. A dir group with no
 * placement record (the export writes the first one) is a broken invariant (Rule 12).
 */
export function recordLandedTip(store: ControlStore, groupId: string, tip: string): void {
  const body = bodyOf(store, groupId) as Record<string, unknown> | null;
  if (body === null || dirWorkspaceOf(body) === null) return;
  const placement = readPlacement(body.placement);
  if (placement === null) throw new ControlError("recovery-blocked", `dir-placement-missing:${groupId}`);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, placement: { ...placement, landedTip: tip } }), groupId);
}
