import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { expandLoopPlan } from "../../src/control/loopPlans.js";
import { readArchivedContract, readArchivedPlan } from "../../src/control/queries.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { effectivePlanTask, workBodyOf, writeTaskAmendment, type TaskAmendment } from "../../src/control/taskAmendments.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §5.1 (C5; criterion 13): a change never rewrites the archived plan (its planHash reaches the proposal,
 * the snapshot, the confirm check and estimate validity). It is a hashed amendment record, and every reader of a task's
 * original contract -- the confirm path, A2, the single-task reader and the projection -- reads the task as amended,
 * after verifying the record. A record that does not verify blocks the task; it never silently falls back.
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const loop = (taskId: string) => ({ plan: "standard", goal: `write ${taskId}`, successCondition: `${taskId} exists`, targetPaths: [taskId], checks: ["true"] });
const workBody = (h: Fixture, taskId: string): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const writeWork = (h: Fixture, taskId: string, patch: Record<string, unknown>): void => {
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...workBody(h, taskId), ...patch }), taskId);
};
/**
 * A well-formed amendment of `taskId` to `goal` (what set-task-loop writes, plan Task B2), with `over` applied. The
 * inputs are those of `from`'s recipe (by default the task's own), so a task with no recipe can be given one.
 */
function amendment(h: Fixture, taskId: string, goal: string, over: Partial<TaskAmendment> = {}, from = taskId): TaskAmendment {
  const tasks = readArchivedPlan(h.store, "g").plan.tasks;
  const archived = tasks.find((task) => task.taskId === taskId)!, source = tasks.find((task) => task.taskId === from)!;
  const repoPath = JSON.parse(archived.originalContractCanonicalJson).context.repoPath;
  const expanded = expandLoopPlan(taskId, repoPath, "standard", { ...source.loop!.inputs, goal });
  if (!expanded.ok) throw new Error(expanded.reason);
  writeCanonicalRecord(h.store, "g", expanded.hash, expanded.canonicalJson);
  return { schema: "orca-task-amendment-v1", groupId: "g", taskId, loopVersion: 1, previousContractHash: archived.originalContractHash,
    recipe: expanded.recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson, ...over };
}
/** Point `taskId`'s work item at `record`, as set-task-loop does. */
function apply(h: Fixture, taskId: string, record: TaskAmendment): void {
  const hash = writeTaskAmendment(h.store, "g", record);
  writeWork(h, taskId, { amendmentHash: hash, loopVersion: record.loopVersion, originalContractHash: record.originalContractHash, contract: { contentAddressedHash: record.originalContractHash } });
}
const confirm = async (h: Fixture) => {
  const answer = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in answer) throw new Error(JSON.stringify(answer));
};

describe("the effective contract (spec §5.1)", () => {
  it("confirms, dispatches and shows an amended task as amended, and leaves the archived plan as it was", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const archivedBefore = readArchivedPlan(h.store, "g");
      apply(h, "a", amendment(h, "a", "write a, as amended"));
      await confirm(h);
      expect(readConfirmedTaskExecution(h.store, "g", "a").contract.objective.goal).toBe("write a, as amended");
      expect(readConfirmedTaskExecution(h.store, "g", "b").contract.objective.goal).toBe("write b");
      expect(readArchivedContract(h.store, "g", "a").contract.objective.goal).toBe("write a, as amended");
      const item = readControlGroup(h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!;
      expect(item.loopPlan).toMatchObject({ amended: true, loopVersion: 1, chosenBy: "explicit" });
      expect(item.loopPlan!.summary[0]).toBe("Goal: write a, as amended");
      expect(item.objective).toEqual({ goal: "write a, as amended", successCondition: "a exists" });
      const archivedAfter = readArchivedPlan(h.store, "g");
      expect([archivedAfter.planHash, archivedAfter.canonicalJson]).toEqual([archivedBefore.planHash, archivedBefore.canonicalJson]);
    } finally { await h.dispose(); }
  });

  it("reads a task with no work row, or an unparsable one, as not amended (Drafter finding F11)", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }]);
    try {
      const archived = readArchivedPlan(h.store, "g").plan.tasks[0]!;
      expect(effectivePlanTask(h.store, "g", archived, null)).toBe(archived);
      expect(effectivePlanTask(h.store, "g", archived, [])).toBe(archived);
      expect(effectivePlanTask(h.store, "g", archived, { status: "draft" })).toBe(archived);
      expect(workBodyOf(h.store, "g", "missing")).toBeNull();
      h.store.db.prepare("UPDATE work_items SET body='{' WHERE group_id='g' AND id='a'").run();
      expect(workBodyOf(h.store, "g", "a")).toBeNull();
    } finally { await h.dispose(); }
  });

  it("refuses to store an amendment record that is not well formed", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }]);
    try {
      const record = amendment(h, "a", "x");
      expect(() => writeTaskAmendment(h.store, "g", { ...record, loopVersion: 0 })).toThrow();
      expect(() => writeTaskAmendment(h.store, "g", { ...record, originalContractHash: "not-a-hash" })).toThrow();
    } finally { await h.dispose(); }
  });

  const tampers: Array<[string, string, (h: Fixture) => void]> = [
    ["an amendment hash with no record", "a", (h) => writeWork(h, "a", { amendmentHash: "0".repeat(64) })],
    ["an amendment hash that is not a hash", "a", (h) => writeWork(h, "a", { amendmentHash: "not-a-hash" })],
    ["a record for another group", "a", (h) => apply(h, "a", amendment(h, "a", "x", { groupId: "other" }))],
    ["a record for another task", "a", (h) => apply(h, "a", amendment(h, "a", "x", { taskId: "b" }))],
    ["a loopVersion the work item does not carry", "a", (h) => { apply(h, "a", amendment(h, "a", "x")); writeWork(h, "a", { loopVersion: 2 }); }],
    ["a work item that carries no loopVersion", "a", (h) => { apply(h, "a", amendment(h, "a", "x")); writeWork(h, "a", { loopVersion: undefined }); }],
    ["a contract hash that is not the contract's", "a", (h) => apply(h, "a", amendment(h, "a", "x", { originalContractHash: "f".repeat(64) }))],
    ["a recipe that does not expand to the contract", "a", (h) => apply(h, "a", { ...amendment(h, "a", "x"), recipe: amendment(h, "a", "y").recipe })],
    // A record that is valid in every other respect -- expanded for c itself -- so only the missing recipe refuses it.
    ["an amendment of a hand-written task", "c", (h) => apply(h, "c", amendment(h, "c", "x", {}, "a"))],
  ];
  it.each(tampers)("blocks A2 and the projection for %s (criterion 13)", async (_case, taskId, tamper) => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }, { taskId: "c" }]);
    try {
      await confirm(h);
      tamper(h);
      expect(() => readConfirmedTaskExecution(h.store, "g", taskId)).toThrow(`recovery-blocked:task-amendment-invalid:${taskId}`);
      expect(() => readControlGroup(h.store, "epoch", "g")).toThrow(`recovery-blocked:task-amendment-invalid:${taskId}`);
    } finally { await h.dispose(); }
  });
});
