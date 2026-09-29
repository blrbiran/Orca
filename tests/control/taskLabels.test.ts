import { describe, expect, it } from "vitest";
import { readControlGroup, readControlSummary } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";
import { SYSTEM_LABELS } from "../../src/control/labels.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

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

const codeOf = (answer: unknown): string | undefined => (answer as { error?: { code: string } }).error?.code;

describe("set-task-labels (spec §3.1, criteria L3, L4; §8 R6-R8, R15, R16)", () => {
  it("L4: sets, clears and reverts a task's labels as three different results, each moving labelsVersion", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"] }]);
    try {
      const service = new WebControlService(h.deps);
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["perf", "custom:前端"], baseLabelsVersion: 0 })))
        .toMatchObject({ verb: "set-task-labels", result: { kind: "task-labels-set", taskId: "a", labelsVersion: 1 } });
      expect(itemOf(h)).toMatchObject({ labels: ["custom:前端", "perf"], labelsProvenance: "operator", labelsVersion: 1 });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: [], baseLabelsVersion: 1 }))).toMatchObject({ result: { labelsVersion: 2 } });
      expect(itemOf(h)).toMatchObject({ labels: [], labelsProvenance: "operator", labelsVersion: 2 });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: null, baseLabelsVersion: 2 }))).toMatchObject({ result: { labelsVersion: 3 } });
      expect(itemOf(h)).toMatchObject({ labels: ["bug"], labelsProvenance: "plan", labelsVersion: 3 });
    } finally { await h.dispose(); }
  });

  it("L4/R16: is a no-op when the result equals the labels in effect, or when there is no override to revert", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"] }, { taskId: "b" }]);
    try {
      const service = new WebControlService(h.deps);
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["bug", "bug"], baseLabelsVersion: 0 })))).toBe("no-op-command");
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: null, baseLabelsVersion: 0 })))).toBe("no-op-command");
      // A task the plan gave no labels: [] is exactly what is in effect.
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "b", { labels: [], baseLabelsVersion: 0 })))).toBe("no-op-command");
      expect(itemOf(h, "a").labelsVersion).toBe(0);
      expect(itemOf(h, "b").labelsVersion).toBe(0);
    } finally { await h.dispose(); }
  });

  it("L4/R6: refuses a stale labelsVersion under a fresh revision, and a stale revision before it looks at labels", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      const staleRevision = h.taskCommand("set-task-labels", "a", { labels: ["perf"], baseLabelsVersion: 0 });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["bug"], baseLabelsVersion: 0 }))).toMatchObject({ result: { labelsVersion: 1 } });
      expect(codeOf(service.setTaskLabels(staleRevision))).toBe("revision-conflict");
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["perf"], baseLabelsVersion: 0 })))
        .toMatchObject({ error: { code: "labels-version-conflict", retryable: false } });
      expect(itemOf(h)).toMatchObject({ labels: ["bug"], labelsVersion: 1 });
    } finally { await h.dispose(); }
  });

  it("L3: refuses a word outside the vocabulary and a 17th distinct label by name; counts after deduplication; stores NFC", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["Feature"], baseLabelsVersion: 0 })))
        .toMatchObject({ error: { code: "labels-invalid", message: "labels-invalid:Feature" } });
      const sixteen = [...SYSTEM_LABELS, ...Array.from({ length: 6 }, (_, i) => `custom:c${i}`)];
      // 17 raw items that deduplicate to 16 are accepted first, so a raw cap of 16 goes red here (M4h), not on the refusal below.
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: [...sixteen, "bug"], baseLabelsVersion: 0 })))
        .toMatchObject({ result: { labelsVersion: 1 } });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: [...sixteen, "custom:c16"], baseLabelsVersion: 1 })))
        .toMatchObject({ error: { code: "labels-invalid", message: "labels-invalid:count:17" } });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["custom:café"], baseLabelsVersion: 1 })))
        .toMatchObject({ result: { labelsVersion: 2 } });
      expect(itemOf(h).labels).toEqual(["custom:café"]);
    } finally { await h.dispose(); }
  });

  it("refuses a missing task and a work item that is not a task as work-not-found", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      h.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES ('g','handoff-a',1,?)")
        .run(JSON.stringify({ workItemId: "handoff-a", taskId: "a", kind: "handoff", status: "draft" }));
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "missing", { labels: ["bug"], baseLabelsVersion: 0 })))).toBe("work-not-found");
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "handoff-a", { labels: ["bug"], baseLabelsVersion: 0 })))).toBe("work-not-found");
    } finally { await h.dispose(); }
  });

  it("L4: replays the same commandId to the same stored answer, and applies it once", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      const once = h.taskCommand("set-task-labels", "a", { labels: ["bug"], baseLabelsVersion: 0 });
      const first = service.setTaskLabels(once);
      expect(service.setTaskLabels(once)).toEqual(first);
      expect(itemOf(h).labelsVersion).toBe(1);
    } finally { await h.dispose(); }
  });

  it("L4: works on a confirmed group and on a running one, never touching the proposal (human ruling L-2)", async () => {
    const t = await driverHarness([{ taskId: "a", labels: ["bug"] }]);
    try {
      const before = readBudgetProposal(t.h.store, "g");
      expect(before.state).toBe("confirmed");
      expect(t.service.setTaskLabels(t.h.taskCommand("set-task-labels", "a", { labels: ["perf"], baseLabelsVersion: 0 }))).toMatchObject({ result: { labelsVersion: 1 } });
      // Read before any group view: a moved proposalVersion also breaks the view's snapshot identity, which would go red first (M4b).
      expect(readBudgetProposal(t.h.store, "g").proposalVersion).toBe(before.proposalVersion);
      await t.claim();
      expect(readControlGroup(t.h.store, "epoch", "g").workItems[0]!.status).toBe("active");
      // A claim moves the task's run, not the group's own status (which the Web path leaves at "ready"), so the group's
      // running state is written the way tests/control/proposal.test.ts writes it -- the state prestart refuses (M4a).
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      group.status = "running";
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      expect(readControlGroup(t.h.store, "epoch", "g").summary.state).toBe("running");
      expect(t.service.setTaskLabels(t.h.taskCommand("set-task-labels", "a", { labels: ["perf", "test"], baseLabelsVersion: 1 }))).toMatchObject({ result: { labelsVersion: 2 } });
      const after = readBudgetProposal(t.h.store, "g");
      expect(after.proposalVersion).toBe(before.proposalVersion);
      expect(after.state).toBe("confirmed");
      expect(readControlGroup(t.h.store, "epoch", "g").workItems[0]).toMatchObject({ labels: ["perf", "test"], labelsVersion: 2 });
    } finally { await t.h.dispose(); }
  });
});
