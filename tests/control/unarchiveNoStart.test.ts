// Tester #370, plan 2026-11-18 tester batch D, Task V3. Human ruling 2026-11-18 (「unarchive 一个 ready 组时，不应该自动开跑」):
// unarchiving a group must not start it. Review of the first form (#370 review, C1/C2): deleting the queued `start` wake
// missed a queued `no-start` re-arm (webDispatch.ts pendingStartWake claims from both) and a group started before the
// archive (replenishStartWakes re-arms from its earlier start). Controller decision: the unarchive pauses a group that would
// run on its own -- the pause intent `pause-dispatch` writes -- keeps every wake, and `orca group resume` lets it run.
// Ruling (2026-11-18 tester batch D review): the first form's expectations (`startDropped`, the wake deleted, `orca group
// start` in the receipt) are replaced by the pause's (`paused`, the wake kept, `orca group resume`).
// And an archived group reads `archived (was <state>)`, listed last, instead of `running · archived`.
import { describe, expect, it } from "vitest";
import { workHealthCheck } from "../../src/commands/status.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { appendConfirmedTaskInTransaction } from "../../src/control/groupTaskAppend.js";
import { readArchivedContract, readWork } from "../../src/control/queries.js";
import { createWebWakeHandlers, deliverScheduledStart, settleProviderAttempt } from "../../src/control/webDispatch.js";
import { withNeedsYou } from "../../src/panel/controlOverview.js";
import { readControlRecovery, readControlSummary, readGroupSummary } from "../../src/panel/controlViews.js";
import { cli, fakePanel, useFakePanels } from "../commands/fixtures/fakePanel.js";
import { world } from "../commands/fixtures/world.js";
import { driverHarness } from "./fixtures/driverHarness.js";

useFakePanels();

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const pendingWakes = (t: Harness) => t.h.store.db.prepare("SELECT id,kind FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume') ORDER BY rowid").all()
  .map((row) => ({ id: String(row.id), kind: String(row.kind) }));
const stopIntent = (t: Harness) => t.h.store.db.prepare("SELECT mode,revision,body FROM stop_intents WHERE group_id='g'").get();
const activeRuns = (t: Harness) => Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n);
const archiveThenUnarchive = (t: Harness) => {
  const archived = t.service.archiveGroup(t.h.command("archive-group", {}));
  if ("error" in archived) throw new Error(`archive refused: ${JSON.stringify(archived.error)}`);
  return t.service.unarchiveGroup(t.h.command("unarchive-group", {}));
};

describe("unarchiving a group never starts it (#370)", { timeout: 120_000 }, () => {
  it("a ready group with a queued start: paused, its wake kept, nothing claimed until a person resumes it", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      expect(await t.service.start(t.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const queued = pendingWakes(t);
      expect(queued.map((w) => w.kind)).toEqual(["start"]);
      t.service.archiveGroup(t.h.command("archive-group", {}));
      // While archived, recovery list does not show it as a start waiting on the archive: the unarchive does not start it.
      expect(readControlRecovery(t.h.store, "e").deferredWakes ?? []).toEqual([]);
      const result = t.service.unarchiveGroup(t.h.command("unarchive-group", {}));
      // mutation: wouldRunOnUnarchive answers false (no pause) -> red here
      expect(result).toMatchObject({ result: { kind: "unarchived", groupId: "g", paused: true } });
      expect(stopIntent(t)).toMatchObject({ mode: "pause" });
      expect(readGroupSummary(t.h.store, "g").stopState).toBe("paused");
      // Nothing deleted: the queued start is still there, held by the pause.
      expect(pendingWakes(t)).toEqual(queued);
      await t.driver().round();
      expect(activeRuns(t)).toBe(0);
      expect(await deliverScheduledStart(t.dispatch, "g")).toEqual({ kind: "blocked", reason: "group-stopped" });
      // A person's resume lets it run.
      expect(await t.service.resumeDispatch(t.h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "scheduled" } });
      expect((await deliverScheduledStart(t.dispatch, "g")).kind).toBe("claimed");
    } finally { await t.h.dispose(); }
  });

  // Review C1: a provider attempt proved not to have started re-arms the claim as a `no-start` wake (settleProviderAttempt),
  // which pendingStartWake claims from like a start.
  it("a queued no-start re-arm: paused; the pump claims nothing from it until the resume", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const settled = await settleProviderAttempt(t.dispatch, { runId, phase: "work", firstAttemptProof: "invalid" });
      expect(settled.wakeId).toMatch(/^scheduler-wake:g:no-start:/);
      expect(pendingWakes(t).map((w) => w.kind)).toEqual(["no-start"]);
      expect(activeRuns(t)).toBe(0);
      expect(archiveThenUnarchive(t)).toMatchObject({ result: { kind: "unarchived", paused: true } });
      const handlers = createWebWakeHandlers({ ...t.h.deps, service: t.service });
      const pass = await deliverSchedulerWakes(t.h.store, handlers);
      // mutation: wouldRunOnUnarchive answers false -> the no-start wake is delivered and a run claimed, red here
      expect(pass.delivered).not.toContain(settled.wakeId);
      expect(activeRuns(t)).toBe(0);
      expect(pendingWakes(t).map((w) => w.id)).toEqual([settled.wakeId]);
      await t.service.resumeDispatch(t.h.command("resume-dispatch", {}));
      await deliverSchedulerWakes(t.h.store, handlers);
      expect(activeRuns(t)).toBe(1);
    } finally { await t.h.dispose(); }
  });

  // Review C2: a group started before the archive, with every wake delivered and a task claimable again (here a task the
  // requirement review's fix appended after the first one landed): replenishStartWakes would re-arm from its earlier start.
  it("a group started before the archive with a claimable task and no queued wake: paused; the driver arms nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const base = structuredClone(readArchivedContract(t.h.store, "g", "a").contract);
      const grant = (readWork(t.h.store, "g", "a") as unknown as { grant: { work: never; handoff: never } }).grant;
      t.h.store.transaction(() => appendConfirmedTaskInTransaction(t.h.store, "g", { taskId: "fix-1",
        contract: { ...base, objective: { ...base.objective, taskId: "fix-1", goal: "fix what the review found" }, context: { ...base.context, targetPaths: ["fix-1"] } } as never,
        agentFrom: "a", work: grant.work, handoff: grant.handoff, dependsOn: ["a"] }));
      expect(pendingWakes(t)).toEqual([]);
      const result = archiveThenUnarchive(t);
      // mutation: drop the earlier-start-plus-claimable-task branch of wouldRunOnUnarchive -> no pause, red here
      expect(result).toMatchObject({ result: { kind: "unarchived", paused: true } });
      expect(replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate })).toEqual([]);
      expect(await deliverScheduledStart(t.dispatch, "g")).toEqual({ kind: "idle" });
      await t.service.resumeDispatch(t.h.command("resume-dispatch", {}));
      expect((await deliverScheduledStart(t.dispatch, "g")).kind).toBe("claimed");
    } finally { await t.h.dispose(); }
  });

  it("a done group: archive and unarchive leave no stop intent, and orca status stays ok", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      await t.claim();
      await t.until(t.driver(), () => readGroupSummary(t.h.store, "g").state === "done", 120);
      const result = archiveThenUnarchive(t);
      expect(result).toMatchObject({ result: { kind: "unarchived" } });
      // mutation: pause every unarchive (wouldRunOnUnarchive answers true) -> red here
      expect((result as { result: Record<string, unknown> }).result).not.toHaveProperty("paused");
      expect(stopIntent(t)).toBeUndefined();
      const summary = readControlSummary(t.h.store, "e", null);
      const p = await fakePanel({
        "GET summary": { status: 200, body: { ...summary, groups: withNeedsYou(t.h.store, summary.groups) } },
        "GET recovery": { status: 200, body: readControlRecovery(t.h.store, "e") },
      });
      const check = await workHealthCheck({ env: { PATH: process.env.PATH, HOME: p.dir }, stateDirFlag: p.dir, checkout: process.cwd() });
      expect(check).toMatchObject({ level: "ok", subject: "work" });
    } finally { await t.h.dispose(); }
  });

  it("a group already paused: the unarchive keeps that pause as it was and says nothing of its own", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      await t.service.start(t.h.command("start", {}));
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).toMatchObject({ result: { kind: "paused" } });
      const before = stopIntent(t);
      const stops = () => t.h.store.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE group_id='g' AND kind='stop'").get()!.n;
      const stopRows = stops();
      const result = archiveThenUnarchive(t);
      // mutation: drop the existing-stop-intent check -> the intent's revision is rewritten and `paused` said, red here
      expect((result as { result: Record<string, unknown> }).result).not.toHaveProperty("paused");
      expect(stopIntent(t)).toEqual(before);
      expect(stops()).toBe(stopRows);
    } finally { await t.h.dispose(); }
  });

  it("an archived group with no queued work: unarchive pauses nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const result = archiveThenUnarchive(t);
      expect(result).toMatchObject({ result: { kind: "unarchived", groupId: "g" } });
      expect((result as { result: Record<string, unknown> }).result).not.toHaveProperty("paused");
      expect(stopIntent(t)).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("the unarchive receipt names orca group resume when the group was paused", async () => {
    const answer = (result: unknown) => ({ status: 200, body: { schema: "orca-command-success-v1", commandId: "c", actorId: "human", verb: "unarchive-group",
      target: { kind: "group", groupId: "g-alpha" }, commandRevision: 6, projectionSeq: 6, effectivePayloadHash: "h", authorityCommandHash: "h", result } });
    const w = await world({}, { "POST groups/g-alpha/unarchive": answer({ kind: "unarchived", groupId: "g-alpha", paused: true }) });
    const out = await cli(["group", "unarchive", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the receipt's paused branch -> the generic key/value text, red
    expect(out.stdout).toBe("unarchived g-alpha; paused so it does not run on its own -- let it run with: orca group resume g-alpha\n");
  });

  it("group list: an archived group reads archived (was <state>) and is listed last", async () => {
    const w = await world({}, {
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 9, resetRequired: true, groups: [
        { groupId: "g-old", repoId: "repo-1", state: "review", commandRevision: 4, goal: "old", archived: true, counts: { running: 0, blocked: 0, done: 1, idle: 1, waiting: 0 }, completion: { done: 1, total: 2 } },
        { groupId: "g-new", repoId: "repo-1", state: "ready", commandRevision: 2, goal: "new", archived: false },
      ] } },
    });
    const out = await cli(["group", "list"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: print the old `<state> · archived` -> red
    expect(out.stdout).toBe("g-new  repo-1  ready  rev 2  new\ng-old  repo-1  archived (was review)  done 1/2  rev 4  old\n");
  });
});
