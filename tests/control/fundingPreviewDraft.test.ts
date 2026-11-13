// Tester follow-up I, seat K (the controller's dogfood run, g-28d9b560): before a group is confirmed every task is `draft`,
// and the funding preview `orca proposal show` and `orca group confirm` print (#212) answered "a claim now funds nothing
// (task-budget-unavailable)" for each of them -- the moment a person decides to confirm -- although the independent tasks
// were then funded and ran in parallel. A task waiting for a dependency is named as such, not as a missing budget.
import { describe, expect, it } from "vitest";
import { fundingPreview } from "../../src/control/fundedAllowance.js";
import { readGroup, saveGroup } from "../../src/control/queries.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

describe("the funding preview of a group not yet confirmed (tester follow-up I, seat K)", () => {
  it("funds the draft tasks a claim could take, and names the one that waits for its dependency", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }, { taskId: "c", tokenBudget: null, dependsOn: ["a"] }],
      { tokenPolicy: "optional-v1", modelVersion: "followup-g" });
    try {
      const group = readGroup(h.store, "g");
      expect(group.status).toBe("draft");
      group.limit = { ...group.limit, tokens: 4_000_000 }; saveGroup(h.store, group);
      const rows = fundingPreview(h.store, "g", Date.now());
      // mutation K-D5: the preview's eligible statuses without draft -> every row task-budget-unavailable, red
      expect(rows.map((row) => [row.taskId, row.reason])).toEqual([["a", null], ["b", null], ["c", "dependencies-pending"]]);
      expect(rows.filter((row) => row.reason === null).every((row) => typeof row.fundableTokens === "number" && row.fundableTokens > 0)).toBe(true);
    } finally { await h.dispose(); }
  });
});
