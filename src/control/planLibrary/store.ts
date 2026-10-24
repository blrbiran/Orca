/**
 * Scheduled flows and groups spec 2026-10-24 §5.4, §5.6, §12: the plan library's single writer. An entry is inserted
 * once and later only archived; a version row is appended and never changed or deleted -- this module has no function
 * that updates or deletes one (the append-only rule lives here, as the flow journal's lives in src/flow/store.ts). Reads
 * of a version recompute its sha256 (`plan-library-hash-mismatch`: a restored or hand-edited DB never imports silently).
 */
import { createHash } from "node:crypto";
import { ControlError } from "../errors.js";
import type { ControlStore } from "../store.js";

export type LibraryOrigin =
  | { kind: "group"; groupId: string; planHash: string }
  | { kind: "requirement-draft"; groupId: string; draftNo: number; draftHash: string }
  | { kind: "import"; fileName: string; fileSha256: string; format: "orca-plan-v1" | "scheduler-plan-file" };

export interface LibraryEntryBody {
  createdBy: string; createdVia: string; createdAt: number;
  archivedBy?: string; archivedVia?: string; archivedAt?: number;
}
export interface LibraryEntry { id: string; projectId: string; name: string; state: "active" | "archived"; body: LibraryEntryBody }
export interface LibraryVersion { entryId: string; version: number; sha256: string; doc: string; origin: LibraryOrigin; by: string; via: string; at: number }

const entryOf = (row: Record<string, unknown>): LibraryEntry => ({
  id: String(row.id), projectId: String(row.project_id), name: String(row.name),
  state: String(row.state) as LibraryEntry["state"], body: JSON.parse(String(row.body)) as LibraryEntryBody,
});
const versionOf = (row: Record<string, unknown>): LibraryVersion => ({
  entryId: String(row.entry_id), version: Number(row.version), sha256: String(row.sha256), doc: String(row.doc),
  origin: JSON.parse(String(row.origin)) as LibraryOrigin, by: String(row.by), via: String(row.via), at: Number(row.at),
});
const sha256Of = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export function readEntry(store: ControlStore, entryId: string): LibraryEntry | null {
  const row = store.db.prepare("SELECT id,project_id,name,state,body FROM plan_library WHERE id=?").get(entryId);
  return row === undefined ? null : entryOf(row);
}

export function listEntries(store: ControlStore, projectId: string, includeArchived: boolean): LibraryEntry[] {
  return store.db.prepare(`SELECT id,project_id,name,state,body FROM plan_library WHERE project_id=?${includeArchived ? "" : " AND state='active'"} ORDER BY rowid`)
    .all(projectId).map(entryOf);
}

export function listVersions(store: ControlStore, entryId: string): LibraryVersion[] {
  return store.db.prepare('SELECT entry_id,version,sha256,doc,origin,"by",via,at FROM plan_library_versions WHERE entry_id=? ORDER BY version').all(entryId).map(versionOf);
}

/** The newest version's sha256, without reading its (possibly large) document; null when the entry has none. */
export function newestVersionSha(store: ControlStore, entryId: string): string | null {
  const row = store.db.prepare("SELECT sha256 FROM plan_library_versions WHERE entry_id=? ORDER BY version DESC LIMIT 1").get(entryId);
  return row === undefined ? null : String(row.sha256);
}

/** One version by its sha256, its bytes re-hashed; null when the entry has no such version. */
export function readVersion(store: ControlStore, entryId: string, sha256: string): LibraryVersion | null {
  const row = store.db.prepare('SELECT entry_id,version,sha256,doc,origin,"by",via,at FROM plan_library_versions WHERE entry_id=? AND sha256=?').get(entryId, sha256);
  if (row === undefined) return null;
  const version = versionOf(row);
  if (sha256Of(version.doc) !== version.sha256) throw new ControlError("plan-library-hash-mismatch", `${entryId} v${version.version}`);
  return version;
}

/** An entry, new: active, with who made it. */
export function insertEntry(store: ControlStore, entry: { id: string; projectId: string; name: string; by: string; via: string; at: number }): void {
  const body: LibraryEntryBody = { createdBy: entry.by, createdVia: entry.via, createdAt: entry.at };
  store.db.prepare("INSERT INTO plan_library(id,project_id,name,state,body) VALUES (?,?,?,'active',?)").run(entry.id, entry.projectId, entry.name, JSON.stringify(body));
}

/**
 * Appends the next version. The bytes are named by their own sha256 here. A version with the same bytes already in the
 * entry is that version (`appended: false`): the same plan saved twice is one version, not two.
 */
export function appendVersion(store: ControlStore, input: { entryId: string; doc: string; origin: LibraryOrigin; by: string; via: string; at: number }): { version: number; sha256: string; appended: boolean } {
  const sha256 = sha256Of(input.doc);
  const existing = store.db.prepare("SELECT version FROM plan_library_versions WHERE entry_id=? AND sha256=?").get(input.entryId, sha256);
  if (existing !== undefined) return { version: Number(existing.version), sha256, appended: false };
  const next = Number(store.db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM plan_library_versions WHERE entry_id=?").get(input.entryId)!.v) + 1;
  store.db.prepare('INSERT INTO plan_library_versions(entry_id,version,sha256,doc,origin,"by",via,at) VALUES (?,?,?,?,?,?,?,?)')
    .run(input.entryId, next, sha256, input.doc, JSON.stringify(input.origin), input.by, input.via, input.at);
  return { version: next, sha256, appended: true };
}

/**
 * §5.6: the schedules (not removed, enabled or not) whose group start pins this entry. Pure over the `schedules` table;
 * P2's schedule writer and views reuse it.
 */
export function pinningSchedules(store: ControlStore, entryId: string): string[] {
  return store.db.prepare("SELECT id, body FROM schedules WHERE removed=0 ORDER BY id").all()
    .filter((row) => {
      const start = (JSON.parse(String(row.body)) as { start?: { kind?: unknown; entryId?: unknown } }).start;
      return start?.kind === "group" && start.entryId === entryId;
    })
    .map((row) => String(row.id));
}

/** §5.6: hides an entry from lists; refused while any schedule pins it. No unarchive in v1. */
export function archiveEntry(store: ControlStore, entryId: string, who: { by: string; via: string; at: number }): void {
  const entry = readEntry(store, entryId);
  if (entry === null) throw new ControlError("plan-library-entry-not-found", entryId);
  const pinned = pinningSchedules(store, entryId);
  if (pinned.length > 0) throw new ControlError("plan-library-entry-in-use", pinned.join(","));
  if (entry.state === "archived") return;
  const body: LibraryEntryBody = { ...entry.body, archivedBy: who.by, archivedVia: who.via, archivedAt: who.at };
  store.db.prepare("UPDATE plan_library SET state='archived', body=? WHERE id=?").run(JSON.stringify(body), entryId);
}
