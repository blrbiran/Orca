/**
 * Pre-existing failures spec 2026-11-18 L4 (#341): the checks Orca already knows were red at exactly this group's base, for
 * the confirm step and `group brief`. Read from the control store only: no command runs and no git process starts (human
 * ruling quoted in the spec: no check is run before a start). Two sources, each command named once:
 *
 * - an earlier group's recorded acceptance on the same repository: a command that exited red on its tip, or the full suite
 *   red at its own base (`baseline: ` commands), when that commit is this group's base;
 * - L3's base runs (`base_check_results`) answered red for this repository and base.
 *
 * "Red" is what L3 calls red: the command ran and exited non-zero other than 126/127 (a timeout or a signal says nothing).
 *
 * This group's base: the base its first work run recorded; before any work run, only a start point the store already
 * fixes -- a flow child's composition commit, or the accepted tip of the one done group it stacks on. A group that will
 * start at its target's HEAD has no base the store knows before it starts (reading HEAD would start git), so it shows
 * nothing at confirm.
 */
import { redBaseChecksAt } from "./baseCheckRecord.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { stackBaseOf } from "./groupEdges.js";
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

/** This group's base as the store knows it (see the module note); null when it does not. One bounded read per source. */
export function knownBaseOf(store: ControlStore, groupId: string): string | null {
  // groupBaseCommit's rule (the first work run with a base, in creation order), as one row-limited read.
  const recorded = store.db.prepare(`SELECT b FROM (SELECT rowid AS r, CASE WHEN json_valid(body) THEN
      CASE WHEN json_extract(body,'$.phase')='work' AND json_type(body,'$.drive.base')='text' THEN json_extract(body,'$.drive.base') END END AS b
    FROM runs WHERE group_id=?) WHERE b IS NOT NULL ORDER BY r LIMIT 1`).get(groupId);
  if (recorded !== undefined) return String(recorded.b);
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

/** The repository and base this group's line is about; null for a group with no single tree or no known base. */
function scopeOf(store: ControlStore, groupId: string): { repoId: string; base: string } | null {
  if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) return null;
  const base = knownBaseOf(store, groupId);
  return base === null ? null : { repoId: groupRepoId(store, groupId), base };
}

/** Each command red at another group's acceptance commit equal to `base`, with that record's time. */
function fromAcceptances(store: ControlStore, groupId: string, repoId: string, base: string): KnownRedAtBase[] {
  const rows = store.db.prepare(`SELECT id FROM groups WHERE id<>? AND (CASE WHEN json_valid(body) THEN
      json_extract(body,'$.acceptance.tip')=? OR json_extract(body,'$.acceptance.fullSuite.baseline.tip')=? ELSE 0 END) ORDER BY id`).all(groupId, base, base);
  const found: KnownRedAtBase[] = [];
  for (const row of rows) {
    const other = String(row.id), body = bodyOf(store, other), record = acceptanceOf(body);
    if (record === null || !Array.isArray(record.commands)) continue;
    try { if (groupRepoId(store, other, body) !== repoId) continue; } catch { continue; }
    // The last exit of each command at `base` (a red suite is run once more; green on the retry is flaky, not red).
    const last = new Map<string, string>();
    for (const entry of record.commands) {
      if (typeof entry?.command !== "string" || typeof entry.exit !== "string" || entry.command.startsWith("setup: ")) continue;
      const baseline = entry.command.startsWith(BASELINE);
      const at = baseline ? record.fullSuite?.baseline?.tip : record.tip;
      if (at === base) last.set(baseline ? entry.command.slice(BASELINE.length) : entry.command, entry.exit);
    }
    for (const [command, exit] of last) if (isRed(exit)) found.push({ command, base, source: "acceptance", groupId: other, at: record.at });
  }
  return found;
}

/** Spec L4: what is known red at this group's base, one entry per command (the earliest record), oldest first. */
export function knownRedAtBase(store: ControlStore, groupId: string): KnownRedAtBase[] {
  const scope = scopeOf(store, groupId);
  if (scope === null) return [];
  const all = [
    ...fromAcceptances(store, groupId, scope.repoId, scope.base),
    ...redBaseChecksAt(store, scope.repoId, scope.base).map((row): KnownRedAtBase =>
      ({ command: row.command, base: row.base, source: "base-check", groupId: row.groupId, taskId: row.taskId, at: row.at ?? row.requestedAt })),
  ].sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  return all.filter((entry) => !seen.has(entry.command) && (seen.add(entry.command), true));
}
