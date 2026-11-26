// Tester #361/#376, plan 2026-11-18 tester batch D, Task V2. A Web start keeps the stored status `ready` through the first
// run (webService.ts, by design), so the summary said `ready` while tasks ran. And a task whose run had landed but was
// still waiting for its settle counted as `running` with `done` at 0. The summary now derives what it shows; the stored
// status (which the dispatch guards read) is left alone and shown beside it.
import { describe, expect, it } from "vitest";
import { groupSummarySchema } from "../../src/control/webProtocol.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ taskId: `t${i}` }));

describe("a group's shown state follows its work (#361 #376)", { timeout: 60_000 }, () => {
  it("2 of 7 tasks claimed on a Web-started group: state running, stored state ready; a dispatch still claims", async () => {
    const t = await driverHarness(ids(7)); try {
      await t.claim(); await t.claim();
      const stored = String(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).status);
      expect(stored).toBe("ready");
      const summary = readGroupSummary(t.h.store, "g");
      expect(groupSummarySchema.safeParse(summary).success).toBe(true);
      // mutation: drop the derivation (state: body.status) -> red here
      expect(summary.state).toBe("running");
      expect(summary.storedState).toBe("ready");
      expect(summary.counts?.running).toBe(2);
      // The guards read the stored status (DISPATCHABLE_GROUP_STATES, prestart): the derived word changes nothing there.
      await expect(t.claim()).resolves.toEqual(expect.any(String));
      expect(readGroupSummary(t.h.store, "g").counts?.running).toBe(3);
    } finally { await t.h.dispose(); }
  });

  it("a group with nothing under way keeps its stored state and carries no storedState", async () => {
    const t = await driverHarness(ids(2)); try {
      const summary = readGroupSummary(t.h.store, "g");
      expect(summary.state).toBe("ready");
      expect(summary).not.toHaveProperty("storedState");
    } finally { await t.h.dispose(); }
  });

  it("a group with blocked work and nothing active is shown blocked, not running", async () => {
    const t = await driverHarness(ids(2)); try {
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...group, status: "running" }));
      for (const [taskId, status] of [["t0", "done"], ["t1", "blocked"]]) {
        const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!;
        const work = JSON.parse(String(row.body));
        t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...work, status }), taskId);
      }
      const summary = readGroupSummary(t.h.store, "g");
      expect(summary.counts).toMatchObject({ running: 0, waiting: 0, idle: 0, blocked: 1, done: 1 });
      // Mutation: keep the stored `running` word when all work is blocked or done -> this assertion fails.
      expect(summary.state).toBe("blocked");
      expect(summary.storedState).toBe("running");
    } finally { await t.h.dispose(); }
  });

  // #361 review (I4): only a task under way derives `running`. A start queued with nothing claimed keeps the stored word;
  // executionPending already says a start is queued (and an archived group with a queued start read `running` before).
  it("a start queued with nothing claimed yet: state stays ready, executionPending says the start is queued", async () => {
    const t = await driverHarness(ids(2)); try {
      expect(await t.service.start(t.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const summary = readGroupSummary(t.h.store, "g");
      expect(summary.executionPending).toBe(true);
      // mutation: derive running from executionPending again -> "running", red here
      expect(summary.state).toBe("ready");
      expect(summary).not.toHaveProperty("storedState");
    } finally { await t.h.dispose(); }
  });

  // Tester #419/#370: an archived group's stored status is not what it is now. The summary's shown state has to say
  // `archived` too, or `group list --json --fields state` reports it as ready/running while the text says archived.
  it("an archived group's shown state is archived and its stored state stays beside it", async () => {
    const t = await driverHarness(ids(2)); try {
      const row = t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, archived: { at: Date.now(), actor: "tester" } }));
      const summary = readGroupSummary(t.h.store, "g");
      expect(groupSummarySchema.safeParse(summary).success).toBe(true);
      expect(summary.archived).toBe(true);
      // mutation: keep state: body.status for an archived group -> "ready", red here
      expect(summary.state).toBe("archived");
      expect(summary.storedState).toBe("ready");
    } finally { await t.h.dispose(); }
  });

  it("a closed group's shown state is closed", async () => {
    const t = await driverHarness(ids(2)); try {
      const row = t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, archived: { at: Date.now(), actor: "tester", kind: "closed" } }));
      const summary = readGroupSummary(t.h.store, "g");
      expect(groupSummarySchema.safeParse(summary).success).toBe(true);
      expect(summary.state).toBe("closed");
      expect(summary.storedState).toBe("ready");
    } finally { await t.h.dispose(); }
  });

  it("a task whose run landed and waits for its settle counts as settling, not running; done is unchanged", async () => {
    const t = await driverHarness(ids(2)); try {
      const runId = await t.claim();
      const run = t.body(runId);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, state: "landed" }), runId);
      const summary = readGroupSummary(t.h.store, "g");
      expect(groupSummarySchema.safeParse(summary).success).toBe(true);
      // mutation: count a landed run's task as running -> red here
      expect(summary.counts).toMatchObject({ settling: 1, running: 0, done: 0, idle: 1 });
      expect(summary.completion).toEqual({ done: 0, total: 2 });
      // Still under way: the shown state is running.
      expect(summary.state).toBe("running");
    } finally { await t.h.dispose(); }
  });

  it("no task settling: counts carry no settling key", async () => {
    const t = await driverHarness(ids(2)); try {
      await t.claim();
      expect(readGroupSummary(t.h.store, "g").counts).toEqual({ idle: 1, running: 1, waiting: 0, blocked: 0, done: 0 });
    } finally { await t.h.dispose(); }
  });
});
