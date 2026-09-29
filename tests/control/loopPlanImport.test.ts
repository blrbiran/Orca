import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { expandRecipe } from "../../src/control/loopPlans.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §3.3 (criterion 6, import half; R12): a loop task's recipe is archived inside its plan entry, so
 * planHash -- which reaches the proposal, the snapshot and the confirm check -- covers it, and the stored contract is
 * exactly the recipe's expansion. A hand-written task's entry gains no key: its archive bytes and planHash stay what
 * they were.
 */
const LOOP = { goal: "write a", successCondition: "a exists", targetPaths: ["a"], checks: ["true"] };

describe("Web import of a loop task (spec §3.3, criterion 6)", () => {
  it("archives the recipe with the task, and the stored contract is the recipe's expansion", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"], loop: LOOP }]);
    try {
      const task = readArchivedPlan(h.store, "g").plan.tasks[0]!;
      expect(task.loop).toEqual({ schema: "orca-loop-recipe-v1", planId: "bugfix", planVersion: 1, chosenBy: "labels",
        inputs: { ...LOOP, nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null } });
      const repoPath = JSON.parse(task.originalContractCanonicalJson).context.repoPath;
      expect(repoPath).toBe(join(h.root, "repo"));
      const again = expandRecipe("a", repoPath, task.loop!);
      expect(again.ok && again.canonicalJson).toBe(task.originalContractCanonicalJson);
    } finally { await h.dispose(); }
  });

  // Controller ruling P7: the self-equality `sha256Canonical(archived.plan) === archived.planHash` is dropped (it cannot
  // fail); the removal of the recipe must change the hash.
  it("puts the recipe under planHash: the same plan without it hashes differently", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: LOOP }]);
    try {
      const archived = readArchivedPlan(h.store, "g");
      const withoutRecipe = { ...archived.plan, tasks: archived.plan.tasks.map(({ loop: _loop, ...task }) => task) };
      expect(sha256Canonical(withoutRecipe)).not.toBe(archived.planHash);
    } finally { await h.dispose(); }
  });

  it("gives a hand-written task's archived entry no loop key", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try { expect(Object.keys(readArchivedPlan(h.store, "g").plan.tasks[0]!)).not.toContain("loop"); }
    finally { await h.dispose(); }
  });
});
