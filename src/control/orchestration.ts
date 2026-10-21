import { z } from "zod";
import { isGroupArchived } from "./archivedMark.js";
import { ControlError } from "./errors.js";
import { globalChecksLayerSchema } from "./checks/settingsSchema.js";
import { BUSY_WORK, EXECUTION_WAKE_KINDS, groupExecutionPendingInStore } from "./executionPending.js";
import type { ControlStore } from "./store.js";

/**
 * Kanban and group orchestration spec 2026-10-20 §3.1-§3.2 (goal.md §1.4): confirming a group authorizes it to start; the
 * driver starts it as soon as its prerequisites are done and a slot under the running-group cap is free. Every rule here
 * is code (CLAUDE.md Rule 5). The start itself is an ordinary `start` command the driver sends as `orca-auto` (spec §9a),
 * so it is ledgered, refused and replayed exactly like a person's.
 *
 * A group confirmed before this existed has no row and is never started automatically (no surprise starts on upgrade).
 */
export const ORCHESTRATION_ACTOR = "orca-auto";
export const DEFAULT_MAX_RUNNING_GROUPS = 3;
/** A refusal this many times in a row makes the group needs-you (it keeps being retried at the longest backoff). */
export const PERSISTENT_REFUSALS = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 600_000;

const refusalSchema = z.object({ code: z.string().min(1), detail: z.string().nullable(), count: z.number().int().positive(), at: z.number().int(), nextAt: z.number().int() }).strict();
const groupOrchestrationSchema = z.object({
  mode: z.enum(["run", "hold"]),
  confirmRevision: z.number().int().positive(),
  confirmedAt: z.number().int(),
  /** The command revision of the start that took it (a person's or orca-auto's); null until then. */
  startedRevision: z.number().int().positive().nullable(),
  refusal: refusalSchema.nullable(),
}).strict();
export type GroupOrchestration = z.infer<typeof groupOrchestrationSchema>;

// Protect-acceptance-criteria spec §5: `criteriaReview` is the automatic reviewer's global default; absent is on.
// Failure-cause spec 2026-10-21 §5: `quotaWait` names the agent installations whose quota failures wait and are retried
// instead of going to the person; absent or empty is the default (off for every installation).
// Checks spec 2026-10-22 §4.1: `checks` is the global layer of the check settings (with the optional admin locks).
const settingsSchema = z.object({ maxRunningGroups: z.number().int().min(1).max(64), criteriaReview: z.boolean().optional(), quotaWait: z.array(z.string().min(1).max(200)).max(64).optional(), checks: globalChecksLayerSchema.optional() }).strict();
export type OrchestrationSettings = z.infer<typeof settingsSchema>;

export function readGroupOrchestration(store: ControlStore, groupId: string): GroupOrchestration | null {
  const row = store.db.prepare("SELECT body FROM group_orchestration WHERE group_id=?").get(groupId);
  if (row === undefined) return null;
  const parsed = groupOrchestrationSchema.safeParse(JSON.parse(String(row.body)));
  if (!parsed.success) throw new ControlError("recovery-blocked", `group-orchestration-invalid:${groupId}`);
  return parsed.data;
}

function writeGroupOrchestration(store: ControlStore, groupId: string, body: GroupOrchestration): void {
  store.db.prepare("INSERT INTO group_orchestration(group_id,body) VALUES (?,?) ON CONFLICT(group_id) DO UPDATE SET body=excluded.body")
    .run(groupId, JSON.stringify(groupOrchestrationSchema.parse(body)));
}

/** Confirm's transaction: `hold` is "Confirm only, don't run yet" (spec §3.1); otherwise the group may start on its own. */
export function recordConfirmed(store: ControlStore, groupId: string, mode: "run" | "hold", confirmRevision: number): void {
  writeGroupOrchestration(store, groupId, { mode, confirmRevision, confirmedAt: store.now(), startedRevision: null, refusal: null });
}

/** A start command took the group (in its transaction): nothing starts it again. No row ⇒ nothing to record. */
export function recordStarted(store: ControlStore, groupId: string, startRevision: number): void {
  const current = readGroupOrchestration(store, groupId);
  if (current === null) return;
  writeGroupOrchestration(store, groupId, { ...current, startedRevision: startRevision, refusal: null });
}

/** A refused automatic start: backoff 30 s, 60 s, … up to 10 min; the count says how many in a row. */
export function recordAutoStartRefused(store: ControlStore, groupId: string, code: string, detail: string | null, at: number): void {
  const current = readGroupOrchestration(store, groupId);
  if (current === null) return;
  const count = (current.refusal?.count ?? 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(count - 1, 10), BACKOFF_MAX_MS);
  writeGroupOrchestration(store, groupId, { ...current, refusal: { code, detail, count, at, nextAt: at + delay } });
}

export function orchestrationRevision(store: ControlStore): number {
  const row = store.db.prepare("SELECT revision FROM orchestration_settings WHERE singleton=1").get();
  return row === undefined ? 0 : Number(row.revision);
}

export function readOrchestrationSettings(store: ControlStore): OrchestrationSettings {
  const row = store.db.prepare("SELECT body FROM orchestration_settings WHERE singleton=1").get();
  if (row === undefined) return { maxRunningGroups: DEFAULT_MAX_RUNNING_GROUPS };
  const parsed = settingsSchema.safeParse(JSON.parse(String(row.body)));
  if (!parsed.success) throw new ControlError("recovery-blocked", "orchestration-settings-invalid");
  return parsed.data;
}

/** Inside the command's transaction; the revision is the command's next revision. */
export function writeOrchestrationSettings(store: ControlStore, settings: OrchestrationSettings, revision: number): void {
  store.db.prepare("INSERT INTO orchestration_settings(singleton,revision,body) VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, body=excluded.body")
    .run(revision, JSON.stringify(settingsSchema.parse(settings)));
}

type GroupFacts = { id: string; status: string; debug: boolean };
function groupFacts(store: ControlStore): GroupFacts[] {
  return store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all().flatMap((row) => {
    let body: { status?: unknown; debug?: unknown };
    try { body = JSON.parse(String(row.body)) as typeof body; } catch { return []; } // its own reads name a bad body
    // System debug task spec 2026-10-21 §2: Orca's own debug groups are admitted first too.
    const debug = [body.debug, (body as { systemDebug?: unknown }).systemDebug].some((mark) => typeof mark === "object" && mark !== null);
    return [{ id: String(row.id), status: String(body.status), debug }];
  });
}

/**
 * The groups holding a slot: not archived, and running, in review, or ready and executing (executionPending's three
 * facts: an undelivered start/no-start/resume wake, an active work run, a busy task). One query whatever the number of
 * groups, tasks or runs, so a summary that asks costs the same for every group (controlPollPerformance's bound).
 */
export function runningGroupIds(store: ControlStore): string[] {
  const wakeKinds = [...EXECUTION_WAKE_KINDS].map((kind) => `'${kind}'`).join(","), busy = [...BUSY_WORK].map((status) => `'${status}'`).join(",");
  // CASE json_valid: a body that does not parse holds no slot here (its own reads name it); json_extract would throw.
  const at = (column: string, path: string) => `CASE WHEN json_valid(${column}) THEN json_extract(${column},'${path}') END`;
  return store.db.prepare(`SELECT g.id AS id FROM groups g WHERE ${at("g.body", "$.archived")} IS NULL AND (
    ${at("g.body", "$.status")} IN ('running','review') OR (${at("g.body", "$.status")}='ready' AND (
      EXISTS (SELECT 1 FROM scheduler_wakes w WHERE w.group_id=g.id AND w.delivered=0 AND w.kind IN (${wakeKinds}))
      OR EXISTS (SELECT 1 FROM runs r WHERE r.group_id=g.id AND r.active=1 AND ${at("r.body", "$.phase")}='work')
      OR EXISTS (SELECT 1 FROM work_items i WHERE i.group_id=g.id AND ${at("i.body", "$.kind")}='task' AND ${at("i.body", "$.status")} IN (${busy}))))) ORDER BY g.rowid`)
    .all().map((row) => String(row.id));
}

/**
 * The prerequisites a group still waits on (spec §3.3/§3.4); S3 fills this in. Empty ⇒ none.
 * Exported as a seam so the board and the orchestrator read one answer.
 */
export type PrerequisiteReader = (store: ControlStore, groupId: string) => string[];
const noPrerequisites: PrerequisiteReader = () => [];

export type AutoStartState =
  | { kind: "none" } // no orchestration row: confirmed before this existed, or not confirmed
  | { kind: "held" }
  | { kind: "started" }
  | { kind: "stopped" } // a stop intent or the archive mark keeps it off (pause/stop keep their meaning)
  | { kind: "waiting-prerequisite"; waitingFor: string[] }
  | { kind: "backoff"; refusal: NonNullable<GroupOrchestration["refusal"]> }
  | { kind: "waiting-slot" }
  | { kind: "eligible" };

function hasStopIntent(store: ControlStore, groupId: string): boolean {
  return store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined;
}

/**
 * One group's place in the queue, by code. `slotFree` is decided by the caller over all groups; `executing` is the
 * group's own executionPending when the caller already holds it (a summary reads it over its snapshot).
 */
export function autoStartState(store: ControlStore, group: { id: string; status: string }, now: number, slotFree: boolean, prerequisites: PrerequisiteReader = noPrerequisites, executing?: boolean): AutoStartState {
  const row = readGroupOrchestration(store, group.id);
  if (row === null) return { kind: "none" };
  if (row.startedRevision !== null || group.status !== "ready" || (executing ?? groupExecutionPendingInStore(store, group.id))) return { kind: "started" };
  if (row.mode === "hold") return { kind: "held" };
  if (hasStopIntent(store, group.id) || isGroupArchived(store, group.id)) return { kind: "stopped" };
  const waitingFor = prerequisites(store, group.id);
  if (waitingFor.length > 0) return { kind: "waiting-prerequisite", waitingFor };
  if (row.refusal !== null && row.refusal.nextAt > now) return { kind: "backoff", refusal: row.refusal };
  return slotFree ? { kind: "eligible" } : { kind: "waiting-slot" };
}

/** How many groups hold a slot now, and the cap. */
export function slotUse(store: ControlStore): { running: number; cap: number } {
  return { running: runningGroupIds(store).length, cap: readOrchestrationSettings(store).maxRunningGroups };
}

export interface AutoStartDeps {
  store: ControlStore;
  now: () => number;
  /** Sends a synthesized `start` (the service's start path); answers the command body. */
  start: (command: { schema: "orca-raw-command-v1"; commandId: string; actorId: string; expectedRevision: number; verb: "start"; target: { kind: "group"; groupId: string }; payload: Record<string, never> }) => Promise<unknown>;
  prerequisites?: PrerequisiteReader;
}

/**
 * One pass: start every eligible group while slots are free. Debug groups (a correction's fix) go first so a fix is not
 * starved by ordinary groups (spec §3.2, builder's call: admitted first); then by confirm time. A refusal is recorded
 * with its backoff and the pass moves on to the next group.
 */
export async function autoStartPass(deps: AutoStartDeps): Promise<{ started: string[]; refused: Array<{ groupId: string; code: string }> }> {
  const { store } = deps;
  const prerequisites = deps.prerequisites ?? noPrerequisites;
  const started: string[] = [], refused: Array<{ groupId: string; code: string }> = [];
  const facts = groupFacts(store);
  const candidates = facts
    .map((group) => ({ group, row: readGroupOrchestration(store, group.id) }))
    .filter((entry): entry is { group: GroupFacts; row: GroupOrchestration } => entry.row !== null && entry.row.mode === "run" && entry.row.startedRevision === null)
    .sort((a, b) => Number(b.group.debug) - Number(a.group.debug) || a.row.confirmedAt - b.row.confirmedAt || a.group.id.localeCompare(b.group.id));
  for (const { group } of candidates) {
    const { running, cap } = slotUse(store);
    const state = autoStartState(store, group, deps.now(), running < cap, prerequisites);
    if (state.kind !== "eligible") continue;
    const row = readGroupOrchestration(store, group.id)!;
    const revision = store.db.prepare("SELECT revision FROM groups WHERE id=?").get(group.id);
    if (revision === undefined) continue;
    const attempt = (row.refusal?.count ?? 0) + 1;
    const body = await deps.start({
      schema: "orca-raw-command-v1", commandId: `orca-auto-start-${row.confirmRevision}-${attempt}`, actorId: ORCHESTRATION_ACTOR,
      expectedRevision: Number(revision.revision), verb: "start", target: { kind: "group", groupId: group.id }, payload: {},
    });
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (error === undefined) { started.push(group.id); continue; }
    const code = typeof error.code === "string" ? error.code : "unknown";
    store.transaction(() => recordAutoStartRefused(store, group.id, code, typeof error.message === "string" ? error.message.slice(0, 500) : null, deps.now()));
    refused.push({ groupId: group.id, code });
  }
  return { started, refused };
}

/** The summary's view of it (board card, needs-you): null when the group has no orchestration row. */
export function orchestrationSummary(store: ControlStore, group: { id: string; status: string }, now: number, prerequisites: PrerequisiteReader = noPrerequisites, executing?: boolean):
  { mode: "run" | "hold"; state: Exclude<AutoStartState["kind"], "none" | "eligible"> | "queued"; waitingFor: string[]; refusal: { code: string; count: number; persistent: boolean } | null } | null {
  const row = readGroupOrchestration(store, group.id);
  if (row === null) return null;
  const { running, cap } = slotUse(store);
  const state = autoStartState(store, group, now, running < cap, prerequisites, executing);
  const refusal = row.refusal === null ? null : { code: row.refusal.code, count: row.refusal.count, persistent: row.refusal.count >= PERSISTENT_REFUSALS };
  return {
    mode: row.mode,
    state: state.kind === "none" ? "started" : state.kind === "eligible" ? "queued" : state.kind,
    waitingFor: state.kind === "waiting-prerequisite" ? state.waitingFor : [],
    refusal: state.kind === "started" ? null : refusal,
  };
}
