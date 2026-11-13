import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester follow-up K (#284, #265): the parallel-candidates and implied-path hints were display-only -- a person could
// only send feedback and pay for another split call that might or might not follow it. Now a person applies a hint
// with one command: code makes exactly that edit, re-validates the split as a model's split is validated, and the result
// is the next draft, awaiting review. Nothing is applied without the command.
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, targetPaths: string[], dependsOn: string[], extra: Record<string, unknown> = {}) =>
  ({ ...base, taskId, title: taskId, targetPaths, checks: ["true"], dependsOn, traces: ["AC1", "AC2"], ...extra });
const CHAIN = { tasks: [
  task("core", ["src/core.ts"], []),
  task("a", ["src/a.ts"], ["core"], { checks: ["grep -q core ./src/core.ts"] }),
  task("b", ["src/b.ts"], ["a"]),
  task("c", ["src/c.ts"], ["b"]),
], notes: "" };
const dependsOn = (output: unknown) => Object.fromEntries((output as typeof CHAIN).tasks.map((t) => [t.taskId, t.dependsOn]));
type Harness = Awaited<ReturnType<typeof requirementHarness>>;
const edit = (x: Harness, draftNo: number, change: Record<string, unknown>) =>
  x.service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo, draftHash: readDraft(x.store, "r", draftNo).draftHash, edit: change }));

describe("a person applies a split draft's hint (tester follow-up K)", () => {
  it("apply-parallel-candidates drops exactly the listed edges and makes the next draft, re-validated and awaiting review", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: CHAIN }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      // Never auto-applied: the hint is there and draft 1 is as the model wrote it.
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ draftNo: 1, parallelCandidates: [{ before: "a", after: "b" }, { before: "b", after: "c" }] });
      // mutation: drop the edge filter in editedSplit -> draft 2 keeps every edge, red
      const result = await edit(x, 1, { kind: "apply-parallel-candidates" });
      expect(result).toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 1, nextDraftNo: 2 } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "rejected", feedback: "person edit: dropped dependsOn a -> b, b -> c (parallel candidates)" });
      const next = readDraft(x.store, "r", 2);
      expect(dependsOn(next.output)).toEqual({ core: [], a: ["core"], b: [], c: [] });
      // Re-validated: its layers are code's, its plan and hash the new split's, and no hint is left.
      expect(next).toMatchObject({ state: "awaiting-review", reasons: [], calls: [], layers: [["b", "c", "core"], ["a"]] });
      expect(next.draftHash).not.toBe(readDraft(x.store, "r", 1).draftHash);
      expect(readRequirementView(x.store, "e", "r").drafts.find((d) => d.draftNo === 2)).toMatchObject({ parallelCandidates: [] });
      // The edited draft is accepted as any other.
      const accepted = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 2, draftHash: next.draftHash }));
      expect(accepted).not.toHaveProperty("error");
    } finally { await x.dispose(); }
  });

  it("add-implied-path adds the file to the task's targets, and the re-validation orders the two writers (#268)", async () => {
    const split = { tasks: [
      task("cli", ["src/cli.js"], [], { successCondition: "src/cli.js prints the history; README.md documents the history command and CHANGELOG.md notes it." }),
      task("docs", ["README.md", "CHANGELOG.md"], []),
    ], notes: "" };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: split }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ layers: [["cli", "docs"]], implicitEdges: [] });
      // mutation: drop the targetPaths push in editedSplit -> cli's targets unchanged, red
      expect(await edit(x, 1, { kind: "add-implied-path", taskId: "cli", path: "README.md" })).toMatchObject({ result: { kind: "requirement-draft-edited", nextDraftNo: 2 } });
      const next = readDraft(x.store, "r", 2);
      expect((next.output as typeof split).tasks[0]!.targetPaths).toEqual(["src/cli.js", "README.md"]);
      // The two write sets now intersect: the re-validation's implicit edge orders them (accept makes it a dependsOn).
      expect(next).toMatchObject({ state: "awaiting-review", reasons: [], layers: [["cli"], ["docs"]], implicitEdges: [{ from: "cli", to: "docs" }] });
      expect(readRequirementView(x.store, "e", "r").drafts.find((d) => d.draftNo === 2)).toMatchObject({ impliedPathsOutsideTargets: [{ taskId: "cli", path: "CHANGELOG.md", writers: ["docs"] }] });
      // An edited draft has no call of its own: its edit is judged at the overview of the draft it was edited from.
      // mutation: judgedRun reads only the named draft's calls -> recovery-blocked, red
      expect(await edit(x, 2, { kind: "add-implied-path", taskId: "cli", path: "CHANGELOG.md" })).toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 2, nextDraftNo: 3 } });
      expect((readDraft(x.store, "r", 3).output as typeof split).tasks[0]!.targetPaths).toEqual(["src/cli.js", "README.md", "CHANGELOG.md"]);
      expect(readRequirementView(x.store, "e", "r").drafts.find((d) => d.draftNo === 3)).toMatchObject({ impliedPathsOutsideTargets: [] });
    } finally { await x.dispose(); }
  });

  it("refuses an edit that is not a listed hint, a draft the person did not read, and a result validation refuses -- changing nothing", async () => {
    const split = { tasks: [
      // An investigate task writes exactly one file: adding README.md makes the split invalid.
      task("probe", ["src/report.md"], [], { labels: ["investigate"], successCondition: "src/report.md explains README.md." }),
      task("docs", ["README.md"], []),
    ], notes: "" };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: split }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review" });
      // mutation: take any hint (find(() => true)) in editedSplit -> README.md is added instead, refused otherwise, red
      expect(await edit(x, 1, { kind: "add-implied-path", taskId: "probe", path: "src/other.md" }))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-not-an-implied-path:probe:src/other.md" } });
      // mutation: drop the parallel-candidates emptiness test -> an identical draft 2, red
      expect(await edit(x, 1, { kind: "apply-parallel-candidates" })).toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-no-parallel-candidates" } });
      const stale = await x.service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo: 1, draftHash: "0".repeat(64), edit: { kind: "apply-parallel-candidates" } }));
      expect(stale).toMatchObject({ error: { code: "plan-version-conflict" } });
      // mutation: drop the `!evaluation.ok` refusal -> an invalid draft 2 written, red
      const refused = await edit(x, 1, { kind: "add-implied-path", taskId: "probe", path: "README.md" });
      expect(refused).toMatchObject({ error: { code: "group-state-invalid" } });
      expect((refused as { error: { message: string } }).error.message).toMatch(/^group-state-invalid:draft-edit-invalid:expand:probe:investigate-/);
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", feedback: null });
      expect(() => readDraft(x.store, "r", 2)).toThrow();
    } finally { await x.dispose(); }
  });
});
