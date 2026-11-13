import { describe, expect, it } from "vitest";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { work } from "./fixtures/handoffHarness.js";

// Tester #230: the driver blocks the run only (spec §2.2) and leaves the work item `running`, which scheduling, close-run
// and recovery all read. The group view used to show that task `active` while the brief counted it blocked and the Board
// showed it blocked (web runFacts `shownWorkStatus`, #117) -- three views, two answers. The view now derives the status a
// person reads from the run, so `group show` says what the brief and the Board say; the stored state is untouched.
describe("a run the driver blocked reads blocked in every view (#230)", { timeout: 60_000 }, () => {
  it("group view status, its category and the brief agree, while the stored work item stays running", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({ "elsewhere.txt": "x\n" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      // The stored state the scheduler and the recovery verbs read stays as the driver left it.
      expect(work(t, "a")).toMatchObject({ status: "running", currentRunId: runId });
      const item = readControlGroup(t.h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!;
      expect(item.category).toBe("blocked");
      expect(item.status).toBe("blocked");
      expect(readGroupSummary(t.h.store, "g").counts).toMatchObject({ blocked: 1, running: 0 });
    } finally { await t.h.dispose(); }
  });

  it("a recovery retry of that run still resumes it, and the view reads active again", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({ "elsewhere.txt": "x\n" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId).state).not.toBe("blocked");
      expect(readControlGroup(t.h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!.status).toBe("active");
    } finally { await t.h.dispose(); }
  });

  // Tester follow-up I (#230 rest): the store keeps `running` on purpose -- a stored `blocked` already means "checkpoint
  // committed, not accepted" (retryTask's released branches, handoff.ts `checkpoint-blocked`), so writing it from blockRun
  // would route a live run into those branches. Both views derive from the same run instead (categoryOf ->
  // workItemCategory), so there is nothing to keep in step: blocked, both say blocked; resumed, both say running.
  it("the brief's counts and the group view's word move together, both ways, from the run alone", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({ "elsewhere.txt": "x\n" }) }); try {
      const runId = await t.claim();
      const views = () => ({
        status: readControlGroup(t.h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!.status,
        counts: readGroupSummary(t.h.store, "g").counts,
      });
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(work(t, "a").status).toBe("running");
      expect(views()).toMatchObject({ status: "blocked", counts: { blocked: 1, running: 0 } });
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(work(t, "a").status).toBe("running");
      expect(views()).toMatchObject({ status: "active", counts: { blocked: 0, running: 1 } });
    } finally { await t.h.dispose(); }
  });
});
