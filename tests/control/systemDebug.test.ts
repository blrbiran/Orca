import { describe, expect, it } from "vitest";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { escalationsOf, readSystemDebugMark, systemDebugGroupId } from "../../src/control/systemDebug.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { needsAttention } from "../../web/src/groupCategory.js";
import type { GroupSummaryV1 } from "../../web/src/controlTypes.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * System debug task spec 2026-10-21 §2-§3 (kanban spec §6 levels 2 and 3, §9a.3-§9a.4): a started group's task whose run
 * ended failed is escalated by Orca itself -- a debug group stacked on the group's branch is opened, confirmed and started
 * as orca-auto, its fix is folded into the group's branch, and the failed task reruns once from there. Driven through the
 * driver's synthetic ccloop over a real repository (fixtures/driverPort.ts); every assertion reads the store or git.
 */
const LADDER = systemDebugGroupId({ kind: "ladder", groupId: "g", taskId: "a", runId: null });

async function ladderWorld(options: { debugFails?: boolean } = {}) {
  let failing = true;
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: (id) => (id === "a" && failing) || (id === "debug" && options.debugFails === true) ? "failed" : "succeed",
    stopReason: (id) => (id === "a" && failing ? "Error: check failed: node check.js" : null),
  });
  const limit = (JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { ledger: { groupLimit: Record<string, number> } }).ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  // The pass needs the repository's path (resolveRepository), as the panel's service has it.
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const driver = t.driver();
  const failedRun = async (): Promise<string> => {
    const runId = await t.claim();
    await t.until(driver, () => t.body(runId).state === "blocked");
    return runId;
  };
  const taskStatus = (groupId: string, taskId: string) => (JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, taskId)!.body)) as { status: string }).status;
  /** Start the debug group as the pump would (start-on-confirm), deliver its wake and drive it until its task settles. */
  const driveDebug = async (until: (status: string) => boolean): Promise<void> => {
    const started = await service.autoStart();
    expect(started.started).toContain(LADDER);
    const delivered = await deliverScheduledStart(t.dispatch, LADDER);
    if (delivered.kind !== "claimed") throw new Error(`debug claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => until(taskStatus(LADDER, "debug")) || t.body(delivered.runId).state === "blocked", 120);
  };
  const summary = (groupId: string) => readGroupSummary(t.h.store, groupId) as unknown as GroupSummaryV1;
  const body = (groupId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  return { t, service, driver, failedRun, driveDebug, taskStatus, summary, body, succeedNext: () => { failing = false; } };
}

describe("escalation ladder level 2: a system debug group fixes a failed task, which then reruns once (spec §3)", () => {
  it("opens a stacked debug group as orca-auto, confirms it, folds its fix into the group's branch and reruns the task from there", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      const failedRunId = await w.failedRun();
      // The repository delivers locally by default: the ladder group must still carry no scheme of its own.
      writeRepositorySettingsBody(t.h.store, "repo", { workspaceMode: "worktree", revision: 1, integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } });
      const first = await w.service.systemDebugPass();
      expect(first.opened).toEqual([LADDER]);
      expect(first.confirmed).toEqual([LADDER]);
      // The mark names the source and the stack; the work reaches the target only through g (keep: no integration).
      expect(readSystemDebugMark(w.body(LADDER))).toEqual({ source: { kind: "ladder", groupId: "g", taskId: "a", runId: failedRunId }, stackOn: "g", inputHash: expect.stringMatching(/^[a-f0-9]{64}$/), settled: null });
      expect(w.body(LADDER).integration).toBeUndefined();
      // The debug task is held to the original's checks and told what Orca observed.
      const contract = JSON.parse(readArchivedPlan(t.h.store, LADDER).plan.tasks[0]!.originalContractCanonicalJson) as { objective: { goal: string }; verification: { requiredChecks: string[] } };
      expect(contract.verification.requiredChecks).toEqual(["true"]);
      expect(contract.objective.goal).toContain("Error: check failed: node check.js");
      expect(readBudgetProposal(t.h.store, LADDER).state).toBe("confirmed");
      const confirmActor = t.h.store.db.prepare("SELECT actor_id FROM commands WHERE group_id=? AND verb='confirm'").get(LADDER);
      expect(confirmActor?.actor_id).toBe("orca-auto");
      // While Orca works on it, the blocked task is not the person's.
      expect(w.summary("g").escalation).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "debugging", reason: null }]);
      expect(needsAttention(w.summary("g"))).toBe(false);
      // A second pass opens nothing more (one ladder per task).
      expect((await w.service.systemDebugPass()).opened).toEqual([]);

      const gHead = git(t.repo, "rev-parse", "refs/heads/orca/g");
      await w.driveDebug((status) => status === "done");
      expect(w.taskStatus(LADDER, "debug")).toBe("done");
      // The debug branch started from g's branch (stacked).
      expect(git(t.repo, "merge-base", "--is-ancestor", gHead, "refs/heads/orca/" + LADDER)).toBe("");

      const fold = await w.service.systemDebugPass();
      expect(fold.folded).toEqual([LADDER]);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(git(t.repo, "rev-parse", "refs/heads/orca/" + LADDER));
      expect(readSystemDebugMark(w.body(LADDER))?.settled?.state).toBe("folded");
      expect(t.body(failedRunId).state).toBe("settled-failed");
      expect(w.taskStatus("g", "a")).toBe("ready");
      const retryActor = t.h.store.db.prepare("SELECT actor_id FROM commands WHERE group_id='g' AND verb='retry-task'").get();
      expect(retryActor?.actor_id).toBe("orca-auto");
      expect(w.summary("g").escalation).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "rerunning", reason: null }]);

      // The rerun starts from the folded head, so it sees the debug task's change, and it lands.
      w.succeedNext();
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`rerun claim refused: ${JSON.stringify(delivered)}`);
      await t.until(w.driver, () => w.taskStatus("g", "a") === "done", 120);
      expect(git(t.repo, "show", "refs/heads/orca/g:debug")).toBe("debug");
      expect(w.summary("g").escalation).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("level 3: the rerun failing again is the person's (exhausted), and nothing further is opened", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedRun();
      await w.service.systemDebugPass();
      await w.driveDebug((status) => status === "done");
      await w.service.systemDebugPass();
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`rerun claim refused: ${JSON.stringify(delivered)}`);
      await t.until(w.driver, () => t.body(delivered.runId).state === "blocked", 120);
      expect(escalationsOf(t.h.store, "g")).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "exhausted", reason: "rerun-failed" }]);
      expect(needsAttention(w.summary("g"))).toBe(true);
      const again = await w.service.systemDebugPass();
      expect([again.opened, again.folded]).toEqual([[], []]);
    } finally { await t.h.dispose(); }
  });

  it("level 3: the debug task's own failure ends the ladder (it is not escalated in turn)", async () => {
    const w = await ladderWorld({ debugFails: true }); const { t } = w; try {
      await w.failedRun();
      await w.service.systemDebugPass();
      await w.driveDebug(() => false);
      const pass = await w.service.systemDebugPass();
      expect(pass.settled).toEqual([LADDER]);
      expect(readSystemDebugMark(w.body(LADDER))?.settled?.state).toBe("debug-failed");
      expect(escalationsOf(t.h.store, "g")).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "exhausted", reason: "debug-failed" }]);
      // No ladder of the debug group itself.
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM groups WHERE substr(id,1,9)='sysdebug-'").get()?.n).toBe(1);
      expect(needsAttention(w.summary("g"))).toBe(true);
    } finally { await t.h.dispose(); }
  });

  it("level 3: a group branch that moved since the failure is not folded over", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      const failedRunId = await w.failedRun();
      await w.service.systemDebugPass();
      await w.driveDebug((status) => status === "done");
      // Someone moved orca/g off the debug branch's base.
      const moved = git(t.repo, "commit-tree", git(t.repo, "rev-parse", "refs/heads/main^{tree}"), "-p", git(t.repo, "rev-parse", "refs/heads/main"), "-m", "moved");
      git(t.repo, "update-ref", "refs/heads/orca/g", moved);
      const pass = await w.service.systemDebugPass();
      expect(pass.folded).toEqual([]);
      expect(readSystemDebugMark(w.body(LADDER))?.settled?.state).toBe("fold-refused");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(moved);
      // Not retried: the failed run is still the task's, blocked where ccloop ended it.
      expect(t.body(failedRunId).state).toBe("blocked");
      expect(t.h.store.db.prepare("SELECT 1 FROM commands WHERE group_id='g' AND verb='retry-task'").get()).toBeUndefined();
      expect(escalationsOf(t.h.store, "g")).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "exhausted", reason: "fold-refused" }]);
    } finally { await t.h.dispose(); }
  });

  it("does not escalate a group confirmed before start-on-confirm (no orchestration record)", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedRun();
      t.h.store.db.prepare("DELETE FROM group_orchestration WHERE group_id='g'").run();
      expect(await w.service.systemDebugPass()).toEqual({ opened: [], confirmed: [], folded: [], settled: [] });
    } finally { await t.h.dispose(); }
  });
});
