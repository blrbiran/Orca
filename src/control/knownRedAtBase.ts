/**
 * Pre-existing failures spec 2026-11-18 L4 (#341): the checks Orca already knows were red at exactly this group's base, for
 * the confirm step and `group brief`. Read from the control store only: no command runs and no git process starts (human
 * ruling quoted in the spec: no check is run before a start). Two sources, each command named once:
 *
 * - another group's recorded acceptance on the same repository: a command's exit on its tip, or the full suite's at its
 *   own base (`baseline: ` commands), when that commit is this group's base;
 * - L3's base runs (`base_check_results`) answered for this repository and base.
 *
 * Per command the latest recorded answer wins: a later green cancels an earlier red (review minor 6). "Red" is what L3 calls
 * red: the command ran and exited non-zero other than 126/127 (a timeout or a signal answers nothing).
 *
 * This group's base: the base its first work run recorded; before any work run, only a start point the store already
 * fixes -- a flow child's composition commit, or the accepted tip of the one done group it stacks on. A group that will
 * start at its target's HEAD has no base the store knows before it starts; for it the confirm step alone may read HEAD
 * once, as a prediction (confirmKnownRed, review I-1). `group brief` never starts a process.
 */
import { answeredBaseChecksAt } from "./baseCheckRecord.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { prerequisitesOf, stackBaseOf } from "./groupEdges.js";
import { acceptanceOf } from "./groupAcceptanceRecord.js";
import { isMultiGroup } from "./multiGroup.js";
import { workBranchRef } from "./workspace.js";
import { isDirFlowGroup } from "../flow/groups.js";
import type { ControlStore } from "./store.js";

export interface KnownRedAtBase {
  command: string;
  /** The commit it was red at: this group's base. */
  base: string;
  /** Where Orca learned it: a group's acceptance, or a task's L3 base run. */
  source: "acceptance" | "base-check";
  groupId: string;
  /** base-check: the task whose failed check asked for the base run. */
  taskId?: string;
  /** When it was recorded (the acceptance's or the base run's answer). */
  at: number;
}

const NOT_RUNNABLE = new Set(["126", "127"]);
const BASELINE = "baseline: ";
const isRed = (exit: string): boolean => /^\d+$/.test(exit) && exit !== "0" && !NOT_RUNNABLE.has(exit);

function bodyOf(store: ControlStore, groupId: string): Record<string, unknown> | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return null;
  try { return JSON.parse(String(row.body)) as Record<string, unknown>; } catch { return null; }
}

/**
 * The base the group's first work run recorded (groupBaseCommit's rule, as one row-limited read): the commit; `null` when a
 * run body before it cannot be read (which run came first is then unknown -- review minor 3: no later run's base is taken);
 * `undefined` when no work run has a base yet.
 */
function recordedBaseOf(store: ControlStore, groupId: string): string | null | undefined {
  const row = store.db.prepare(`SELECT b FROM (SELECT rowid AS r, CASE WHEN json_valid(body) THEN
      CASE WHEN json_extract(body,'$.phase')='work' AND json_type(body,'$.drive.base')='text' THEN json_extract(body,'$.drive.base') END ELSE '' END AS b
    FROM runs WHERE group_id=?) WHERE b IS NOT NULL ORDER BY r LIMIT 1`).get(groupId);
  if (row === undefined) return undefined;
  return String(row.b) === "" ? null : String(row.b);
}

/** This group's base as the store knows it (see the module note); null when it does not. One bounded read per source. */
export function knownBaseOf(store: ControlStore, groupId: string): string | null {
  const recorded = recordedBaseOf(store, groupId);
  if (recorded !== undefined) return recorded;
  const start = stackBaseOf(store, groupId);
  if (start === null) return null;
  if (!start.startsWith("refs/")) return start;
  // Stacked on one group: its branch stops moving once it is done, at the tip its acceptance recorded.
  const prefix = workBranchRef("");
  if (!start.startsWith(prefix)) return null;
  const prerequisite = bodyOf(store, start.slice(prefix.length));
  const tip = acceptanceOf(prerequisite)?.tip;
  return prerequisite?.status === "done" && typeof tip === "string" ? tip : null;
}

/** The repository of a group with a single tree; null for a multi-directory, dir or dir-flow group. */
function singleRepoOf(store: ControlStore, groupId: string): string | null {
  if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) return null;
  return groupRepoId(store, groupId);
}

/** One recorded answer for a command at a commit: red or green (a timeout, 126/127 or a signal answers nothing). */
interface Fact { command: string; commit: string; red: boolean; source: KnownRedAtBase["source"]; groupId: string; taskId?: string; at: number }

/**
 * The facts other groups' acceptances on `repoId` recorded at `commit` (every commit when null): per record, each command's
 * last exit there (a red suite is run once more; green on the retry counts as green). `instr` keeps the JSON reads to the
 * rows that name the commit at all (review I-2).
 */
function acceptanceFacts(store: ControlStore, groupId: string, repoId: string, commit: string | null): Fact[] {
  const rows = commit === null
    ? store.db.prepare(`SELECT id FROM groups WHERE id<>? AND instr(body,'"acceptance"') > 0 AND (CASE WHEN json_valid(body) THEN
        json_type(body,'$.acceptance.commands')='array' ELSE 0 END) ORDER BY id`).all(groupId)
    : store.db.prepare(`SELECT id FROM groups WHERE id<>? AND instr(body,?) > 0 AND (CASE WHEN json_valid(body) THEN
        json_extract(body,'$.acceptance.tip')=? OR json_extract(body,'$.acceptance.fullSuite.baseline.tip')=? ELSE 0 END) ORDER BY id`).all(groupId, commit, commit, commit);
  const facts: Fact[] = [];
  for (const row of rows) {
    const other = String(row.id), body = bodyOf(store, other), record = acceptanceOf(body);
    if (record === null || !Array.isArray(record.commands)) continue;
    try { if (groupRepoId(store, other, body) !== repoId) continue; } catch { continue; }
    const last = new Map<string, { commit: string; exit: string }>();
    for (const entry of record.commands) {
      if (typeof entry?.command !== "string" || typeof entry.exit !== "string" || entry.command.startsWith("setup: ")) continue;
      const baseline = entry.command.startsWith(BASELINE);
      const at = baseline ? record.fullSuite?.baseline?.tip : record.tip;
      if (typeof at !== "string" || (commit !== null && at !== commit)) continue;
      last.set(JSON.stringify([at, baseline ? entry.command.slice(BASELINE.length) : entry.command]), { commit: at, exit: entry.exit });
    }
    for (const [key, { commit: at, exit }] of last) {
      if (exit !== "0" && !isRed(exit)) continue;
      facts.push({ command: (JSON.parse(key) as [string, string])[1], commit: at, red: exit !== "0", source: "acceptance", groupId: other, at: record.at });
    }
  }
  return facts;
}

/** Spec L4 at one commit: per command the latest recorded answer wins (review minor 6); the red ones, oldest first. */
function knownRedAt(store: ControlStore, groupId: string, repoId: string, commit: string): KnownRedAtBase[] {
  const facts = [
    ...acceptanceFacts(store, groupId, repoId, commit),
    ...answeredBaseChecksAt(store, repoId, commit).map((row): Fact =>
      ({ command: row.command, commit, red: row.result === "red", source: "base-check", groupId: row.groupId, taskId: row.taskId, at: row.at ?? row.requestedAt })),
  ].sort((a, b) => a.at - b.at);
  const latest = new Map<string, Fact>();
  for (const fact of facts) latest.set(fact.command, fact);
  return [...latest.values()].filter((fact) => fact.red).sort((a, b) => a.at - b.at)
    .map(({ command, source, groupId: from, taskId, at }) => ({ command, base: commit, source, groupId: from, ...(taskId === undefined ? {} : { taskId }), at }));
}

/** Spec L4: what is known red at this group's base, one entry per command, oldest first. */
export function knownRedAtBase(store: ControlStore, groupId: string): KnownRedAtBase[] {
  const repoId = singleRepoOf(store, groupId);
  if (repoId === null) return [];
  const base = knownBaseOf(store, groupId);
  return base === null ? [] : knownRedAt(store, groupId, repoId, base);
}

/**
 * Review I-1 (controller ruling): the repository whose HEAD the confirm step may read (one `git rev-parse`) to predict this
 * group's base -- only when no base is recorded or predicted, the group will start at its target's HEAD (not stacked, not a
 * flow child), every prerequisite is done (HEAD may still move otherwise), and the store already holds a red record for
 * that repository. Null otherwise; DB reads only, so the caller starts nothing when it is null.
 */
export function headPredictionRepo(store: ControlStore, groupId: string): string | null {
  const repoId = singleRepoOf(store, groupId);
  if (repoId === null || recordedBaseOf(store, groupId) !== undefined || stackBaseOf(store, groupId) !== null) return null;
  if (!prerequisitesOf(store, groupId).every((id) => bodyOf(store, id)?.status === "done")) return null;
  if (store.db.prepare("SELECT 1 FROM base_check_results WHERE repo_id=? AND result='red' LIMIT 1").get(repoId) !== undefined) return repoId;
  return acceptanceFacts(store, groupId, repoId, null).some((fact) => fact.red) ? repoId : null;
}

export interface ConfirmKnownRed { knownRedAtBase?: KnownRedAtBase[]; atHead?: { head: string; known: KnownRedAtBase[] } }

/**
 * The confirm step's read: what is known red at this group's base; else, when headPredictionRepo allows it, what is known red
 * at the target's current HEAD, read by `headOf` (one git child; null when it cannot be read). Each key absent when empty.
 */
export async function confirmKnownRed(store: ControlStore, groupId: string, headOf: ((repoId: string) => Promise<string | null>) | null): Promise<ConfirmKnownRed> {
  const known = knownRedAtBase(store, groupId);
  if (known.length > 0) return { knownRedAtBase: known };
  const repoId = headOf === null ? null : headPredictionRepo(store, groupId);
  if (repoId === null || headOf === null) return {};
  const head = await headOf(repoId);
  if (head === null) return {};
  const atHead = knownRedAt(store, groupId, repoId, head);
  return atHead.length === 0 ? {} : { atHead: { head, known: atHead } };
}
