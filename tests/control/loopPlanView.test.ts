import { describe, expect, it } from "vitest";
import { expandLoopPlan } from "../../src/control/loopPlans.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { writeTaskAmendment } from "../../src/control/taskAmendments.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §4.1 (D9, C7): the task view names its loop plan in plain words, built server-side from the recipe;
 * a hand-written task has no plan but still shows its contract's goal and success condition.
 */
const LOOP = { goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };

describe("a task's plan in the group view (spec §4.1)", () => {
  it("shows the plan, how it was chosen and its summary lines for a loop task", async () => {
    // Rewritten under human ruling H19 (2026-10-01) for loop plans v2.
    // Rewritten under human ruling H18 (2026-10-01) for panel i18n: the view carries the fields its lines are built from.
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug", "custom:x"], loop: LOOP }]);
    try {
      const recipe = readArchivedPlan(h.store, "g").plan.tasks[0]!.loop!;
      const item = readControlGroup(h.store, "epoch", "g").workItems[0]!;
      expect(item.loopPlan).toEqual({
        planId: "bugfix", planVersion: 2, chosenBy: "labels", chosenByLabel: "bug",
        amended: false, loopVersion: 0, inputs: recipe.inputs, maxFiles: Number.MAX_SAFE_INTEGER, hasDiscipline: true,
      });
      expect(item.objective).toEqual({ goal: "fix login", successCondition: "the login test passes" });
    } finally { await h.dispose(); }
  });

  it("names no label for a plan the plan file named", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"], loop: { ...LOOP, plan: "standard" } }]);
    try {
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ planId: "standard", chosenBy: "explicit", chosenByLabel: null });
    } finally { await h.dispose(); }
  });

  // Spec §5.1: the work item's amendmentHash and loopVersion are what the card reports as "changed" and what
  // set-task-loop must name. The projection reads the task through its verified amendment (plan Task B1), so the work
  // item points at a real record here, written directly as set-task-loop would.
  it("reports a work item's amendment and loop version", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: { ...LOOP, plan: "standard" } }]);
    try {
      const archived = readArchivedPlan(h.store, "g").plan.tasks[0]!;
      const expanded = expandLoopPlan("a", JSON.parse(archived.originalContractCanonicalJson).context.repoPath, "standard", { ...archived.loop!.inputs, goal: "fix login, as amended" });
      if (!expanded.ok) throw new Error(expanded.reason);
      writeCanonicalRecord(h.store, "g", expanded.hash, expanded.canonicalJson);
      const amendmentHash = writeTaskAmendment(h.store, "g", { schema: "orca-task-amendment-v1", groupId: "g", taskId: "a", loopVersion: 2,
        previousContractHash: archived.originalContractHash, recipe: expanded.recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson });
      const row = h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
      const body = { ...JSON.parse(String(row.body)), amendmentHash, loopVersion: 2, originalContractHash: expanded.hash, contract: { contentAddressedHash: expanded.hash } };
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(body));
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ amended: true, loopVersion: 2 });
    } finally { await h.dispose(); }
  });

  it("shows a hand-written task as no plan, with its contract's goal and success condition", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const item = readControlGroup(h.store, "epoch", "g").workItems[0]!;
      expect(item.loopPlan).toBeNull();
      expect(item.objective).toEqual({ goal: "ship", successCondition: "passes" });
    } finally { await h.dispose(); }
  });
});
