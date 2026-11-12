import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { runEveryCheck, type EveryCheckOutcome } from "./checkCommand.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { acceptanceCommands, runOnScratchTip, type GroupAcceptanceDeps } from "./groupAcceptance.js";
import { landingWatchOf, nextLandingWatch } from "./landingWatchRecord.js";
import { isMultiGroup } from "./multiGroup.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { isLandingWatchPathOf, landingWatchPathOf, revParse, workBranchRef } from "./workspace.js";
import { isDirFlowGroup } from "../flow/groups.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up G §6.2 (#269): a regression a landing introduces mid-group is seen. A pass by code (Rule 5), every driver
 * round right after group acceptance: when a task run landed on `orca/<g>` since the last watch, the union of every task's
 * setup and required checks (acceptance's union, all tasks: plan A3) runs in a scratch worktree at the branch tip, off the
 * round, every check (not first-red), local commands only. A check that was green and is now red is recorded on the group
 * body (`landingWatch`) with the tasks that landed since, and shows in Problems; it never blocks a claim, a landing or
 * acceptance. Single-repo groups only (as acceptance's not-run); once every task is done group acceptance owns the tip.
 * A watch is not aborted when the tip moves under it: it is recorded for the tip it ran on, and the next one names only
 * the later landings.
 */
export interface LandingWatchCheck {
  controller: AbortController; tip: string; coveredRunIds: string[]; landedTaskIds: string[];
  settled: { outcome: EveryCheckOutcome } | { error: unknown } | null; done: Promise<void>;
}

let watchSeq = 0;

/** The group's task runs that landed a commit on its branch, in run order: runId and taskId. */
function landedRuns(store: ControlStore, groupId: string): Array<{ runId: string; taskId: string }> {
  const landed: Array<{ runId: string; taskId: string }> = [];
  for (const row of store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { taskId?: unknown; drive?: { landedCommit?: unknown } };
    if (typeof run.taskId === "string" && typeof run.drive?.landedCommit === "string") landed.push({ runId: String(row.id), taskId: run.taskId });
  }
  return landed;
}

function allTasksDone(store: ControlStore, groupId: string): boolean {
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  return tasks.length > 0 && tasks.every((work) => work.status === "done");
}

/** One round of the pass; answers whether anything was recorded. */
export async function watchLandings(deps: GroupAcceptanceDeps, checks: Map<string, LandingWatchCheck>): Promise<boolean> {
  const { store } = deps;
  let moved = false;
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    if (deps.stopped()) break;
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; }
    try {
      if (await watchGroup(deps, checks, groupId, body)) moved = true;
    } catch (error) {
      process.stderr.write(`orca-driver: group ${groupId}: landing watch: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return moved;
}

async function watchGroup(deps: GroupAcceptanceDeps, checks: Map<string, LandingWatchCheck>, groupId: string, body: Record<string, unknown>): Promise<boolean> {
  const { store } = deps;
  const inFlight = checks.get(groupId);
  if (inFlight !== undefined) {
    if (inFlight.settled === null) return false;
    checks.delete(groupId);
    if ("error" in inFlight.settled) throw inFlight.settled.error;
    const { outcome } = inFlight.settled;
    deps.write(() => {
      const current = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (current === undefined) return;
      const fresh = JSON.parse(String(current.body)) as Record<string, unknown>;
      const { record, turnedRed, turnedGreen } = nextLandingWatch(landingWatchOf(fresh), { tip: inFlight.tip, at: store.now(), coveredRunIds: inFlight.coveredRunIds, landedTaskIds: inFlight.landedTaskIds, outcome });
      fresh.landingWatch = record;
      store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(fresh), groupId);
      recordProjectionChange(store, [groupId]);
      const taskId = inFlight.landedTaskIds[0] ?? null;
      for (const regression of turnedRed) recordActivity(store, { groupId, taskId, kind: "landing-watch", body: { transition: "turned-red", ...regression } });
      for (const command of turnedGreen) recordActivity(store, { groupId, taskId, kind: "landing-watch", body: { transition: "turned-green", command, tip: inFlight.tip, landedTaskIds: inFlight.landedTaskIds } });
    });
    return true;
  }
  if (body.planHash === undefined || isGroupArchived(store, groupId)) return false;
  if (store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) return false;
  if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) return false;
  // Every task done: group acceptance checks the final tip.
  if (allTasksDone(store, groupId)) return false;
  const landed = landedRuns(store, groupId);
  const covered = new Set(landingWatchOf(body)?.coveredRunIds ?? []);
  const later = landed.filter((run) => !covered.has(run.runId));
  if (later.length === 0) return false;
  // A round still running when stop() was called starts nothing stop() could no longer abort.
  if (deps.stopped()) return false;
  const repo = deps.resolveRepository(groupRepoId(store, groupId));
  const tip = await revParse(repo, workBranchRef(groupId));
  const { setup, checks: commands, timeoutMs } = acceptanceCommands(store, groupId, "all");
  const controller = new AbortController();
  const landedTaskIds = [...new Set(later.map((run) => run.taskId))];
  const entry: LandingWatchCheck = { controller, tip, coveredRunIds: landed.map((run) => run.runId), landedTaskIds, settled: null, done: Promise.resolve() };
  // The commands are the group's tasks'; they run as the group's landing watch, with the panel's empty person directory.
  const as = { runId: `landing-watch-${groupId}`, ...(deps.dispatchedPersonDir === undefined ? {} : { personDir: deps.dispatchedPersonDir }) };
  entry.done = runOnScratchTip(deps, repo, landingWatchPathOf(deps.roots, groupId, ++watchSeq), (name) => isLandingWatchPathOf(name, groupId), tip,
    (tree) => runEveryCheck(tree, setup, commands, timeoutMs, as, controller.signal))
    .then((outcome) => { entry.settled = { outcome }; }, (error: unknown) => { entry.settled = { error }; });
  checks.set(groupId, entry);
  return false;
}
