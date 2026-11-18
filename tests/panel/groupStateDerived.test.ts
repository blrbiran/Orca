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
