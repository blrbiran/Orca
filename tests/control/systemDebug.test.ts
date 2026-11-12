import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { buildSystemDebugPlanSource, escalationsOf, readSystemDebugMark, SYSTEM_DEBUG_INPUT_SCHEMA, systemDebugGroupId, type SystemDebugInputV1 } from "../../src/control/systemDebug.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
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
/** git with stdin (the harness's helper takes none). */
const gitIn = (cwd: string, input: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", input }).trim();
const LADDER = systemDebugGroupId({ kind: "ladder", groupId: "g", taskId: "a", runId: null });

async function ladderWorld(options: { debugFails?: boolean; humanBlock?: boolean } = {}) {
  let failing = true;
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: (id) => (id === "a" && failing) ? (options.humanBlock ? "blocked-waiting-human" : "failed")
      : (id === "debug" && options.debugFails === true) ? "failed" : "succeed",
    stopReason: (id) => (id === "a" && failing ? "Error: check failed: node check.js" : null),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
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
  /**
   * Kanban spec §6 level 1 (ccloop priorFailures spec §3): the first escalation of a failed task is one re-dispatch as
   * orca-auto. Drives that re-dispatch until it fails too, so the ladder's next pass reaches level 2; answers its run.
   */
  const failedThroughLevelOne = async (): Promise<string> => {
    await failedRun();
    const pass = await service.systemDebugPass();
    expect([pass.redispatched, pass.opened]).toEqual([["g:a"], []]);
    replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
    const delivered = await deliverScheduledStart(t.dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`level-1 claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => t.body(delivered.runId).state === "blocked", 120);
    return delivered.runId;
  };
  const summary = (groupId: string) => readGroupSummary(t.h.store, groupId) as unknown as GroupSummaryV1;
  const body = (groupId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  return { t, service, driver, failedRun, failedThroughLevelOne, driveDebug, taskStatus, summary, body, succeedNext: () => { failing = false; } };
}

describe("escalation ladder level 2: a system debug group fixes a failed task, which then reruns once (spec §3)", { timeout: 180_000 }, () => {
  it("skips an optional-budget ladder when no authored work remains for its required retry", async () => {
    // Ruling (2026-11-12, tester follow-up H): 「这次批准改写所有必要的判据。」 -- authored task work that a run exhausts exists only in a pre-release group (spec G §2.6).
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"], tokenBudget: 150_000 }], {
      tokenPolicy: "optional-v1", modelVersion: null, behaviour: () => "exhausted", workTokens: () => 10_000_000,
    });
    const service = new WebControlService({ ...t.h.deps, knownRepository: (id) => id === "repo", resolveRepository: () => t.repo });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const pass = await service.systemDebugPass();
      expect(pass).toMatchObject({ redispatched: [], opened: [] });
      expect(t.h.store.db.prepare("SELECT id FROM groups WHERE id=?").get(LADDER)).toBeUndefined();
      const note = t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='ladder-skipped'").get(runId);
      expect(note && JSON.parse(String(note.body))).toMatchObject({ reason: "authored-budget-exhausted" });
    } finally { await t.h.dispose(); }
  });

  it("leaves a pre-existing debug fix off the parent branch when its automatic retry cannot be funded", async () => {
    // Ruling (2026-11-12, tester follow-up H): 「这次批准改写所有必要的判据。」 -- a retry left unfunded by exhausted authored task work is a pre-release group's case (spec G §2.6).
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"], tokenBudget: 150_000 }], {
      tokenPolicy: "optional-v1", modelVersion: null, behaviour: (id) => id === "a" ? "exhausted" : "succeed",
      workTokens: (id) => id === "a" ? 10_000_000 : 10,
    });
    const service = new WebControlService({ ...t.h.deps, knownRepository: (id) => id === "repo", resolveRepository: () => t.repo });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const source = { kind: "ladder" as const, groupId: "g", taskId: "a", runId };
      expect(await service.openSystemDebugGroup({ schema: "orca-raw-command-v1", commandId: "old-debug", actorId: "orca-auto", expectedRevision: 0,
        verb: "system-debug-open", target: { kind: "group", groupId: LADDER }, payload: { source, stackOn: "g", repoId: "repo", facts: ["exhausted"], checks: ["true"] } })).toMatchObject({ result: { created: true } });
      expect((await service.systemDebugPass()).confirmed).toEqual([LADDER]);
      expect((await service.autoStart()).started).toContain(LADDER);
      const delivered = await deliverScheduledStart(t.dispatch, LADDER);
      if (delivered.kind !== "claimed") throw new Error(JSON.stringify(delivered));
      const debugStatus = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='debug'").get(LADDER)!.body)).status;
      await t.until(t.driver(), () => debugStatus() === "done", 120);
      const parentHead = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect((await service.systemDebugPass()).settled).toContain(LADDER);
      expect(readSystemDebugMark(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(LADDER)!.body)))?.settled).toMatchObject({ state: "retry-unfunded", detail: "authored-budget-exhausted" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(parentHead);
    } finally { await t.h.dispose(); }
  });

  it("refuses a manual retry while the confirmed ladder owns the same failed run", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      const failedRunId = await w.failedThroughLevelOne();
      expect((await w.service.systemDebugPass()).confirmed).toEqual([LADDER]);
      const before = structuredClone(t.body(failedRunId));
      const retry = () => t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId: failedRunId }));
      expect(retry()).toMatchObject({ error: { code: "task-not-retryable", message: expect.stringContaining(`debug-in-progress:${LADDER}`) } });
      expect(t.body(failedRunId)).toEqual(before);
      await w.driveDebug((status) => status === "done");
      expect(retry()).toMatchObject({ error: { code: "task-not-retryable", message: expect.stringContaining(`debug-in-progress:${LADDER}`) } });
      const fold = await w.service.systemDebugPass();
      expect(fold.folded, JSON.stringify({ fold, mark: readSystemDebugMark(w.body(LADDER)), failed: t.body(failedRunId).state, work: w.taskStatus("g", "a") })).toEqual([LADDER]);
    } finally { await t.h.dispose(); }
  });

  it("keeps the retry guard while a fold awaits Git even if the debug group is archived", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      const failedRunId = await w.failedThroughLevelOne();
      expect((await w.service.systemDebugPass()).confirmed).toEqual([LADDER]);
      await w.driveDebug((status) => status === "done");
      let entered!: () => void, release!: () => void;
      const inGit = new Promise<void>((resolve) => { entered = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const original = (w.service as any).fastForwardGroupBranch.bind(w.service);
      (w.service as any).fastForwardGroupBranch = async (...args: unknown[]) => { entered(); await hold; return original(...args); };
      const folding = w.service.systemDebugPass();
      await inGit;
      try {
        const revision = Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(LADDER)!.revision);
        const archive = w.service.archiveGroup(t.h.rawCommand("archive-during-fold", revision, "archive-group", { kind: "group", groupId: LADDER }, {}) as never);
        expect(archive).toMatchObject({ result: { kind: "archived" } });
        expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId: failedRunId })))
          .toMatchObject({ error: { code: "task-not-retryable", message: expect.stringContaining(`debug-in-progress:${LADDER}`) } });
      } finally { release(); await folding; }
    } finally { await t.h.dispose(); }
  });

  it("holds the fold guard through the settled mark against an overlapping pass", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedThroughLevelOne();
      expect((await w.service.systemDebugPass()).confirmed).toEqual([LADDER]);
      await w.driveDebug((status) => status === "done");
      const original = (w.service as any).foldLadder.bind(w.service);
      let overlap: Awaited<ReturnType<typeof w.service.systemDebugPass>> | null = null;
      (w.service as any).foldLadder = async (...args: unknown[]) => {
        const answer = await original(...args);
        overlap = await w.service.systemDebugPass();
        return answer;
      };
      expect((await w.service.systemDebugPass()).folded).toEqual([LADDER]);
      expect(overlap).toMatchObject({ folded: [], settled: [] });
      expect(readSystemDebugMark(w.body(LADDER))?.settled?.state).toBe("folded");
    } finally { await t.h.dispose(); }
  });

  it("leaves a blocked_waiting_human run for a person without retrying its unchanged contract", async () => {
    const w = await ladderWorld({ humanBlock: true }); const { t } = w; try {
      const runId = await w.failedRun();
      expect(t.body(runId).drive.outcome).toBe("blocked_waiting_human");
      const pass = await w.service.systemDebugPass();
      expect(pass.redispatched).toEqual([]);
      expect(pass.opened).toEqual([]);
      expect(t.h.store.db.prepare("SELECT id FROM commands WHERE group_id='g' AND actor_id='orca-auto' AND verb='retry-task'").all()).toEqual([]);
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  // Ruling: human approved rewriting all necessary criteria, Orca session 9ec98639, 2026-10-21 -- level 1 (one re-dispatch)
  // now comes first, so each level-2 case reaches the ladder through failedThroughLevelOne instead of a single failure.
  it("opens a stacked debug group as orca-auto, confirms it, folds its fix into the group's branch and reruns the task from there", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      const failedRunId = await w.failedThroughLevelOne();
      // The group's branch is ahead of the target (as after an earlier task of it landed), so a debug branch started
      // from the target's HEAD instead of the group's branch could not be folded back.
      const tree = gitIn(t.repo, `100644 blob ${gitIn(t.repo, "earlier\n", "hash-object", "-w", "--stdin")}\tearlier\n`, "mktree");
      git(t.repo, "update-ref", "refs/heads/orca/g", git(t.repo, "commit-tree", tree, "-p", git(t.repo, "rev-parse", "refs/heads/orca/g"), "-m", "earlier task"));
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
      const retryActor = t.h.store.db.prepare("SELECT actor_id FROM commands WHERE group_id='g' AND verb='retry-task' AND substr(id,1,23)='orca-auto-ladder-retry-'").get();
      expect(retryActor?.actor_id).toBe("orca-auto");
      expect(w.summary("g").escalation).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "rerunning", reason: null }]);

      // The rerun starts from the folded head, so it sees the debug task's change, and it lands.
      w.succeedNext();
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`rerun claim refused: ${JSON.stringify(delivered)}`);
      await t.until(w.driver, () => w.taskStatus("g", "a") === "done", 120);
      expect(git(t.repo, "show", "refs/heads/orca/g:debug")).toBe("debug");
      expect(git(t.repo, "show", "refs/heads/orca/g:earlier")).toBe("earlier");
      expect(w.summary("g").escalation).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  // Tester issue #61: pausing a group stops Orca's own escalation of it. Before the fix level 1's retry was refused
  // stop-mode-conflict, that refused row counted as level 1 done, and the next pass opened a ladder group anyway.
  it("a paused group is not escalated: no level-1 retry is booked and no ladder opens until the person resumes", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedRun();
      expect("error" in (await w.service.pauseDispatch(t.h.command("pause-dispatch", {})) as object)).toBe(false);
      // mutation: drop groupStopped from ladderCandidates -> the refused level-1 row is booked and the second pass opens LADDER, red
      for (let pass = 0; pass < 2; pass++) {
        const out = await w.service.systemDebugPass();
        expect([out.redispatched, out.opened, out.confirmed]).toEqual([[], [], []]);
      }
      expect(t.h.store.db.prepare("SELECT 1 FROM commands WHERE group_id='g' AND id='orca-auto-ladder-l1-a'").get()).toBeUndefined();
      expect(t.h.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(LADDER)).toBeUndefined();
      expect("error" in (await w.service.resumeDispatch(t.h.command("resume-dispatch", {})) as object)).toBe(false);
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
    } finally { await t.h.dispose(); }
  });

  it("an open ladder waits while its original group is paused: it is not folded back until the person resumes", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      const failedRunId = await w.failedThroughLevelOne();
      expect((await w.service.systemDebugPass()).confirmed).toEqual([LADDER]);
      await w.driveDebug((status) => status === "done");
      expect("error" in (await w.service.pauseDispatch(t.h.command("pause-dispatch", {})) as object)).toBe(false);
      // mutation: drop the pass's paused-source hold -> the fold runs, its retry is refused and the mark settles, red
      const held = await w.service.systemDebugPass();
      expect([held.folded, held.settled]).toEqual([[], []]);
      expect(readSystemDebugMark(w.body(LADDER))?.settled).toBeNull();
      expect(t.body(failedRunId).state).toBe("blocked");
      expect("error" in (await w.service.resumeDispatch(t.h.command("resume-dispatch", {})) as object)).toBe(false);
      expect((await w.service.systemDebugPass()).folded).toEqual([LADDER]);
    } finally { await t.h.dispose(); }
  });

  it("level 3: the rerun failing again is the person's (exhausted), and nothing further is opened", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedThroughLevelOne();
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
      // Cap (kanban §6: two extra runs per task): level 1 and level 2's rerun are spent; nothing is re-dispatched either.
      expect([again.redispatched, again.opened, again.folded]).toEqual([[], [], []]);
    } finally { await t.h.dispose(); }
  });

  it("level 3: the debug task's own failure ends the ladder (it is not escalated in turn)", async () => {
    const w = await ladderWorld({ debugFails: true }); const { t } = w; try {
      await w.failedThroughLevelOne();
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
      const failedRunId = await w.failedThroughLevelOne();
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
      expect(t.h.store.db.prepare("SELECT 1 FROM commands WHERE group_id='g' AND verb='retry-task' AND substr(id,1,23)='orca-auto-ladder-retry-'").get()).toBeUndefined();
      expect(escalationsOf(t.h.store, "g")).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "exhausted", reason: "fold-refused" }]);
    } finally { await t.h.dispose(); }
  });

  it("does not escalate a group confirmed \"only\" (the person drives it)", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedRun();
      const row = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM group_orchestration WHERE group_id='g'").get()!.body)) as Record<string, unknown>;
      t.h.store.db.prepare("UPDATE group_orchestration SET body=? WHERE group_id='g'").run(JSON.stringify({ ...row, mode: "hold" }));
      // mutation: ladderCandidates ignores the mode -> opened [LADDER], red
      expect((await w.service.systemDebugPass()).opened).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("steps aside when a person retried the task before the debug group was confirmed", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedRun();
      // Opened (and confirmed) in one pass, so the open is driven alone here: the pass's confirm step is what is tested.
      const source = { kind: "ladder" as const, groupId: "g", taskId: "a", runId: (JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as { currentRunId: string }).currentRunId };
      const opened = await w.service.openSystemDebugGroup({ schema: "orca-raw-command-v1", commandId: "open-1", actorId: "orca-auto", expectedRevision: 0, verb: "system-debug-open",
        target: { kind: "group", groupId: LADDER }, payload: { source, stackOn: "g", repoId: "repo", facts: ["failed"], checks: ["true"] } });
      expect(opened).toMatchObject({ result: { kind: "system-debug-opened", created: true } });
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ result: { kind: "task-retried" } });
      const pass = await w.service.systemDebugPass();
      // mutation: drop the superseded test -> confirmed [LADDER], red
      expect([pass.confirmed, pass.settled]).toEqual([[], [LADDER]]);
      expect(readSystemDebugMark(w.body(LADDER))?.settled?.state).toBe("superseded");
      expect(readBudgetProposal(t.h.store, LADDER).state).not.toBe("confirmed");
      expect(escalationsOf(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("does not confirm a draft ladder if a manual retry wins during agent resolution", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      const runId = await w.failedThroughLevelOne();
      const source = { kind: "ladder" as const, groupId: "g", taskId: "a", runId };
      expect(await w.service.openSystemDebugGroup({ schema: "orca-raw-command-v1", commandId: "draft-before-race", actorId: "orca-auto", expectedRevision: 0,
        verb: "system-debug-open", target: { kind: "group", groupId: LADDER }, payload: { source, stackOn: "g", repoId: "repo", facts: ["failed"], checks: ["true"] } })).toMatchObject({ result: { created: true } });
      let entered!: () => void, release!: () => void;
      const inResolve = new Promise<void>((resolve) => { entered = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const port = t.h.deps.port, original = port.resolveAgent.bind(port);
      port.resolveAgent = async (selection) => { entered(); await hold; return original(selection); };
      const pending = w.service.systemDebugPass();
      await inResolve;
      try {
        expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ result: { kind: "task-retried" } });
      } finally { release(); }
      const answer = await pending;
      expect(answer.confirmed).toEqual([]);
      expect(answer.settled).toContain(LADDER);
      expect(readSystemDebugMark(w.body(LADDER))?.settled?.state).toBe("superseded");
      expect(readBudgetProposal(t.h.store, LADDER).state).not.toBe("confirmed");
    } finally { await t.h.dispose(); }
  });

  it("does not escalate a group confirmed before start-on-confirm (no orchestration record)", async () => {
    const w = await ladderWorld(); const { t } = w; try {
      await w.failedRun();
      t.h.store.db.prepare("DELETE FROM group_orchestration WHERE group_id='g'").run();
      expect(await w.service.systemDebugPass()).toEqual({ redispatched: [], opened: [], confirmed: [], folded: [], settled: [] });
    } finally { await t.h.dispose(); }
  });
});

// Task setup A3: a system debug task runs the same checks as the task it fixes, so it keeps that task's setup.
describe("buildSystemDebugPlanSource keeps the original's setup", () => {
  const original = (extra: Record<string, unknown> = {}) => taskContractSchema.parse({
    objective: { taskId: "a", goal: "g", successCondition: "s" },
    context: { repoPath: "/repo", targetPaths: ["src/**"], buildTestCommands: ["npm test"], ...extra },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 1_000, totalRuntimeBudgetMs: 2_000, tokenBudget: 100, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 5 },
    safetyPolicy: { maxFilesTouched: 5 }, verification: { verifierType: "agent", requiredChecks: ["npm test"], rejectOn: ["REJECT:x"] }, escalationAndExit: {},
  });
  const input = { schema: SYSTEM_DEBUG_INPUT_SCHEMA, source: { kind: "task" }, stackOn: null, repoId: "r", facts: ["f"], checks: ["npm test"] } as unknown as SystemDebugInputV1;
  const built = (contract: ReturnType<typeof original> | null) => taskContractSchema.parse(buildSystemDebugPlanSource(input, contract, "/repo", undefined).tasks[0]!.originalContract);

  it("a system debug contract carries the original's setupCommands", () => {
    expect(built(original({ setupCommands: ["npm ci", "make gen"] })).context.setupCommands).toEqual(["npm ci", "make gen"]);
  });

  it("a system debug contract omits setupCommands when the original has none or there is no original", () => {
    expect("setupCommands" in built(original()).context).toBe(false);
    expect("setupCommands" in built(null).context).toBe(false);
  });

  // Final-review fix wave (I3): an integration check or a model-review finding has no source task; the open names the
  // setup, and the original's own setup (when there is one) still wins.
  it("with no original, the open's setup is the contract's; an original's setup wins", () => {
    const withSetup = { ...input, setup: ["npm ci"] } as SystemDebugInputV1;
    const of = (contract: ReturnType<typeof original> | null) => taskContractSchema.parse(buildSystemDebugPlanSource(withSetup, contract, "/repo", undefined).tasks[0]!.originalContract);
    // Mutation I3-M1 (the builder reads only the contract's setup) -> absent, red.
    expect(of(null).context.setupCommands).toEqual(["npm ci"]);
    expect(of(original({ setupCommands: ["make gen"] })).context.setupCommands).toEqual(["make gen"]);
  });
});
