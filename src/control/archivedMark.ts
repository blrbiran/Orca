import { z } from "zod";
import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";

/**
 * Issue-fixes spec §6.3 (ruling H4): an archived group's body carries `archived: { at, actor }` -- ms since the epoch and
 * the actor of the archive command. Bodies are passthrough; the status enum is not extended.
 * Tester #355 (human ruling 2026-11-19 「同意该方案，同意允许互转」): the same mark is the group's one terminal mark, with
 * `kind: "closed"` on a done group a person or agent closed; a mark without `kind` is archived (no backfill). Both kinds
 * freeze the group alike -- every reader that asks only whether the mark is there treats a closed group as archived.
 */
export const archivedMarkSchema = z.object({ at: z.number().int().nonnegative(), actor: z.string().min(1), kind: z.literal("closed").optional() }).strict();
export type ArchivedMark = z.infer<typeof archivedMarkSchema>;
export type TerminalKind = "archived" | "closed";

/** The mark on a parsed group body, null without one; a mark that does not parse blocks by name instead of reading as either. */
export function archivedMarkOf(body: unknown): ArchivedMark | null {
  if (typeof body !== "object" || body === null || !Object.hasOwn(body, "archived")) return null;
  const parsed = archivedMarkSchema.safeParse((body as { archived: unknown }).archived);
  if (!parsed.success) throw new ControlError("recovery-blocked", "group-archived-invalid");
  return parsed.data;
}

/** Tester #355: which terminal mark a body carries, null without one. */
export function terminalKindOf(body: unknown): TerminalKind | null {
  const mark = archivedMarkOf(body);
  return mark === null ? null : mark.kind ?? "archived";
}

/** Whether the stored group is archived; a group that does not exist is not (its own readers refuse it by name). */
export function isGroupArchived(store: ControlStore, groupId: string): boolean {
  return groupTerminalKind(store, groupId) !== null;
}

/** Tester #355: the stored group's terminal kind, null for a group with no mark or one that does not exist. */
export function groupTerminalKind(store: ControlStore, groupId: string): TerminalKind | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row === undefined ? null : terminalKindOf(JSON.parse(String(row.body)));
}

/**
 * Issue-fixes spec §6.3, tester #355: the ledger's terminal gate. An archived group takes only unarchive-group and
 * close-group (a done one converts to closed); a closed group only unclose-group and archive-group (it converts to
 * archived). Every other group-targeted verb is refused by the mark's own code, null when the verb goes through.
 */
const ADMITTED: Readonly<Record<TerminalKind, readonly string[]>> = {
  archived: ["unarchive-group", "close-group"],
  closed: ["unclose-group", "archive-group"],
};
export function terminalGateRefusal(store: ControlStore, groupId: string, verb: string): "group-archived" | "group-closed" | null {
  const kind = groupTerminalKind(store, groupId);
  if (kind === null || ADMITTED[kind].includes(verb)) return null;
  return kind === "closed" ? "group-closed" : "group-archived";
}
