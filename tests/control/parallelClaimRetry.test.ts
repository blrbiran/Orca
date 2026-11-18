/**
 * Off-plan writes #346, W4, plan Task 6 (human ruling on W4, 2026-11-17, Orca session 0e0846ae, 「按建议走」): a run stopped
 * for writing a parallel sibling's frozen claim is retried after that sibling -- by a person (`orca task retry … --after`)
 * or by Orca as orca-auto. The retry appends the sibling to the work item's `dependsOn` (so the task waits for it), drops
 * that sibling's claims from the task's frozen entry and re-derives its contract, in the retry's own transaction.
 * Review Focus 1 (two siblings stopped on each other: the second auto retry is refused `after-cycle`) and 5 (an auto
 * retry refused for funding is noted, and a person's `--after` still works) are pinned here.
 * Driven through the synthetic ccloop: a and b are v4 tasks with no order between them, so each denies the other's target.
 */
import { describe, expect, it, vi } from "vitest";
import { readConfirmedTaskExecution, offPlanEntryOf } from "../../src/control/executionSnapshot.js";
import { recordConfirmed } from "../../src/control/orchestration.js";
import { recordActivity } from "../../src/control/activity.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { nextClaimableTask } from "../../src/control/webDispatch.js";
import { executionSnapshotSchema } from "../../src/control/webProtocol.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup, readControlRecovery, readGroupSummary } from "../../src/panel/controlViews.js";
import { retryAfterCommand } from "../../src/control/driveRecord.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const SIBLINGS_LINE = "Other tasks of this group change these paths at the same time";

const work = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)) as
  { status: string; currentRunId: string; dependsOn: string[]; afterDependsOn?: string[] };
const frozen = (t: Harness) => executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(t.h.store, readBudgetProposal(t.h.store, "g").executionSnapshotHash!)));
const retried = (t: Harness, runId: string) => t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='task-retried'").all(runId).map(row => JSON.parse(String(row.body)));
const commandAnswer = (t: Harness, commandId: string) => {
  const row = t.h.store.db.prepare("SELECT body_json FROM commands WHERE group_id='g' AND id=?").get(commandId);
  return row === undefined ? undefined : JSON.parse(String(row.body_json));
};
const autoId = (taskId: string, runId: string) => `orca-auto-parallel-claim-${taskId}-${runId}`;

/** a and b in parallel; each task's run stops as `stops` says (a `denylist match: <path>`), until `outcome` is changed. */
async function world(stops: Record<string, string>, options: HarnessOptions = {}) {
  const outcome: Record<string, FakeBehaviour> = Object.fromEntries(Object.keys(stops).map(id => [id, "blocked-waiting-human" as FakeBehaviour]));
  const t = await driverHarness([{ taskId: "a", tokenBudget: options.tokenPolicy === undefined ? undefined : 4_000_000 }, { taskId: "b" }], {
    behaviour: (id) => outcome[id] ?? "succeed", stopReason: (id) => outcome[id] === "blocked-waiting-human" ? stops[id] ?? null : null, ...options,
  });
  const driver = t.driver();
  const runs: Record<string, string> = {};
  for (const _ of Object.keys(stops)) {
    const runId = await t.claim();
    runs[t.body(runId).taskId] = runId;
    await t.until(driver, () => t.body(runId).state === "blocked");
  }
  return { t, driver, runs, outcome };
}

/**
 * Fix round 1 (Important 1): Orca acts only in a group it orchestrates -- an orchestration record in mode `run`, as every
 * other orca-auto pass reads it ("Confirm only", mode `hold`, is the person's to drive). Set here explicitly, so these tests
 * do not depend on the mode the harness's confirm records.
 */
const orchestrate = (t: Harness): void => {
  if (t.h.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.mode','run') WHERE group_id='g'").run().changes === 0) recordConfirmed(t.h.store, "g", "run", 0);
};
const workBody = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)) as Record<string, unknown>;
const setWork = (t: Harness, taskId: string, patch: Record<string, unknown>): void => {
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...workBody(t, taskId), ...patch }), taskId);
};
const setRun = (t: Harness, runId: string, patch: Record<string, unknown>): void => {
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...t.body(runId), ...patch }), runId);
};
const runView = (t: Harness, runId: string) => readControlGroup(t.h.store, "e", "g").runs.find(run => run.runId === runId)!;

const retry = (t: Harness, payload: Record<string, unknown>, commandId: string) => t.service.retryTask(t.h.command("retry-task", payload as never, commandId));

describe("retry-task --after <sibling>", { timeout: 120_000 }, () => {
  it("a person's --after adds the sibling to dependsOn, drops its claims and re-derives", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      expect(t.body(runs.a!).drive.parallelClaim).toEqual({ path: "b", repoKey: null, siblingIds: ["b"] });
      const before = readConfirmedTaskExecution(t.h.store, "g", "a");
      expect(before.contract.safetyPolicy.denylistPaths).toContain("b");
      const bEntry = offPlanEntryOf(frozen(t), "b");
      // The group card names the retry the stop calls for.
      // mutation: the card ignores the stored parallel claim -> no next step, red
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toMatchObject({ taskId: "a", next: "orca task retry g a --after b" });
      // Fix round 1 (minor 4): the run view names the sibling the Web retry goes after.
      expect(runView(t, runs.a!).retryAfter).toBe("b");
      expect(bEntry.map(s => s.siblingId)).toEqual(["a"]);

      expect(retry(t, { taskId: "a", runId: runs.a, after: "b" }, "after-1")).toMatchObject({ result: { kind: "task-retried", taskId: "a", fromRunId: runs.a } });
      expect(work(t, "a")).toMatchObject({ status: "ready", dependsOn: ["b"], afterDependsOn: ["b"] });
      // mutation: the sibling's claims are kept -> b still denied, the constraint line still names it, red
      const after = readConfirmedTaskExecution(t.h.store, "g", "a");
      expect(after.contract.safetyPolicy.denylistPaths).not.toContain("b");
      expect(after.contract.context.constraints.some(line => line.startsWith(SIBLINGS_LINE))).toBe(false);
      expect(after.siblings).toEqual([]);
      expect(after.derivedContractHash).not.toBe(before.derivedContractHash);
      expect(frozen(t).offPlan?.some(entry => entry.taskId === "a") ?? false).toBe(false);
      // Only a's entry moved: b still denies a's claim.
      expect(offPlanEntryOf(frozen(t), "b")).toEqual(bEntry);
      expect(retried(t, runs.a!)).toEqual([{ fromRunId: runs.a, after: "b" }]);
      // The panel reads the amended work item as authority, not as a drifted one.
      // mutation: the panel compares dependsOn with the archived plan's edges only -> work-item-authority block, red
      expect(() => readControlGroup(t.h.store, "e", "g")).not.toThrow();
    } finally { await t.h.dispose(); }
  });

  it("the task does not dispatch until the sibling is done", async () => {
    const { t, driver, runs, outcome } = await world({ a: "denylist match: b", b: "denylist match: .github/ci.yml" });
    try {
      expect(retry(t, { taskId: "a", runId: runs.a, after: "b" }, "after-1")).not.toHaveProperty("error");
      outcome.a = "succeed";
      // b is blocked, not done: a waits.
      // mutation: --after does not touch dependsOn -> a is claimable at once, red
      expect(nextClaimableTask(t.h.store, "g")).toBeNull();
      outcome.b = "succeed";
      expect(retry(t, { taskId: "b", runId: runs.b }, "retry-b")).not.toHaveProperty("error");
      // b, ready again, is claimed first; a only once b is done -- and then runs under its re-derived contract to done.
      expect(nextClaimableTask(t.h.store, "g")).toEqual({ workItemId: "b" });
      const bRun = await t.claim();
      await t.until(driver, () => work(t, "b").status === "done", 200);
      expect(t.body(bRun).taskId).toBe("b");
      expect(nextClaimableTask(t.h.store, "g")).toEqual({ workItemId: "a" });
      const aRun = await t.claim();
      await t.until(driver, () => work(t, "a").status === "done", 200);
      expect(t.body(aRun).taskId).toBe("a");
    } finally { await t.h.dispose(); }
  });

  it("--after a task that is not a frozen sibling is refused", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }, { taskId: "c", dependsOn: ["a"] }],
      { behaviour: (id) => id === "a" ? "blocked-waiting-human" : "succeed", stopReason: (id) => id === "a" ? "denylist match: b" : null });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      // c depends on a: ordered, never a sibling. a itself is not its own sibling.
      expect(retry(t, { taskId: "a", runId, after: "c" }, "after-c")).toMatchObject({ error: { code: "after-not-a-sibling" } });
      expect(retry(t, { taskId: "a", runId, after: "a" }, "after-a")).toMatchObject({ error: { code: "after-not-a-sibling" } });
      expect(t.body(runId).state).toBe("blocked");
      expect(work(t, "a").dependsOn).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("--after with --allow-observed-paths is refused", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      // mutation: the combination is not refused first -> the observed-path checks answer instead, red
      expect(retry(t, { taskId: "a", runId: runs.a, after: "b", allowObservedPaths: true }, "after-observed")).toMatchObject({ error: { code: "after-with-observed-paths" } });
      expect(t.body(runs.a!).state).toBe("blocked");
      expect(work(t, "a").dependsOn).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  // Controller ruling (2026-11-18): a frozen entry is never rewritten under a running attempt.
  it("--after while the task's run is still going is refused", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]);
    try {
      const runId = await t.claim();
      expect(t.body(runId).taskId).toBe("a");
      expect(t.body(runId).state).not.toBe("blocked");
      // mutation: no live-run check -> the generic run-state refusal answers instead, red
      expect(retry(t, { taskId: "a", runId, after: "b" }, "after-live")).toMatchObject({ error: { code: "after-task-has-live-run" } });
      expect(work(t, "a").dependsOn).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});

describe("the orca-auto parallel-claim pass", { timeout: 120_000 }, () => {
  it("two siblings blocked on each other: the second auto retry is refused after-cycle and stays for a person", async () => {
    const { t, runs } = await world({ a: "denylist match: b", b: "denylist match: a" });
    try {
      // Ruling: fix round 1 (Important 1) -- the pass acts only in a group Orca orchestrates; this test's group now is one.
      orchestrate(t);
      const pass = await t.service.systemDebugPass();
      const answers = { a: commandAnswer(t, autoId("a", runs.a!)), b: commandAnswer(t, autoId("b", runs.b!)) };
      // Whichever went first was applied; the other would close the cycle.
      const applied = (["a", "b"] as const).filter(id => answers[id]?.result?.kind === "task-retried");
      const refused = (["a", "b"] as const).filter(id => answers[id]?.error?.code === "after-cycle");
      expect([applied.length, refused.length]).toEqual([1, 1]);
      const [first, second] = [applied[0]!, refused[0]!];
      expect(pass.redispatched).toEqual([`g:${first}`]);
      expect(work(t, first).dependsOn).toEqual([second]);
      // mutation: no cycle check -> both retried, each waiting on the other (a deadlock), red
      expect(work(t, second).dependsOn).toEqual([]);
      expect(t.body(runs[second]!).state).toBe("blocked");
      expect(work(t, second).currentRunId).toBe(runs[second]);
    } finally { await t.h.dispose(); }
  });

  it("the auto pass retries once per run", async () => {
    const { t, runs } = await world({ a: "denylist match: b", b: "denylist match: a" });
    try {
      // Ruling: fix round 1 (Important 1) -- the pass acts only in a group Orca orchestrates; this test's group now is one.
      orchestrate(t);
      await t.service.systemDebugPass();
      const refused = ["a", "b"].find(id => commandAnswer(t, autoId(id, runs[id]!))?.error !== undefined)!;
      // The refused run is still blocked on a sibling's claim; a later pass (the group revision moved since) sends nothing.
      const resend = vi.spyOn(t.service, "retryTask");
      const stderr = vi.spyOn(process.stderr, "write");
      try {
        await t.service.systemDebugPass();
        // mutation: no once-per-run guard -> the pass sends the same command again (a command-id conflict), red
        expect(resend.mock.calls.filter(([command]) => command.commandId === autoId(refused, runs[refused]!))).toEqual([]);
        expect(stderr.mock.calls.filter(([line]) => String(line).includes("parallel-claim"))).toEqual([]);
      } finally { resend.mockRestore(); stderr.mockRestore(); }
    } finally { await t.h.dispose(); }
  });

  it("an auto retry refused for funding is recorded and a person's --after still works", async () => {
    // The #234 numbers (autoRetryAttemptFloor.test.ts): 4,000,000 tokens authored, a run that used 3,204,406 over 2 attempts.
    const { t, runs } = await world({ a: "denylist match: b" }, { tokenPolicy: "optional-v1", modelVersion: null, workTokens: () => 3_204_406, workAttempts: () => 2 });
    try {
      // Ruling: fix round 1 (Important 1) -- the pass acts only in a group Orca orchestrates; this test's group now is one.
      orchestrate(t);
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }))).not.toHaveProperty("error");
      const pass = await t.service.systemDebugPass();
      expect(pass.redispatched).toEqual([]);
      // mutation: the funding refusal is not checked -> the auto retry is sent (and booked), red
      expect(commandAnswer(t, autoId("a", runs.a!))).toBeUndefined();
      const notes = t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='ladder-skipped'").all(runs.a!).map(row => JSON.parse(String(row.body)));
      expect(notes).toEqual([{ reason: "retry-funding-below-attempt-cost:795594/1602203" }]);
      expect(t.body(runs.a!).state).toBe("blocked");
      // A person's --after is not held to the automatic retry's attempt-cost floor.
      expect(retry(t, { taskId: "a", runId: runs.a, after: "b" }, "after-person")).toMatchObject({ result: { kind: "task-retried" } });
      expect(work(t, "a")).toMatchObject({ status: "ready", dependsOn: ["b"] });
    } finally { await t.h.dispose(); }
  });

  // Fix round 1 (Important 1): the groups every other orca-auto pass reads -- mode `run`, not paused or stopped.
  it("a Confirm-only group gets no automatic retry", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      t.h.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.mode','hold') WHERE group_id='g'").run();
      await t.service.systemDebugPass();
      // mutation: the pass reads every group -> the retry is sent in a group the person drives, red
      expect(commandAnswer(t, autoId("a", runs.a!))).toBeUndefined();
      expect(t.body(runs.a!).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("a paused group: nothing is booked while paused, and the run is retried after resume", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      orchestrate(t);
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}, "pause-1"))).not.toHaveProperty("error");
      await t.service.systemDebugPass();
      // mutation: paused groups are not passed over -> a stop-mode-conflict refusal is booked and, once per run, final, red
      expect(commandAnswer(t, autoId("a", runs.a!))).toBeUndefined();
      expect(await t.service.resumeDispatch(t.h.command("resume-dispatch", {}, "resume-1"))).not.toHaveProperty("error");
      await t.service.systemDebugPass();
      expect(commandAnswer(t, autoId("a", runs.a!))).toMatchObject({ result: { kind: "task-retried" } });
      expect(work(t, "a").dependsOn).toEqual(["b"]);
    } finally { await t.h.dispose(); }
  });

  // Fix round 1 (Important 2): what the worker-lost pass waits for before it sends, so its once-per-run row is not a refusal.
  it("usage still pending after the block: nothing is booked until it is folded", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      orchestrate(t);
      t.h.store.db.prepare("INSERT INTO usage_events VALUES (?,?,?,?)").run(runs.a!, t.body(runs.a!).highWater + 1, "0".repeat(64), "{}");
      await t.service.systemDebugPass();
      // mutation: no pending-usage check -> usage-pending is booked as the run's one retry, red
      expect(commandAnswer(t, autoId("a", runs.a!))).toBeUndefined();
      t.h.store.db.prepare("DELETE FROM usage_events WHERE run_id=? AND seq>?").run(runs.a!, t.body(runs.a!).highWater);
      await t.service.systemDebugPass();
      expect(commandAnswer(t, autoId("a", runs.a!))).toMatchObject({ result: { kind: "task-retried" } });
    } finally { await t.h.dispose(); }
  });

  it("unknown usage: nothing is sent", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      orchestrate(t);
      setRun(t, runs.a!, { unknown: { ...t.body(runs.a!).unknown, work: true } });
      await t.service.systemDebugPass();
      // mutation: no unknown-usage check -> usage-unknown is booked as the run's one retry, red
      expect(commandAnswer(t, autoId("a", runs.a!))).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("a run already noted as skipped is passed over", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      orchestrate(t);
      t.h.store.transaction(() => recordActivity(t.h.store, { groupId: "g", taskId: "a", runId: runs.a!, kind: "ladder-skipped", body: { reason: "authored-budget-exhausted" } }));
      await t.service.systemDebugPass();
      // mutation: the note is not read -> the (now fundable) run is retried after it was left to the person, red
      expect(commandAnswer(t, autoId("a", runs.a!))).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});

// Fix round 1 (minor 4): a sibling that already waits on this task would close a cycle; no step points at it.
describe("no --after toward a sibling that already waits on the task", { timeout: 120_000 }, () => {
  it("the card and the run view omit it", async () => {
    const { t, runs } = await world({ a: "denylist match: b", b: "denylist match: a" });
    try {
      expect(retry(t, { taskId: "b", runId: runs.b, after: "a" }, "after-a")).not.toHaveProperty("error");
      // mutation: the sibling's dependsOn is not read -> `--after b` offered for a, red
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "terminal:blocked_waiting_human" });
      expect(runView(t, runs.a!).retryAfter).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});

// Final fix wave (Important 1, final whole-branch review 2026-11-18): Orca's own harvest bound blocks a write into a sibling's
// claim with outcome `succeeded` -- retry-task refused that run (`outcome:succeeded`), so no step could point at `--after`.
// Ruling (2026-11-18 tester batch D review): 「这次批准改写所有必要的判据」 -- D5 (human ruling on the #352 salvage narrow
// fix) gave that run a retry exit, and review I5 made the card and the run view name the same `--after` the recovery list
// does. The orca-auto pass still reads ccloop's stop (`blocked_waiting_human`) only. (Was: the card and run view offer none.)
describe("a parallel-claim block recorded by Orca's own bound", { timeout: 120_000 }, () => {
  it("offers --after on the card and the run view, as the recovery list does, and retry-task takes it", async () => {
    // The synthetic ccloop enforces no denylist, so a's write into b's claim reaches Orca's bound at collect.
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { files: (id): Record<string, string> => id === "a" ? { a: "a\n", b: "from a\n" } : { b: "b\n" } });
    try {
      const runId = await t.claim();
      expect(t.body(runId).taskId).toBe("a");
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ outcome: "succeeded", blockedReason: "out-of-bounds:b", parallelClaim: { path: "b", repoKey: null, siblingIds: ["b"] } });
      // mutation: retryAfterSibling reads ccloop's stop only (as before review I5) -> no next, no retryAfter, red here.
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "out-of-bounds:b", next: retryAfterCommand("g", "a", "b") });
      expect(runView(t, runId).retryAfter).toBe("b");
      expect(readControlRecovery(t.h.store, "e").terminalRuns).toEqual([expect.objectContaining({ runId, retryAfter: "b" })]);
      expect(retry(t, { taskId: "a", runId, after: "b" }, "after-bound")).toMatchObject({ result: { kind: "task-retried", taskId: "a", fromRunId: runId } });
    } finally { await t.h.dispose(); }
  });
});

// Fix round 1 (minor 3): the panel accepts an `--after` edge only as the retry writes it.
describe("the panel's authority check on afterDependsOn", { timeout: 120_000 }, () => {
  const blocks = (t: Harness, taskId: string) => expect(() => readControlGroup(t.h.store, "e", "g")).toThrow(`work-item-authority:${taskId}`);

  it("refuses an edge whose sibling is still in the task's frozen entry (no snapshot rewrite)", async () => {
    const { t } = await world({ a: "denylist match: b" });
    try {
      setWork(t, "a", { dependsOn: ["b"], afterDependsOn: ["b"] });
      // mutation: the frozen entry is not compared -> accepted, red
      blocks(t, "a");
    } finally { await t.h.dispose(); }
  });

  it("refuses the task itself, and an id that is no task of the group", async () => {
    const { t, runs } = await world({ a: "denylist match: b" });
    try {
      expect(retry(t, { taskId: "a", runId: runs.a, after: "b" }, "after-1")).not.toHaveProperty("error");
      expect(() => readControlGroup(t.h.store, "e", "g")).not.toThrow();
      setWork(t, "a", { dependsOn: ["a", "b"], afterDependsOn: ["a", "b"] });
      // mutation: the task's own id is not refused -> accepted, red
      blocks(t, "a");
      setWork(t, "a", { dependsOn: ["b", "zz"], afterDependsOn: ["b", "zz"] });
      // mutation: ids are not checked against the group's tasks -> accepted, red
      blocks(t, "a");
    } finally { await t.h.dispose(); }
  });

  it("refuses an id that is already a plan edge", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "c", dependsOn: ["a"] }]);
    try {
      setWork(t, "c", { afterDependsOn: ["a"] });
      // mutation: plan edges are not refused -> dependsOn [a] equals plan ∪ after, accepted, red
      blocks(t, "c");
    } finally { await t.h.dispose(); }
  });
});
