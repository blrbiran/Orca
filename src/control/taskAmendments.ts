import { z } from "zod";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { loopRecipeSchema } from "./loopPlans.js";
import { recipeExpandsTo } from "./loopRecipeCheck.js";
import { idSchema, safeInteger } from "./schema.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import type { ControlPlanV1 } from "./webProtocol.js";
import { taskContractSchema } from "../scheduler/planFile.js";

/**
 * Loop plans spec §5.1 (C5; independent review R1). A change to a loop task never rewrites the archived plan: its
 * planHash reaches the proposal, the snapshot, the confirm check and estimate validity. The change is a canonical,
 * hashed amendment record; the work item holds its hash. Every reader of a task's original contract goes through
 * effectivePlanTask, which verifies the record before answering the amended entry.
 *
 * Imports nothing that imports it back: queries.ts, executionSnapshot.ts, webService.ts and controlViews.ts import this.
 */

export const TASK_AMENDMENT_SCHEMA = "orca-task-amendment-v1" as const;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const taskAmendmentSchema = z
  .object({
    schema: z.literal(TASK_AMENDMENT_SCHEMA),
    groupId: idSchema,
    taskId: idSchema,
    loopVersion: safeInteger.positive(),
    // History only: effectivePlanTask does not verify it against the archived or prior contract (final review Minor 6).
    previousContractHash: hashSchema,
    recipe: loopRecipeSchema,
    originalContractHash: hashSchema,
    originalContractCanonicalJson: z.string().min(1),
  })
  .strict();
export type TaskAmendment = z.infer<typeof taskAmendmentSchema>;
export type ArchivedPlanTask = ControlPlanV1["tasks"][number];

/** The two work item fields an amendment is found by; everything else of the work item is its readers' business. */
const workAmendmentStateSchema = z
  .object({ amendmentHash: hashSchema.nullable().optional(), loopVersion: safeInteger.optional() })
  .passthrough();

export function writeTaskAmendment(store: ControlStore, groupId: string, amendment: TaskAmendment): string {
  const record = taskAmendmentSchema.parse(amendment);
  const hash = sha256Canonical(record);
  writeCanonicalRecord(store, groupId, hash, canonicalBytes(record).toString("utf8"));
  return hash;
}

/**
 * A task's work item body, or null when there is no row or it is not JSON. Null reads as "not amended": the reader's own
 * later checks still report a missing or broken work item with their existing details (Drafter finding F11).
 */
export function workBodyOf(store: ControlStore, groupId: string, taskId: string): unknown {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, taskId);
  if (row === undefined) return null;
  try { return JSON.parse(String(row.body)); } catch { return null; }
}

/**
 * The task entry every original-contract reader uses (spec §5.1): the archived entry, or -- when the work item carries an
 * amendmentHash -- that entry with the amendment's recipe and contract, after verifying that the record is the one the
 * hash names (readCanonicalRecord), that it is this group's and this task's at the work item's loopVersion, that its
 * contract hashes to originalContractHash, and that its recipe re-expands to exactly those bytes (the projection's own
 * check, ruling P5). Any failure blocks.
 */
export function effectivePlanTask(store: ControlStore, groupId: string, archived: ArchivedPlanTask, work: unknown): ArchivedPlanTask {
  const detail = `task-amendment-invalid:${archived.taskId}`;
  const invalid = (): never => { throw new ControlError("recovery-blocked", detail); };
  if (typeof work !== "object" || work === null || Array.isArray(work)) return archived;
  const state = workAmendmentStateSchema.safeParse(work);
  if (!state.success) return invalid();
  const amendmentHash = state.data.amendmentHash ?? null;
  if (amendmentHash === null) return archived;
  try {
    // A hand-written task has no recipe to amend (spec §0.1: its contract is never changed).
    if (archived.loop === undefined) return invalid();
    const record = taskAmendmentSchema.parse(JSON.parse(readCanonicalRecord(store, amendmentHash)));
    if (record.groupId !== groupId || record.taskId !== archived.taskId || record.loopVersion !== (state.data.loopVersion ?? 0)) return invalid();
    const contract = taskContractSchema.parse(JSON.parse(record.originalContractCanonicalJson));
    if (sha256Canonical(contract) !== record.originalContractHash) return invalid();
    if (!recipeExpandsTo(archived.taskId, contract.context.repoPath, record.recipe, record.originalContractCanonicalJson)) return invalid();
    return { ...archived, loop: record.recipe, originalContractHash: record.originalContractHash, originalContractCanonicalJson: record.originalContractCanonicalJson };
  } catch (error) {
    if (error instanceof ControlError && error.detail === detail) throw error;
    return invalid();
  }
}
