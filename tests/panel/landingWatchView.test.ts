import { describe, expect, it } from "vitest";
import { groupViewSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

// Tester follow-up G §6.2 (#269): the group view carries the landing watch's record, each regression with its problem code.
describe("the group view's landing watch (#269)", { timeout: 60_000 }, () => {
  it("the group view carries the regression and its problem code", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const tip = "d".repeat(40);
      const row = t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
      const body = { ...JSON.parse(String(row.body)), landingWatch: {
        tip, at: 5, coveredRunIds: ["run-x"], commands: [{ command: "npm test", exit: "1", ms: 3, tail: "boom" }], states: { "npm test": "red" },
        regressions: [{ command: "npm test", landedTaskIds: ["a"], tip, exit: "1", tail: "boom", since: 5 }],
      } };
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
      const view = readControlGroup(t.h.store, "epoch", "g");
      expect(view.summary.landingWatch?.regressions[0]?.problem).toBe("landing-regression:npm test");
      expect(view.summary.landingWatch?.regressions[0]?.landedTaskIds).toEqual(["a"]);
      expect(groupViewSchema.safeParse(view).success).toBe(true);
    } finally { await t.h.dispose(); }
  });

  it("a group with no record carries none", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      expect(readControlGroup(t.h.store, "epoch", "g").summary).not.toHaveProperty("landingWatch");
    } finally { await t.h.dispose(); }
  });
});
