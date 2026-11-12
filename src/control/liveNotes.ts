import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import type { WebCommandContext } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import type { ExecutionReport } from "./executionPort.js";
import { recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";
import { mergeUndeliveredNotes } from "./taskHandoffs.js";
import type { CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import { writePrivateFile } from "../service/privateFiles.js";

/**
 * Live notes (spec 2026-11-12 tester follow-up G Part 5): a person or an orchestrating agent adds a note to a task; it
 * waits in the task's queue (the group body's `liveNotes`, present only once a note was sent) and Orca mirrors the queue
 * into the running run's `<sourceDir>/live-notes.json`, which ccloop reads at every phase start and acknowledges (ccloop
 * C3). Nothing reaches a running call (Part 5.3). A note the task never received before it ended is marked undelivered
 * and merged into the task's handoff (Part 5.5, Part 4.5).
 */

export const LIVE_NOTE_MAX_BYTES = 2048;
export const LIVE_NOTE_QUEUE_MAX = 16;
export const LIVE_NOTE_KEEP = 200;
export const LIVE_NOTES_FILE = "live-notes.json";

export interface LiveNoteRecord {
  noteId: string; taskId: string; text: string; at: number; by: string;
  state: "queued" | "delivered" | "undelivered";
  delivered?: { runId: string; phase: "plan" | "execute" | "verify"; attempt: number; at: string };
  endedAt?: number;
  mergedInto?: string | null;
}

export type AddLiveNoteCommand = Extract<RawAuthorityCommandV1, { verb: "add-live-note" }>;
type Delivered = NonNullable<ExecutionReport["liveNotes"]>["delivered"];

export function liveNotesOf(groupBody: unknown): LiveNoteRecord[] {
  const notes = (groupBody as { liveNotes?: unknown } | null)?.liveNotes;
  return Array.isArray(notes) ? notes as LiveNoteRecord[] : [];
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  return JSON.parse(String(row.body)) as Record<string, unknown>;
}

/** Inside the caller's transaction. Keeps at most LIVE_NOTE_KEEP records, dropping the oldest non-queued first. */
function saveNotes(store: ControlStore, groupId: string, notes: LiveNoteRecord[]): void {
  let kept = notes;
  while (kept.length > LIVE_NOTE_KEEP) {
    const index = kept.findIndex((note) => note.state !== "queued");
    if (index < 0) break;
    kept = [...kept.slice(0, index), ...kept.slice(index + 1)];
  }
  const body = groupBody(store, groupId);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, liveNotes: kept }), groupId);
}

function workStatus(store: ControlStore, groupId: string, taskId: string): { kind: string; status: string } | null {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, taskId);
  return row ? JSON.parse(String(row.body)) as { kind: string; status: string } : null;
}
const finished = (status: string): boolean => status === "done" || status === "completed";

/** The command (inside applyWebCommand, as setTaskLabels): queue the note, or refuse it by name. */
export function applyAddLiveNote(store: ControlStore, command: AddLiveNoteCommand, context: WebCommandContext): { status: number; body: CommandSuccessV1 } {
  const groupId = command.target.groupId, taskId = command.target.taskId;
  const work = workStatus(store, groupId, taskId);
  if (work === null || work.kind !== "task") throw new ControlError("work-not-found");
  if (finished(work.status)) throw new ControlError("live-note-task-finished", taskId);
  const notes = liveNotesOf(groupBody(store, groupId));
  if (notes.filter((note) => note.taskId === taskId && note.state === "queued").length >= LIVE_NOTE_QUEUE_MAX) throw new ControlError("live-note-queue-full", taskId);
  saveNotes(store, groupId, [...notes, { noteId: command.commandId, taskId, text: command.payload.text, at: store.now(), by: command.actorId, state: "queued" }]);
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: command.commandId, actorId: command.actorId, verb: command.verb, target: command.target,
    commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq, effectivePayloadHash: context.effectivePayloadHash,
    authorityCommandHash: context.authorityCommandHash, result: { kind: "live-note-queued", noteId: command.commandId, taskId },
  } };
}

/** The bytes Orca writes for a task's queue (ccloop's `orca-live-notes-v1`); null when there is nothing queued. */
function fileBytes(notes: LiveNoteRecord[], taskId: string): string {
  const queued = notes.filter((note) => note.taskId === taskId && note.state === "queued");
  return `${JSON.stringify({ schema: "orca-live-notes-v1", notes: queued.map((note) => ({ id: note.noteId, text: note.text, at: new Date(note.at).toISOString() })) })}\n`;
}

/** The source directory of the task's active, prepared, non-recovery run; null when there is none. */
function activeSourceDir(store: ControlStore, groupId: string, taskId: string): string | null {
  const row = store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId, taskId);
  if (!row) return null;
  const run = JSON.parse(String(row.body)) as { state?: string; mode?: string; recoveryOf?: unknown; drive?: { prepared?: boolean; sourceDir?: string } };
  if (run.mode !== undefined || run.recoveryOf !== undefined || run.drive?.prepared !== true || typeof run.drive.sourceDir !== "string") return null;
  if (run.state !== "start-pending" && run.state !== "accepted") return null;
  return run.drive.sourceDir;
}

function readOrNull(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

/**
 * Mirrors the task's queue into `<sourceDir>/live-notes.json` (0600, atomically replaced). Without `sourceDir` it uses
 * the task's active prepared run, if any. A run with nothing queued and no file gets no file. Answers whether it wrote.
 */
export function writeRunLiveNotes(store: ControlStore, groupId: string, taskId: string, sourceDir?: string): boolean {
  const dir = sourceDir ?? activeSourceDir(store, groupId, taskId);
  if (dir === null) return false;
  const notes = liveNotesOf(groupBody(store, groupId));
  const path = join(dir, LIVE_NOTES_FILE);
  const bytes = fileBytes(notes, taskId), current = readOrNull(path);
  if (current === bytes) return false;
  if (current === null && !notes.some((note) => note.taskId === taskId && note.state === "queued")) return false;
  writePrivateFile(path, bytes);
  return true;
}

/**
 * ccloop acknowledged these notes at a phase start (collect's `liveNotes`). Each queued note named there becomes delivered
 * with one `live-note-delivered` row; a note already delivered changes nothing. Inside the caller's transaction.
 */
export function noteLiveNoteDeliveries(store: ControlStore, run: { groupId: string; taskId: string; runId: string }, delivered: Delivered): void {
  const notes = liveNotesOf(groupBody(store, run.groupId));
  let changed = false;
  const next = notes.map((note) => {
    const ack = note.state === "queued" && note.taskId === run.taskId ? delivered.find((entry) => entry.id === note.noteId) : undefined;
    if (ack === undefined) return note;
    changed = true;
    recordActivity(store, { groupId: run.groupId, taskId: run.taskId, runId: run.runId, kind: "live-note-delivered", body: { noteId: note.noteId, phase: ack.phase, attempt: ack.attempt } });
    return { ...note, state: "delivered" as const, delivered: { runId: run.runId, phase: ack.phase, attempt: ack.attempt, at: ack.at } };
  });
  if (changed) saveNotes(store, run.groupId, next);
}

/**
 * The driver-round pass (Rule 5: code decides). Per group with queued notes: (a) the active run's file is rewritten when it
 * differs from the queue (a crash between a command's commit and its file write); (b) a queued note whose task is done or
 * completed, or whose group is archived, is merged into the task's handoff (Part 4.5), then marked undelivered with one
 * `live-note-undelivered` row. Answers the groups whose records it changed. `write` runs its action in a projection
 * transaction (the driver's write).
 */
export function settleLiveNotes(store: ControlStore, write: <T>(action: () => T) => T): string[] {
  const changedGroups: string[] = [];
  const rows = store.db.prepare("SELECT id, body FROM groups WHERE json_extract(body, '$.liveNotes') IS NOT NULL ORDER BY id").all();
  for (const row of rows) {
    const groupId = String(row.id);
    const queued = liveNotesOf(JSON.parse(String(row.body))).filter((note) => note.state === "queued");
    if (queued.length === 0) continue;
    const archived = isGroupArchived(store, groupId);
    const ending = queued.filter((note) => archived || finished(workStatus(store, groupId, note.taskId)?.status ?? ""));
    const merged = new Map<string, string | null>();
    for (const taskId of new Set(ending.map((note) => note.taskId))) {
      merged.set(taskId, mergeUndeliveredNotes(store.stateDir, groupId, taskId, ending.filter((note) => note.taskId === taskId).map(({ noteId, text, at }) => ({ noteId, text, at }))));
    }
    for (const taskId of new Set(queued.filter((note) => !ending.includes(note)).map((note) => note.taskId))) writeRunLiveNotes(store, groupId, taskId);
    if (ending.length === 0) continue;
    const endingIds = new Set(ending.map((note) => note.noteId));
    write(() => {
      const now = store.now();
      const next = liveNotesOf(groupBody(store, groupId)).map((note) => {
        if (note.state !== "queued" || !endingIds.has(note.noteId)) return note;
        recordActivity(store, { groupId, taskId: note.taskId, runId: null, kind: "live-note-undelivered", body: { noteId: note.noteId } });
        return { ...note, state: "undelivered" as const, endedAt: now, mergedInto: merged.get(note.taskId) ?? null };
      });
      saveNotes(store, groupId, next);
      recordProjectionChange(store, [groupId]);
    });
    changedGroups.push(groupId);
  }
  return changedGroups;
}
