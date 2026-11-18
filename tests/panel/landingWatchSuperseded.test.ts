// Tester #371, plan 2026-11-18 tester batch D, Task V5. Once every task has landed the landing watch stops and the group
// acceptance decides the final tip (landingWatch.ts, follow-up G §6.2 A4/A5). A regression the watch recorded last before
// that never cleared: it stayed a problem on a done group and `group show` said "the watch runs again on the next landing",
// which will not come. When the acceptance has a result, the watch is marked taken over and is no longer a problem.
import { describe, expect, it } from "vitest";
import { landingWatchLines } from "../../src/commands/domains/verbs.js";
import { groupViewSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

const TIP = "d".repeat(40);
const WATCH = { tip: TIP, at: 5, coveredRunIds: ["run-x"], commands: [{ command: "npm test", exit: "1", ms: 3, tail: "boom" }], states: { "npm test": "red" },
  regressions: [{ command: "npm test", landedTaskIds: ["a"], tip: TIP, exit: "1", tail: "boom", since: 5 }] };
const ACCEPTANCE = { tip: "e".repeat(40), result: "passed", commands: [{ command: "npm test", exit: "0", ms: 4 }], at: 9 };

describe("a landing watch the group acceptance took over (#371)", { timeout: 60_000 }, () => {
  type Harness = Awaited<ReturnType<typeof driverHarness>>;
  const setWork = (t: Harness, taskId: string, status: string) => {
    const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!;
    t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status }), taskId);
  };
  const withBody = async (extra: Record<string, unknown>, tasks = ["a"]) => {
    const t = await driverHarness(tasks.map((taskId) => ({ taskId })));
    const row = t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
    t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...JSON.parse(String(row.body)), landingWatch: WATCH, ...extra }));
    return t;
  };
  const watchOf = (t: Harness) => readControlGroup(t.h.store, "epoch", "g").summary.landingWatch;

  // Ruling (2026-11-18 tester batch D review): #371 review I5 -- superseded follows the watch's own stop rule (every task
  // done or landed), not the acceptance record, so these set the tasks' state the rule reads.
  it("every task done and the acceptance has a result: the watch says supersededBy acceptance", async () => {
    const t = await withBody({ status: "done", acceptance: ACCEPTANCE }); try {
      setWork(t, "a", "done");
      const view = readControlGroup(t.h.store, "epoch", "g");
      expect(groupViewSchema.safeParse(view).success).toBe(true);
      // mutation: drop the superseded check in the summary's landingWatch -> red here
      expect(view.summary.landingWatch?.supersededBy).toBe("acceptance");
      // The record itself is unchanged: its regressions are still read, only no longer a problem.
      expect(view.summary.landingWatch?.regressions).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  // An acceptance rerun (recheck) deletes the record until the new result; the watch does not start again meanwhile.
  it("every task done and the acceptance rerunning (no record): still superseded", async () => {
    const t = await withBody({ status: "review" }); try {
      setWork(t, "a", "done");
      // mutation: superseded from the acceptance record's presence -> absent here, red
      expect(watchOf(t)?.supersededBy).toBe("acceptance");
    } finally { await t.h.dispose(); }
  });

  it("a task still to land: the regression is a problem", async () => {
    const t = await withBody({}); try {
      expect(watchOf(t)).not.toHaveProperty("supersededBy");
    } finally { await t.h.dispose(); }
  });

  // A task added after the acceptance (a review fix appends one) is landed and watched again: the acceptance record from
  // before stays, and the watch's regressions are problems again.
  it("a task added after the acceptance: the acceptance record stays, and the watch's regressions are problems again", async () => {
    const t = await withBody({ status: "review", acceptance: ACCEPTANCE }, ["a", "fix-1"]); try {
      setWork(t, "a", "done");
      // mutation: superseded from the acceptance record's presence -> superseded here, red
      expect(watchOf(t)).not.toHaveProperty("supersededBy");
      expect(watchOf(t)?.regressions.map((r) => r.problem)).toEqual(["landing-regression:npm test"]);
    } finally { await t.h.dispose(); }
  });

  it("CLI: a taken-over watch prints one line saying so, and no problem or 'runs again' line", () => {
    const watch = { supersededBy: "acceptance" as const, regressions: [{ ...WATCH.regressions[0]!, problem: "landing-regression:npm test" }] };
    const lines = landingWatchLines("g", watch);
    // mutation: drop the supersededBy branch of landingWatchLines -> the problem lines, red
    expect(lines).toEqual(["landing watch: taken over by the group acceptance (its last record had 1 regression: npm test; the acceptance on the final tip decides)"]);
    expect(landingWatchLines("g", { regressions: watch.regressions })[0]).toMatch(/^problem: landing-regression:npm test/);
  });
});
