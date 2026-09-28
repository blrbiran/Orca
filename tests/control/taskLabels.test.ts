import { describe, expect, it } from "vitest";
import { readControlGroup, readControlSummary } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Labels and progress spec §2.4, §2.5, §4.1 and §8 R14, R19 (plan Task 3); the set-task-labels criteria are appended
 * by plan Task 4. The Mutation lines of those Tasks name the production line each `it` goes red on.
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const view = (h: Fixture) => readControlGroup(h.store, "epoch", "g");
const itemOf = (h: Fixture, taskId = "a") => view(h).workItems.find((item) => item.taskId === taskId)!;
const workBody = (h: Fixture, taskId: string): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const writeWork = (h: Fixture, taskId: string, patch: Record<string, unknown>): void => {
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...workBody(h, taskId), ...patch }), taskId);
};

describe("labels in the group view (spec §4.1, criteria L5, R19)", () => {
  it("R19: the server always gives every work item its labels, provenance and version, and every summary its completion", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }, { taskId: "b", labels: ["bug"] }]);
    try {
      const group = view(h);
      for (const item of group.workItems) {
        expect(item.labels).toBeDefined();
        expect(item.labelsProvenance).toBeDefined();
        expect(item.labelsVersion).toBeDefined();
      }
      expect(group.summary.completion).toEqual({ done: 0, total: 2 });
      expect(readControlSummary(h.store, "epoch", null).groups[0]!.completion).toEqual({ done: 0, total: 2 });
    } finally { await h.dispose(); }
  });

  it("L5: shows the plan's labels until an override exists, and an empty override as the person clearing them", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["custom:前端", "bug"] }]);
    try {
      expect(itemOf(h)).toMatchObject({ labels: ["bug", "custom:前端"], labelsProvenance: "plan", labelsVersion: 0 });
      writeWork(h, "a", { labelsOverride: [], labelsVersion: 1 });
      expect(itemOf(h)).toMatchObject({ labels: [], labelsProvenance: "operator", labelsVersion: 1 });
      writeWork(h, "a", { labelsOverride: null, labelsVersion: 2 });
      expect(itemOf(h)).toMatchObject({ labels: ["bug", "custom:前端"], labelsProvenance: "plan", labelsVersion: 2 });
    } finally { await h.dispose(); }
  });
});

describe("group completion (spec §4.1, criterion P5, §8 R14)", () => {
  it("P5: counts only completed tasks, out of the plan's task count, the same in the summary and the group view", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }, { taskId: "d" }, { taskId: "e" }]);
    try {
      writeWork(h, "a", { status: "done" });
      writeWork(h, "b", { status: "blocked" });
      writeWork(h, "c", { status: "held" });
      writeWork(h, "d", { status: "continuing" });
      // R14: a handoff work item is a work_items row too, and is not one of the plan's tasks.
      h.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES ('g','handoff-a',1,?)")
        .run(JSON.stringify({ workItemId: "handoff-a", taskId: "a", kind: "handoff", status: "done" }));
      const completion = { done: 1, total: 5 };
      expect(view(h).summary.completion).toEqual(completion);
      expect(readControlSummary(h.store, "epoch", null).groups.find((group) => group.groupId === "g")!.completion).toEqual(completion);
      expect(view(h).workItems.map((item) => item.status)).toEqual(["completed", "blocked", "held", "continuing", "draft"]);
    } finally { await h.dispose(); }
  });
});
