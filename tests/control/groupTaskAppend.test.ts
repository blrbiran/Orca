import { describe, expect, it } from "vitest";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { appendConfirmedTaskInTransaction } from "../../src/control/groupTaskAppend.js";
import { readArchivedContract, readWork } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Tester follow-up G spec §3.4 groundwork (human: 「自动在同一组里开一个修复任务」): a task appended to a confirmed group
 * reads back from the confirmed snapshot like any task, every earlier task still does, the group view still reads, and
 * the driver claims and lands it on the group branch.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const fixContract = (t: Harness) => {
  const base = structuredClone(readArchivedContract(t.h.store, "g", "a").contract);
  return { ...base, objective: { ...base.objective, taskId: "fix-1", goal: "fix what the review found" }, context: { ...base.context, targetPaths: ["fix-1"] } };
};
const append = (t: Harness) => {
  const grant = (readWork(t.h.store, "g", "a") as unknown as { grant: { work: never; handoff: never } }).grant;
  return t.h.store.transaction(() => appendConfirmedTaskInTransaction(t.h.store, "g", { taskId: "fix-1", contract: fixContract(t) as never, agentFrom: "a", work: grant.work, handoff: grant.handoff, dependsOn: ["a"] }));
};
async function doneA(): Promise<Harness> {
  const t = await driverHarness([{ taskId: "a" }]);
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
  return t;
}

describe("append a task to a confirmed group (tester follow-up G §3.4)", () => {
  it("an appended task reads back from the confirmed snapshot and every earlier task still does", async () => {
    const t = await doneA();
    try {
      append(t);
      // mutation M7a: skip the snapshot agents.tasks append -> recovery-blocked, red
      expect(readConfirmedTaskExecution(t.h.store, "g", "fix-1").contract.objective.taskId).toBe("fix-1");
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.objective.taskId).toBe("a");
      const view = readControlGroup(t.h.store, "epoch", "g");
      expect(view.workItems.map((item) => item.taskId)).toEqual(["a", "fix-1"]);
    } finally { await t.h.dispose(); }
  }, 60000);

  it("the driver claims and lands the appended task", async () => {
    const t = await doneA();
    try {
      append(t);
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      // mutation M7b: leave the work item blocked -> no claim, red
      expect(delivered.kind).toBe("claimed");
      const runId = (delivered as { runId: string }).runId;
      expect(t.body(runId).taskId).toBe("fix-1");
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect((readWork(t.h.store, "g", "fix-1") as { status: string }).status).toBe("done");
      expect(git(t.repo, "show", "refs/heads/orca/g:fix-1")).toBe("fix-1");
    } finally { await t.h.dispose(); }
  }, 60000);

  it("appending while a run is active is refused", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]);
    try {
      await t.claim();
      expect(() => append(t)).toThrow(/recovery-blocked/);
      expect(t.h.store.db.prepare("SELECT 1 FROM work_items WHERE group_id='g' AND id='fix-1'").get()).toBeUndefined();
    } finally { await t.h.dispose(); }
  }, 60000);
});
