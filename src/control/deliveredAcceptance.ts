import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { groupRepoId } from "./dirGroup.js";
import { fullSuiteCommand } from "./fullSuite.js";
import {
  acceptanceCommands, clearGroupFailure, logGroupFailureOnce, nextAcceptancePath, runAcceptance,
  type AcceptanceOutcome, type GroupAcceptanceCheck, type GroupAcceptanceDeps,
} from "./groupAcceptance.js";
import {
  acceptanceOf, acceptanceSatisfied, deliveredAcceptanceOf, deliveredAcceptanceTarget, failedCommandOf, type DeliveredAcceptance,
} from "./groupAcceptanceRecord.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { QUIET_GIT } from "./workspace.js";
import { git } from "../scheduler/gitExec.js";
import type { ControlStore } from "./store.js";

/**
 * Delivery tail spec 2026-11-17 D3 (tester #336 addendum; human ruling 3: 「只在目标上的树和验收过的树不同时才重跑，跑的是已配置
 * 的同一组命令，不额外加全量」 -- the proposal the human approved). A pass by code (Rule 5), each driver round after the
 * integration pass and before the review. For a group whose `local` delivery carried its accepted tip T into the target
 * as a new commit C (deliveredAcceptanceTarget):
 * - no new commit was made for T (the target already held it): `not-needed` / `already-in-target`;
 * - C's tree is T's: `not-needed` / `same-tree`, nothing runs;
 * - otherwise the same union of setup and required checks (and the project's full-suite command when set) runs on C in a
 *   scratch worktree, off the round, exactly as the acceptance runs on T (runAcceptance, no base comparison).
 * Recorded as `deliveredAcceptance` keyed by (T, C), with a `delivered-acceptance` activity row when commands ran. The
 * target is never rewound; a red record keeps the group from done (groupEdges.ts) until a person waives or rechecks it.
 * In-flight checks share the acceptance pass's map under `delivered:<group>`, so the driver's stop() aborts and awaits them.
 */
const keyOf = (groupId: string): string => `delivered:${groupId}`;

export async function acceptDeliveries(deps: GroupAcceptanceDeps, checks: Map<string, GroupAcceptanceCheck>): Promise<boolean> {
  const { store } = deps;
  let moved = false;
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    if (deps.stopped()) break;
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; }
    try {
      if (await acceptDelivery(deps, checks, groupId, body)) moved = true;
      clearGroupFailure(checks, "delivered acceptance", groupId);
    } catch (error) {
      logGroupFailureOnce(checks, "delivered acceptance", groupId, error);
    }
  }
  return moved;
}

function save(store: ControlStore, groupId: string, record: DeliveredAcceptance, activity: boolean): void {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), deliveredAcceptance: record }), groupId);
  recordProjectionChange(store, [groupId]);
  if (activity) recordActivity(store, { groupId, kind: "delivered-acceptance", body: { ...record } });
}

async function acceptDelivery(deps: GroupAcceptanceDeps, checks: Map<string, GroupAcceptanceCheck>, groupId: string, body: Record<string, unknown>): Promise<boolean> {
  const { store } = deps;
  const inFlight = checks.get(keyOf(groupId));
  const target = body.planHash === undefined || isGroupArchived(store, groupId) ? null : deliveredAcceptanceTarget(body);
  const accepted = acceptanceOf(body);
  // The tip's own acceptance must be recorded for T and satisfied, with every task done (review 2026-11-17, finding 1: a
  // `trigger: task` group delivers after each landing; an intermediate delivery is not the group's delivery).
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((work) => JSON.parse(String(work.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  const tipAccepted = target !== null && accepted !== null && accepted.tip === target.tip && acceptanceSatisfied(store, groupId, body)
    && tasks.length > 0 && tasks.every((work) => work.status === "done");
  if (target === null || !tipAccepted || store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) {
    if (inFlight !== undefined && inFlight.settled === null) { inFlight.controller.abort(); checks.delete(keyOf(groupId)); }
    return false;
  }
  const key = `${target.tip}\0${target.commit}`;
  if (inFlight !== undefined) {
    if (inFlight.tip !== key) { inFlight.controller.abort(); checks.delete(keyOf(groupId)); return false; }
    if (inFlight.settled === null) return false;
    checks.delete(keyOf(groupId));
    if ("error" in inFlight.settled) throw inFlight.settled.error;
    const record = classify(target, inFlight.settled.outcome, accepted, inFlight.suite, store.now());
    deps.write(() => save(store, groupId, record, true));
    return true;
  }
  const recorded = deliveredAcceptanceOf(body);
  if (recorded !== null && recorded.tip === target.tip && recorded.commit === target.commit) return false;
  const at = store.now();
  if (target.beforeRecord) {
    deps.write(() => save(store, groupId, { tip: target.tip, commit: target.commit, result: "not-needed", why: "before-record", commands: [], at }, false));
    return true;
  }
  if (!target.madeForTip) {
    deps.write(() => save(store, groupId, { tip: target.tip, commit: target.commit, result: "not-needed", why: "already-in-target", commands: [], at }, false));
    return true;
  }
  const repo = deps.resolveRepository(groupRepoId(store, groupId));
  const tree = async (commit: string) => (await git(repo, [...QUIET_GIT, "rev-parse", `${commit}^{tree}`])).trim();
  if (await tree(target.commit) === await tree(target.tip)) {
    deps.write(() => save(store, groupId, { tip: target.tip, commit: target.commit, result: "not-needed", why: "same-tree", commands: [], at }, false));
    return true;
  }
  if (deps.stopped()) return false;
  const { setup, checks: commands, timeoutMs } = acceptanceCommands(store, groupId);
  const suite = fullSuiteCommand(store, groupRepoId(store, groupId));
  const controller = new AbortController();
  const entry: GroupAcceptanceCheck = { controller, tip: key, suite, settled: null, done: Promise.resolve() };
  entry.done = runAcceptance(deps, repo, groupId, nextAcceptancePath(deps.roots, groupId), target.commit, null, setup, commands, suite, timeoutMs, controller.signal)
    .then((outcome) => { entry.settled = { outcome }; }, (error: unknown) => { entry.settled = { error }; });
  checks.set(keyOf(groupId), entry);
  return false;
}

/**
 * passed; passed-relative when only the full suite is red and the tip's own acceptance classified that same suite as
 * already red at the group's base (spec D3); waived when the tip's acceptance was waived and the same command fails here
 * (Correction 1.6: the person already accepted that failure); failed otherwise.
 */
function classify(target: { tip: string; commit: string }, outcome: AcceptanceOutcome, accepted: ReturnType<typeof acceptanceOf>, suite: string | null, at: number): DeliveredAcceptance {
  const base = { tip: target.tip, commit: target.commit, commands: outcome.commands, at };
  if (outcome.failure === null) return { ...base, result: "passed" };
  const tail = outcome.failure.tail === "" ? {} : { tail: outcome.failure.tail };
  const failing = outcome.commands.at(-1)?.command ?? null;
  if (suite !== null && failing === suite && accepted?.result === "passed-relative" && accepted.fullSuite?.command === suite) return { ...base, ...tail, result: "passed-relative" };
  if (accepted?.result === "waived" && accepted.waived !== undefined && failing === failedCommandOf(accepted))
    return { ...base, ...tail, result: "waived", waived: { ...accepted.waived, note: `carried from the tip's waiver: ${accepted.waived.note}` } };
  return { ...base, ...tail, result: "failed" };
}
