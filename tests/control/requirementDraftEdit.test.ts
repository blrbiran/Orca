import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { editedSplit } from "../../src/control/requirementDraftEdit.js";
import { readDraft, writeDraft } from "../../src/control/requirementRecords.js";
import { WebControlService } from "../../src/control/webService.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { multiHarness } from "./fixtures/multiRequirement.js";
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

  it("multi-directory: the path goes to the task's write in the directory its writer lists it in, a new write when it has none", () => {
    const multi = (taskId: string, writes: Array<{ dir: string; targetPaths: string[]; checks: string[] }>, successCondition = "s") =>
      ({ taskId, title: taskId, labels: ["feature"], goal: "g", successCondition, writes, dependsOn: [], traces: ["AC1"] });
    const docs = multi("docs", [{ dir: "d2", targetPaths: ["README.md"], checks: ["true"] }]);
    // mutation: always append to the task's first write -> d1 gets README.md, red
    const fresh = editedSplit({ tasks: [multi("cli", [{ dir: "d1", targetPaths: ["src/cli.js"], checks: ["true"] }], "README.md lists it."), docs], notes: "" },
      { kind: "add-implied-path", taskId: "cli", path: "README.md" });
    expect((fresh.output.tasks[0] as { writes: unknown }).writes).toEqual([{ dir: "d1", targetPaths: ["src/cli.js"], checks: ["true"] }, { dir: "d2", targetPaths: ["README.md"], checks: [] }]);
    // mutation: always push a new write -> d2 twice, red
    const own = editedSplit({ tasks: [multi("cli", [{ dir: "d1", targetPaths: ["src/cli.js"], checks: ["true"] }, { dir: "d2", targetPaths: ["src/x.js"], checks: [] }], "README.md lists it."), docs], notes: "" },
      { kind: "add-implied-path", taskId: "cli", path: "README.md" });
    expect((own.output.tasks[0] as { writes: unknown }).writes).toEqual([{ dir: "d1", targetPaths: ["src/cli.js"], checks: ["true"] }, { dir: "d2", targetPaths: ["src/x.js", "README.md"], checks: [] }]);
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

// Tester follow-up L: the multi-directory edit through the real verb. The harness's members, in registered order, are the
// folder "posts" (README.md, notes/p1.md; the primary) and the repository "alpha" (README.md, src/a.ts): both have a
// README.md, so a path put in the wrong directory still exists there and only the stored write set tells the two apart.
type MultiWrite = { dir: string; targetPaths: string[]; checks: string[] };
const multiTask = (taskId: string, writes: MultiWrite[], traces: string[], extra: Record<string, unknown> = {}) =>
  ({ taskId, title: taskId, labels: [], goal: "g", successCondition: "s", writes, dependsOn: [], traces, ...extra });
/** cli writes posts' note and names README.md, which only docs writes -- in alpha. */
const MULTI_IMPLIED = { notes: "", tasks: [
  multiTask("cli", [{ dir: "posts", targetPaths: ["notes/p1.md"], checks: ["true"] }], ["AC1"], { successCondition: "notes/p1.md shows the history; README.md documents it." }),
  multiTask("docs", [{ dir: "alpha", targetPaths: ["README.md"], checks: ["true"] }], ["AC2"]),
] };
type MultiHarness = Awaited<ReturnType<typeof multiHarness>>;
const multiEdit = (x: MultiHarness, service: WebControlService, change: Record<string, unknown>, draftHash = readDraft(x.store, "r", 1).draftHash) =>
  service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo: 1, draftHash, edit: change }));
const writesOf = (output: unknown, taskId: string) => (output as { tasks: Array<{ taskId: string; writes: MultiWrite[] }> }).tasks.find((t) => t.taskId === taskId)!.writes;

describe("a multi-directory group's draft edit, re-validated end to end (tester follow-up L)", () => {
  it("binds a secondary directory's target paths to the draft hash and refuses a changed stored split", async () => {
    const x = await multiHarness({ answers: [{ purpose: "split", output: MULTI_IMPLIED }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const original = readDraft(x.store, "r", 1);
      expect(await multiEdit(x, x.service, { kind: "add-implied-path", taskId: "cli", path: "README.md" }))
        .toMatchObject({ result: { kind: "requirement-draft-edited" } });
      const edited = readDraft(x.store, "r", 2);
      // Only the non-primary alpha write changed; an old plan-only hash gives the same value for both drafts.
      expect(edited.plan).toEqual(original.plan);
      expect(edited.draftHash).not.toBe(original.draftHash);
      const tampered = structuredClone(edited.output!);
      writesOf(tampered, "cli")[1]!.targetPaths = ["src/a.ts"];
      writeDraft(x.store, "r", { ...edited, output: tampered });
      expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 2, draftHash: edited.draftHash })))
        .toMatchObject({ error: { code: "plan-version-conflict", message: "plan-version-conflict:draft-hash" } });
    } finally { await x.dispose(); }
  });

  it("shows a fresh review hash for a stored multi-directory draft made under the old plan-only rule", async () => {
    const x = await multiHarness({ answers: [{ purpose: "split", output: MULTI_IMPLIED }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const draft = readDraft(x.store, "r", 1);
      const oldHash = sha256Canonical(draft.plan);
      writeDraft(x.store, "r", { ...draft, draftHash: oldHash });
      const shown = readRequirementView(x.store, "e", "r").drafts[0]!;
      expect(shown.draftHash).not.toBe(oldHash);
      expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: oldHash })))
        .toMatchObject({ error: { code: "plan-version-conflict" } });
      expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: shown.draftHash })))
        .toMatchObject({ result: { kind: "requirement-draft-accepted" } });
    } finally { await x.dispose(); }
  });

  it("add-implied-path puts the path in the writer's directory, and the re-validation orders the two writers there", async () => {
    const x = await multiHarness({ answers: [{ purpose: "split", output: MULTI_IMPLIED }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ layers: [["cli", "docs"]], implicitEdges: [] });
      // mutation: editedSplit always appends to the task's first write -> posts:README.md (it exists there too), red
      expect(await multiEdit(x, x.service, { kind: "add-implied-path", taskId: "cli", path: "README.md" }))
        .toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 1, nextDraftNo: 2 } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "rejected", feedback: "person edit: added README.md to cli's target paths (implied path)" });
      const next = readDraft(x.store, "r", 2);
      expect(writesOf(next.output, "cli")).toEqual([{ dir: "posts", targetPaths: ["notes/p1.md"], checks: ["true"] }, { dir: "alpha", targetPaths: ["README.md"], checks: [] }]);
      expect(writesOf(next.output, "docs")).toEqual([{ dir: "alpha", targetPaths: ["README.md"], checks: ["true"] }]);
      // Re-validated as a multi split: the claim is qualified by alpha, so the two writers are ordered by an implicit edge.
      expect(next).toMatchObject({ state: "awaiting-review", reasons: [], calls: [], layers: [["cli"], ["docs"]],
        implicitEdges: [{ from: "cli", to: "docs", conflicts: [{ a: "alpha:README.md", b: "alpha:README.md" }] }] });
      // Not asserted: draft 2's draftHash differs from draft 1's. A multi draft's hash is of the expanded plan, which holds
      // only each task's primary write, so an edit that adds a non-primary write keeps the hash (reported, tester follow-up L).
      // ERRATUM (2026-11-14): the criterion above now asserts that secondary writes change a multi draft's hash.
      // The edited draft is accepted as any other.
      const accepted = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 2, draftHash: next.draftHash }));
      expect(accepted).not.toHaveProperty("error");
    } finally { await x.dispose(); }
  });

  it("refuses a multi-directory edit whose result validation refuses, storing nothing", async () => {
    const split = { notes: "", tasks: [
      // An investigate task writes exactly one file: README.md added to its alpha write makes the split invalid.
      multiTask("probe", [{ dir: "alpha", targetPaths: ["src/report.md"], checks: ["true"] }], ["AC1"], { labels: ["investigate"], successCondition: "src/report.md explains README.md." }),
      multiTask("docs", [{ dir: "alpha", targetPaths: ["README.md"], checks: ["true"] }], ["AC2"]),
      multiTask("notes", [{ dir: "posts", targetPaths: ["notes/p1.md"], checks: ["true"] }], ["AC2"]),
    ] };
    const x = await multiHarness({ answers: [{ purpose: "split", output: split }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const before = readDraft(x.store, "r", 1);
      // mutation: drop the `!evaluation.ok` refusal -> an invalid draft 2 written and draft 1 rejected, red
      const refused = await multiEdit(x, x.service, { kind: "add-implied-path", taskId: "probe", path: "README.md" });
      expect(refused).toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-invalid:expand:probe:investigate-target" } });
      expect(readDraft(x.store, "r", 1)).toEqual(before);
      expect(() => readDraft(x.store, "r", 2)).toThrow();
    } finally { await x.dispose(); }
  });

  it("refuses an edit when the draft moved between the first check and the transaction, storing nothing", async () => {
    const x = await multiHarness({ answers: [{ purpose: "split", output: MULTI_IMPLIED }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      // The seam is the service's own resolveRepository: a multi group's re-validation resolves each member through it,
      // after the first check and before the transaction (requirementDraftEdit.ts). No product code is changed for it.
      let move: (() => void) | null = null;
      const resolve = x.service.deps.resolveRepository!;
      const service = new WebControlService({ ...x.service.deps, resolveRepository: (repoId: string) => { const m = move; move = null; m?.(); return resolve(repoId); } });
      const read = readDraft(x.store, "r", 1);
      // 1. Same draft, still awaiting review, but its plan re-written (its hash moves) while the repositories are read.
      move = () => writeDraft(x.store, "r", { ...read, plan: { ...read.plan!, goal: "moved" } });
      // mutation: the transaction looks the draft up without reviewed() (readDraft by number) -> draft 2 written, red
      expect(await multiEdit(x, service, { kind: "add-implied-path", taskId: "cli", path: "README.md" }, read.draftHash))
        .toMatchObject({ error: { code: "plan-version-conflict", message: "plan-version-conflict:draft-hash" } });
      expect(readDraft(x.store, "r", 1)).toEqual({ ...read, plan: { ...read.plan!, goal: "moved" } });
      expect(() => readDraft(x.store, "r", 2)).toThrow();
      // 2. The draft superseded (rejected, a later draft awaiting review) while the repositories are read.
      writeDraft(x.store, "r", read);
      const later = { ...read, draftNo: 2 };
      move = () => { writeDraft(x.store, "r", { ...read, state: "rejected", feedback: "elsewhere" }); writeDraft(x.store, "r", later); };
      expect(await multiEdit(x, service, { kind: "add-implied-path", taskId: "cli", path: "README.md" }, read.draftHash))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-not-awaiting-review" } });
      expect(readDraft(x.store, "r", 1)).toEqual({ ...read, state: "rejected", feedback: "elsewhere" });
      expect(readDraft(x.store, "r", 2)).toEqual(later);
      expect(() => readDraft(x.store, "r", 3)).toThrow();
    } finally { await x.dispose(); }
  });
});
