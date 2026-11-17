import { describe, expect, it } from "vitest";
import { readControlOverview } from "../../src/panel/controlOverview.js";
import { readControlRecovery, readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { work } from "./fixtures/handoffHarness.js";

/**
 * Stuck-runs spec 2026-11-17 S4 (#344 supplement): a task left `held` behind a run a handoff stopped showed only as
 * `counts.blocked=1` -- recovery list, group brief's firstFailure and the recovery blockers said nothing, so the person had
 * no way to find what to run. Each now names the task, its run and the command that moves it.
 */
describe("a held task is visible where people look (stuck-runs S4)", { timeout: 60_000 }, () => {
  it("recovery list, group brief and the Overview name it once the stop is lifted, and drop it once it is retried", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "stoppable" });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      expect(await t.service.handoffStop(t.h.command("handoff-stop", {}))).not.toHaveProperty("error");
      await t.until(driver, () => t.body(runId).state === "settled-recoverable");
      expect(work(t, "a").status).toBe("held");
      // Under the stop both commands are refused (stop-mode-conflict); the stop's own state is what is next.
      expect(readControlRecovery(t.h.store, "epoch-test").heldTasks).toBeUndefined();
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toBeNull();

      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).not.toHaveProperty("error");
      expect(work(t, "a")).toMatchObject({ status: "held", currentRunId: runId });
      expect(readControlRecovery(t.h.store, "epoch-test").heldTasks).toEqual([
        { groupId: "g", taskId: "a", runId, continuable: true, next: ["orca task continue g a", "orca task retry g a"] },
      ]);
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "task-held", next: "orca task continue g a" });
      expect(readControlOverview(t.h.store, "epoch-test").steps.filter((step) => step.kind === "task-attention" && step.groupId === "g"))
        .toEqual([expect.objectContaining({ reason: "task-held", taskId: "a", runId })]);

      // The way out works and the rows go with the problem.
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      expect(readControlRecovery(t.h.store, "epoch-test").heldTasks).toBeUndefined();
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("names only task retry when the stopped run cannot be continued", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "stoppable" });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      expect(await t.service.handoffStop(t.h.command("handoff-stop", {}))).not.toHaveProperty("error");
      await t.until(driver, () => t.body(runId).state === "settled-recoverable");
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).not.toHaveProperty("error");
      // A run row with no checkpoint (no state the driver produces on its own today): nothing to continue from.
      t.h.store.transaction(() => {
        const run = t.body(runId);
        delete run.checkpointId;
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
      });
      expect(readControlRecovery(t.h.store, "epoch-test").heldTasks).toEqual([
        { groupId: "g", taskId: "a", runId, continuable: false, next: ["orca task retry g a"] },
      ]);
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "task-held", next: "orca task retry g a" });
    } finally { await t.h.dispose(); }
  });
});
