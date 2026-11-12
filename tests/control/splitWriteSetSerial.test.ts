import { describe, expect, it } from "vitest";
import { readArchivedPlan, readWork } from "../../src/control/queries.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester #268 / ruling §5.2.5 (write sets that intersect run serially): the split prompt promises that tasks whose target
// paths overlap are ordered by code, but on the panel path the split's implicit edges were only drawn on the draft and the
// dispatcher reads only dependsOn, so two tasks writing the same file ran at once. Accepting the draft now makes each
// implicit edge a dependency, oriented as the CLI scheduler orients it (scheduler/graph.ts).
const [exporter, images] = VALID_SPLIT.tasks;
const PARALLEL = { ...VALID_SPLIT, tasks: [exporter!, { ...images!, dependsOn: [] }, { ...images!, taskId: "styles", targetPaths: ["src/styles.ts"], dependsOn: [] }] };

describe("intersecting write sets run serially after a split is accepted (#268)", () => {
  it("a pair writing the same file gets the implicit edge as a dependency; a task writing elsewhere stays free", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: PARALLEL }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      expect(draft).toMatchObject({ state: "awaiting-review", reasons: [] });
      // The draft shows the edge (both write answer.txt) and the model declared no dependency.
      expect(draft.implicitEdges?.map((edge) => [edge.from, edge.to])).toEqual([["exporter", "images"]]);
      const answer = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: draft.draftHash! }));
      expect(answer).toMatchObject({ result: { kind: "requirement-draft-accepted" } });
      const dependsOn = (taskId: string) => (readWork(x.store, "r", taskId) as unknown as { dependsOn: string[] }).dependsOn;
      expect([dependsOn("exporter"), dependsOn("images"), dependsOn("styles")]).toEqual([[], ["exporter"], []]);
      expect(readArchivedPlan(x.store, "r").plan.tasks.map((task) => [task.taskId, task.dependencyTaskIds])).toEqual([["exporter", []], ["images", ["exporter"]], ["styles", []]]);
    } finally { await x.dispose(); }
  });

  it("a pair the model already ordered keeps its one edge", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
      expect((readWork(x.store, "r", "images") as unknown as { dependsOn: string[] }).dependsOn).toEqual(["exporter"]);
    } finally { await x.dispose(); }
  });
});
