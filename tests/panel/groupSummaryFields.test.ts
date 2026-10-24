import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { insertClarifyingGroup } from "../../src/control/requirementRecords.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { clarifyingInput } from "../control/fixtures/requirement.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const work = (h: H, id: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)) as Record<string, unknown>;
const saveWork = (h: H, id: string, body: Record<string, unknown>) => h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(body), id);
const dispatch = (h: H) => ({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate });

/**
 * One task per category of spec §6.1: a (claimed, its run blocked), b (ready, depends on a), c (claimed, running),
 * d (done), e (ready, no dependency).
 */
async function mixed() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }, { taskId: "c" }, { taskId: "d" }, { taskId: "e" }]);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.start(h.command("start", {}));
  const first = await deliverScheduledStart(dispatch(h), "g");
  if (first.kind !== "claimed") throw new Error(JSON.stringify(first));
  const blockedRun = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(first.runId)!.body)) as Record<string, unknown>;
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...blockedRun, state: "blocked" }), first.runId);
  const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
  h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)")
    .run("scheduler-wake:g:second", "g", canonicalBytes({ groupId: "g", startRevision: revision }).toString("utf8"));
  const second = await deliverScheduledStart(dispatch(h), "g");
  if (second.kind !== "claimed") throw new Error(JSON.stringify(second));
  saveWork(h, "d", { ...work(h, "d"), status: "done" });
  return h;
}

describe("the group summary's new fields (spec §6.2)", () => {
  it("counts each task under its §6.1 category, beside completion, and names goal, branch, updatedAt and archived", async () => {
    const h = await mixed();
    try {
      const summary = readGroupSummary(h.store, "g");
      expect(summary.counts).toEqual({ idle: 1, running: 1, waiting: 1, blocked: 1, done: 1 });
      expect(summary.completion).toEqual({ done: 1, total: 5 });
      expect(summary.goal).toBe("ship");
      expect(summary.branch).toBe("orca/g");
      expect(summary.archived).toBe(false);
      const newest = h.store.db.prepare("SELECT at FROM activity WHERE group_id='g' ORDER BY seq DESC LIMIT 1").get();
      expect(newest).toBeDefined();
      expect(summary.updatedAt).toBe(Number(newest!.at));
    } finally { await h.dispose(); }
  });

  it("sends each work item's category in the group view, so the web never re-derives it", async () => {
    const h = await mixed();
    try {
      const view = readControlGroup(h.store, "epoch", "g");
      expect(Object.fromEntries(view.workItems.map((item) => [item.taskId, item.category]))).toEqual({ a: "blocked", b: "waiting", c: "running", d: "done", e: "idle" });
    } finally { await h.dispose(); }
  });

  // Spec §4.2(2): retry-task leaves the work item `ready` with currentRunId still naming the `settled-failed` run (stored
  // as retryTask.ts stores it: inactive). Only a current run stored `blocked` makes a task blocked, so the retried task
  // is idle (no dependency) and the task depending on it waits; neither is in counts.blocked.
  it("counts a retried task, whose current run is settled-failed, as idle and not blocked", async () => {
    const h = await mixed();
    try {
      const runId = String(work(h, "a").currentRunId);
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE runs SET body=?, active=0 WHERE id=?").run(JSON.stringify({ ...run, state: "settled-failed" }), runId);
      saveWork(h, "a", { ...work(h, "a"), status: "ready" });
      expect(readGroupSummary(h.store, "g").counts).toEqual({ idle: 2, running: 1, waiting: 1, blocked: 0, done: 1 });
      const view = readControlGroup(h.store, "epoch", "g");
      expect(Object.fromEntries(view.workItems.map((item) => [item.taskId, item.category]))).toEqual({ a: "idle", b: "waiting", c: "running", d: "done", e: "idle" });
    } finally { await h.dispose(); }
  });

  it("reports archived from the body's mark", async () => {
    const h = await webFixture();
    try {
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, archived: { at: 5, actor: "human" } }));
      expect(readGroupSummary(h.store, "g").archived).toBe(true);
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, archived: "yes" }));
      expect(() => readGroupSummary(h.store, "g")).toThrow(ControlError);
    } finally { await h.dispose(); }
  });

  // Scheduled flows and groups spec 2026-10-24 §13.3: the group page names the schedule that started it and why its
  // fire waits; a missing fire, or a schedule row gone, degrades to null and the id without failing the summary.
  it("carries a scheduled group's start facts and its fire's waiting reason", async () => {
    const h = await webFixture();
    try {
      expect(readGroupSummary(h.store, "g").scheduleStart).toBeUndefined();
      const slot = 1_700_000_000_000;
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, origin: { kind: "schedule", scheduleId: "sch-nightly", slot } }));
      h.store.db.prepare("INSERT INTO schedules(id,project_id,kind,revision,removed,body) VALUES ('sch-nightly','repo','group',1,0,?)").run(JSON.stringify({
        id: "sch-nightly", projectId: "repo", name: "Nightly", kind: "group", cron: "0 9 * * *", enabled: true,
        start: { kind: "group", entryId: "pl-1", sha256: "a".repeat(64), tokenLimit: 200, integration: null },
        createdBy: "owner", createdVia: "web", createdAt: 1, updatedBy: "owner", updatedVia: "web", updatedAt: 1,
        enabledBy: "owner", enabledVia: "web", enabledAt: 1,
        state: { lastSlot: null, tz: null, failureStreak: 0, paused: false, pausedReason: null },
      }));
      h.store.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body)
        VALUES ('sch-nightly',1,?,?,'waiting','limited',NULL,'g','orca-auto','schedule:sch-nightly','{}')`).run(slot, slot);
      expect(readGroupSummary(h.store, "g").scheduleStart).toEqual({ scheduleId: "sch-nightly", name: "Nightly", slot, waitingReason: "limited" });
      // A reason on a fire that is not `waiting` is no waiting reason.
      h.store.db.prepare("UPDATE schedule_fires SET outcome='started' WHERE schedule_id='sch-nightly'").run();
      expect(readGroupSummary(h.store, "g").scheduleStart).toMatchObject({ waitingReason: null });
      h.store.db.prepare("DELETE FROM schedule_fires WHERE schedule_id='sch-nightly'").run();
      expect(readGroupSummary(h.store, "g").scheduleStart).toMatchObject({ waitingReason: null });
      h.store.db.prepare("DELETE FROM schedules WHERE id='sch-nightly'").run();
      expect(readGroupSummary(h.store, "g").scheduleStart).toMatchObject({ name: "sch-nightly" });
    } finally { await h.dispose(); }
  });

  it("summarises a clarifying group with its idea as goal, its branch, no counts and no updatedAt yet", async () => {
    const h = await webFixture();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
      });
      const summary = readGroupSummary(h.store, "r");
      expect(summary).toMatchObject({ goal: clarifyingInput("r").idea, branch: "orca/r", archived: false, updatedAt: null });
      expect(summary.counts).toBeUndefined();
    } finally { await h.dispose(); }
  });

  // Issue #75 (W1, 2026-10-19): the requirement line carries the slug a round named, so the list can name a requirement
  // without reading its view; null until a round names one.
  it("carries the requirement's slug in its summary line, null before a round names one", async () => {
    const h = await webFixture();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
      });
      expect(readGroupSummary(h.store, "r").requirement?.slug).toBeNull();
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)) as { requirement: Record<string, unknown> };
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify({ ...body, requirement: { ...body.requirement, slug: "markdown-export" } }));
      expect(readGroupSummary(h.store, "r").requirement?.slug).toBe("markdown-export");
    } finally { await h.dispose(); }
  });
});
