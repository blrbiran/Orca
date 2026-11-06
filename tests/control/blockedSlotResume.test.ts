import { describe, expect, it } from "vitest";
import { runningGroupIds } from "../../src/control/orchestration.js";
import { driverHarness } from "./fixtures/driverHarness.js";

describe("a terminal blocked run waiting for an explicit remedy (#172)", { timeout: 60_000 }, () => {
  it("does not hold a group slot or create a consumed idle wake when its pause is lifted", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "exhausted" });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active).toBe(1);
      expect(runningGroupIds(t.h.store)).not.toContain("g");
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).not.toHaveProperty("error");
      expect(await t.service.resumeDispatch(t.h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "resumed", operation: "resume-dispatch", waitingOn: "blocked-task" } });
      expect(t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").all()).toEqual([]);
      expect(runningGroupIds(t.h.store)).not.toContain("g");
    } finally { await t.h.dispose(); }
  });

  it("still counts a starting work run as executing", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }]);
    try {
      await t.claim();
      expect(runningGroupIds(t.h.store)).toContain("g");
    } finally { await t.h.dispose(); }
  });

  it("retires an earlier undelivered start wake when the live run later becomes blocked", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "exhausted" });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).not.toHaveProperty("error");
      // Pause keeps an already armed start wake. Reopen the historical wake to model a prior resume's pending delivery.
      t.h.store.db.prepare("UPDATE scheduler_wakes SET delivered=0 WHERE id=(SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' ORDER BY rowid DESC LIMIT 1)").run();
      const pending = () => t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").all();
      expect(pending().length).toBeGreaterThan(0);
      expect(await t.service.resumeDispatch(t.h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "resumed", waitingOn: "blocked-task" } });
      expect(pending()).toEqual([]);
      expect(runningGroupIds(t.h.store)).not.toContain("g");
    } finally { await t.h.dispose(); }
  });
});
