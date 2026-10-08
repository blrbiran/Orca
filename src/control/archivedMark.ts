import { z } from "zod";
import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";

/**
 * Issue-fixes spec §6.3 (ruling H4): an archived group's body carries `archived: { at, actor }` -- ms since the epoch and
 * the actor of the archive command. Bodies are passthrough; the status enum is not extended.
 */
export const archivedMarkSchema = z.object({ at: z.number().int().nonnegative(), actor: z.string().min(1) }).strict();
export type ArchivedMark = z.infer<typeof archivedMarkSchema>;

/** The mark on a parsed group body, null without one; a mark that does not parse blocks by name instead of reading as either. */
export function archivedMarkOf(body: unknown): ArchivedMark | null {
  if (typeof body !== "object" || body === null || !Object.hasOwn(body, "archived")) return null;
  const parsed = archivedMarkSchema.safeParse((body as { archived: unknown }).archived);
  if (!parsed.success) throw new ControlError("recovery-blocked", "group-archived-invalid");
  return parsed.data;
}

/** Whether the stored group is archived; a group that does not exist is not (its own readers refuse it by name). */
export function isGroupArchived(store: ControlStore, groupId: string): boolean {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row !== undefined && archivedMarkOf(JSON.parse(String(row.body))) !== null;
}
