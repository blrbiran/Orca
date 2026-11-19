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
// Tester #384: a candidate is a declared edge whose pair a broad write-set overlap already orders (#268), so applying it
// keeps code's own order; an edge between disjoint write sets is the author's semantic dependency and is never listed.
// A person selects pairs; the old command dropped every candidate at once, which turned a live policy draft's semantic
// edges -- T3 -> T4a/T4b, whose CLI imports the engine -- into layer 0.
const OVERLAP = { tasks: [
  task("core", ["src/**"], []),
  task("later", ["src/later.ts"], ["core"]),
  task("more", ["src/more.ts"], ["core"]),
], notes: "" };
const dependsOn = (output: unknown) => Object.fromEntries((output as typeof OVERLAP).tasks.map((t) => [t.taskId, t.dependsOn]));
type Harness = Awaited<ReturnType<typeof requirementHarness>>;
const edit = (x: Harness, draftNo: number, change: Record<string, unknown>) =>
  x.service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo, draftHash: readDraft(x.store, "r", draftNo).draftHash, edit: change }));

describe("a person applies a split draft's parallel candidates (#284, #384)", () => {
  it("apply-parallel drops exactly the pair a person names, and makes the next draft, re-validated and awaiting review", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: OVERLAP }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      // Never auto-applied: the hint is there and draft 1 is as the model wrote it.
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ draftNo: 1, parallelCandidates: [{ before: "core", after: "later" }, { before: "core", after: "more" }] });
      // Tester #384: naming no pair drops nothing and is refused, changing nothing.
      expect(await edit(x, 1, { kind: "apply-parallel-candidates" }))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-no-pairs-selected" } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", feedback: null });
      // mutation: drop the edge filter in editedSplit -> draft 2 keeps every edge, red
      const result = await edit(x, 1, { kind: "apply-parallel-candidates", pairs: [{ before: "core", after: "more" }] });
      expect(result).toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 1, nextDraftNo: 2 } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "rejected", feedback: "person edit: dropped dependsOn core -> more (parallel candidates)" });
      const next = readDraft(x.store, "r", 2);
      // mutation: drop a pair it was not asked for -> later loses its edge too, red
      expect(dependsOn(next.output)).toEqual({ core: [], later: ["core"], more: [] });
      // Re-validated: the overlap's implicit edge still orders core before more (a layer each side), the untouched declaration
      // stays, and only that declaration is left as a candidate.
      expect(next).toMatchObject({ state: "awaiting-review", reasons: [], calls: [], layers: [["core"], ["later", "more"]] });
      expect(next.draftHash).not.toBe(readDraft(x.store, "r", 1).draftHash);
      expect(readRequirementView(x.store, "e", "r").drafts.find((d) => d.draftNo === 2)).toMatchObject({ parallelCandidates: [{ before: "core", after: "later" }] });
      // The edited draft is accepted as any other.
      const accepted = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 2, draftHash: next.draftHash }));
      expect(accepted).not.toHaveProperty("error");
    } finally { await x.dispose(); }
  });

  it("apply-parallel refuses a pair the draft does not list, both selection forms at once, and --all drops every candidate on purpose", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: OVERLAP }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(await edit(x, 1, { kind: "apply-parallel-candidates", pairs: [{ before: "later", after: "more" }] }))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-not-a-parallel-candidate:later:more" } });
      expect(await edit(x, 1, { kind: "apply-parallel-candidates", pairs: [{ before: "core", after: "later" }], all: true }))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-pairs-and-all" } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", feedback: null });
      // Ruling: the old one-shot behaviour stays, but only when asked for by name.
      // mutation: --all drops nothing (the filter ignores the selection) -> draft 2 keeps every edge, red
      expect(await edit(x, 1, { kind: "apply-parallel-candidates", all: true })).toMatchObject({ result: { nextDraftNo: 2 } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ feedback: "person edit: dropped dependsOn core -> later, core -> more (parallel candidates)" });
      expect(dependsOn(readDraft(x.store, "r", 2).output)).toEqual({ core: [], later: [], more: [] });
    } finally { await x.dispose(); }
  });

  // Ruling (2026-11-18 tester batch D): #353 (c) -- the split no longer adds the named paths, so they stay hints and the
  // manual add is the way to give them. (Was: "the split already added the named paths, so a manual add has nothing left
  // to add" -- draft 1 carried both paths and add-implied-path was refused draft-edit-not-an-implied-path.)
  it("the named paths stay hints, and add-implied-path gives each one to the task in the next draft", async () => {
    const split = { tasks: [
      task("cli", ["src/cli.js"], [], { successCondition: "src/cli.js prints the history; README.md documents the history command and CHANGELOG.md notes it." }),
      task("docs", ["README.md", "CHANGELOG.md"], []),
    ], notes: "" };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: split }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      expect((draft.output as typeof split).tasks[0]!.targetPaths).toEqual(["src/cli.js"]);
      expect(draft.implicitEdges ?? []).toEqual([]);
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ impliedPathsOutsideTargets: [
        { taskId: "cli", path: "README.md", writers: ["docs"] }, { taskId: "cli", path: "CHANGELOG.md", writers: ["docs"] },
      ] });
      expect(await edit(x, 1, { kind: "add-implied-path", taskId: "cli", path: "README.md" })).toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 1, nextDraftNo: 2 } });
      const next = readDraft(x.store, "r", 2);
      expect((next.output as typeof split).tasks[0]!.targetPaths).toEqual(["src/cli.js", "README.md"]);
      expect(next.implicitEdges?.map((edge) => [edge.from, edge.to])).toEqual([["cli", "docs"]]);
      expect(readRequirementView(x.store, "e", "r").drafts.find((d) => d.draftNo === 2)).toMatchObject({ impliedPathsOutsideTargets: [{ taskId: "cli", path: "CHANGELOG.md", writers: ["docs"] }] });
    } finally { await x.dispose(); }
  });

  it("refuses an edit that is not a listed hint, a draft the person did not read, and a stale hash -- changing nothing", async () => {
    const split = { tasks: [
      task("probe", ["src/report.md"], [], { labels: ["investigate"], successCondition: "src/report.md explains the report." }),
      task("docs", ["README.md"], []),
    ], notes: "" };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: split }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review" });
      expect(await edit(x, 1, { kind: "add-implied-path", taskId: "probe", path: "src/other.md" }))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-not-an-implied-path:probe:src/other.md" } });
      expect(await edit(x, 1, { kind: "add-implied-path", taskId: "probe", path: "README.md" }))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-not-an-implied-path:probe:README.md" } });
      const stale = await x.service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo: 1, draftHash: "0".repeat(64), edit: { kind: "apply-parallel-candidates" } }));
      expect(stale).toMatchObject({ error: { code: "plan-version-conflict" } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", feedback: null });
      expect(() => readDraft(x.store, "r", 2)).toThrow();
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

// Tester #380 (probe-health-20261118-1): the split put each sibling module in the other's targetPaths, so their write sets
// intersect and the re-validation's implicit edge (#268) ran them one after the other -- though the requirement says
// neither imports the other. apply-parallel drops only declared edges and narrow-path only narrows a claim to paths
// inside it, so nothing short of another split call could remove the stray path. drop-target-path removes one target
// path of one task; the split is re-validated as every edit's, so the implicit edge goes only when the overlap does.
const HEALTH = { tasks: [
  task("health-model", ["src/health/model.js", "test/health-model.test.js", "src/health/report.js"], [], { successCondition: "the model test passes." }),
  task("health-report", ["src/health/report.js", "test/health-report.test.js", "src/health/model.js"], [], { successCondition: "the report test passes." }),
], notes: "" };
const targetsOf = (output: unknown, taskId: string) => (output as typeof HEALTH).tasks.find((t) => t.taskId === taskId)!.targetPaths;

describe("a person drops a stray target path from a draft task (#380)", () => {
  it("drop-target-path removes exactly that path of that task, and refuses an unknown task, an unlisted path and the last path", () => {
    const dropped = editedSplit(HEALTH, { kind: "drop-target-path", taskId: "health-model", path: "src/health/report.js" });
    // mutation: filter every task's targetPaths -> health-report loses its own report.js too, red
    expect(targetsOf(dropped.output, "health-model")).toEqual(["src/health/model.js", "test/health-model.test.js"]);
    expect(targetsOf(dropped.output, "health-report")).toEqual(HEALTH.tasks[1]!.targetPaths);
    expect(dropped.note).toBe("person edit: dropped src/health/report.js from health-model's target paths");
    // The input split is not changed (the edit works on a copy).
    expect(targetsOf(HEALTH, "health-model")).toHaveLength(3);
    expect(() => editedSplit(HEALTH, { kind: "drop-target-path", taskId: "nope", path: "src/health/report.js" })).toThrow("draft-edit-not-a-target-path:nope:src/health/report.js");
    expect(() => editedSplit(HEALTH, { kind: "drop-target-path", taskId: "health-model", path: "src/other.js" })).toThrow("draft-edit-not-a-target-path:health-model:src/other.js");
    // mutation: drop the last-path refusal -> a task with no target path reaches validation, red
    const single = { tasks: [task("only", ["src/only.js"], [])], notes: "" };
    expect(() => editedSplit(single, { kind: "drop-target-path", taskId: "only", path: "src/only.js" })).toThrow("draft-edit-last-target-path:only:src/only.js");
  });

  it("multi-directory: drops the path from the write that declares it, and refuses emptying that write", () => {
    const multi = (taskId: string, writes: MultiWrite[]) => ({ taskId, title: taskId, labels: ["feature"], goal: "g", successCondition: "s", writes, dependsOn: [], traces: ["AC1"] });
    const split = { notes: "", tasks: [multi("a", [{ dir: "d1", targetPaths: ["x.js"], checks: [] }, { dir: "d2", targetPaths: ["y.js", "z.js"], checks: [] }])] };
    // mutation: drop from the task's first write -> d2 keeps y.js, red
    expect((editedSplit(split, { kind: "drop-target-path", taskId: "a", path: "y.js" }).output.tasks[0] as { writes: MultiWrite[] }).writes)
      .toEqual([{ dir: "d1", targetPaths: ["x.js"], checks: [] }, { dir: "d2", targetPaths: ["z.js"], checks: [] }]);
    const lone = { notes: "", tasks: [multi("a", [{ dir: "d1", targetPaths: ["x.js"], checks: [] }])] };
    expect(() => editedSplit(lone, { kind: "drop-target-path", taskId: "a", path: "x.js" })).toThrow("draft-edit-last-target-path:a:x.js");
  });

  it("the probe-health shape: two drops leave the sibling modules in one layer with no implicit edge", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: HEALTH }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const first = readDraft(x.store, "r", 1);
      expect(first).toMatchObject({ state: "awaiting-review", layers: [["health-model"], ["health-report"]] });
      expect(first.implicitEdges?.map((e) => [e.from, e.to])).toEqual([["health-model", "health-report"]]);
      // Nothing is dropped without the command, and apply-parallel has nothing to drop (no declared edge orders the pair).
      expect(await edit(x, 1, { kind: "apply-parallel-candidates" })).toMatchObject({ error: { message: "group-state-invalid:draft-edit-no-parallel-candidates" } });
      expect(await edit(x, 1, { kind: "drop-target-path", taskId: "health-model", path: "src/health/report.js" }))
        .toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 1, nextDraftNo: 2 } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "rejected", feedback: "person edit: dropped src/health/report.js from health-model's target paths" });
      // One stray path left: health-report still claims model.js, so the re-validation still orders the pair.
      expect(readDraft(x.store, "r", 2)).toMatchObject({ state: "awaiting-review", layers: [["health-model"], ["health-report"]] });
      expect(await edit(x, 2, { kind: "drop-target-path", taskId: "health-report", path: "src/health/model.js" }))
        .toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 2, nextDraftNo: 3 } });
      const third = readDraft(x.store, "r", 3);
      // mutation: write the edited draft with the reviewed draft's layers/implicitEdges (no re-evaluation) -> serial, red
      expect(third).toMatchObject({ state: "awaiting-review", reasons: [], calls: [], layers: [["health-model", "health-report"]], implicitEdges: [] });
      expect(targetsOf(third.output, "health-model")).toEqual(["src/health/model.js", "test/health-model.test.js"]);
      expect(targetsOf(third.output, "health-report")).toEqual(["src/health/report.js", "test/health-report.test.js"]);
      expect(third.draftHash).not.toBe(readDraft(x.store, "r", 2).draftHash);
      // A refused drop changes nothing.
      expect(await edit(x, 3, { kind: "drop-target-path", taskId: "health-model", path: "src/health/report.js" }))
        .toMatchObject({ error: { code: "group-state-invalid", message: "group-state-invalid:draft-edit-not-a-target-path:health-model:src/health/report.js" } });
      expect(readDraft(x.store, "r", 3)).toEqual(third);
      expect(() => readDraft(x.store, "r", 4)).toThrow();
      // The edited draft is accepted as any other.
      expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 3, draftHash: third.draftHash }))).not.toHaveProperty("error");
    } finally { await x.dispose(); }
  });
});

// #379-381 review (I1 c): the tester's own #380 shape -- each task's success condition names the sibling's file only to say
// it is not imported. Since #353 (c) such a path is a hint, never added by the split, so after the two drops the pair runs
// together and stays together.
const HEALTH_380 = { tasks: [
  task("health-model", ["src/health/model.js", "test/health-model.test.js", "src/health/report.js"], [], { successCondition: "the model test passes and src/health/model.js does not import src/health/report.js." }),
  task("health-report", ["src/health/report.js", "test/health-report.test.js", "src/health/model.js"], [], { successCondition: "the report test passes and src/health/report.js does not import src/health/model.js." }),
], notes: "" };

describe("drop-path on the tester's #380 split, whose success conditions name the sibling file (#379-381 review)", () => {
  it("two drops make the pair parallel; the named sibling file stays a hint and is not added back", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: HEALTH_380 }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", layers: [["health-model"], ["health-report"]] });
      expect(await edit(x, 1, { kind: "drop-target-path", taskId: "health-model", path: "src/health/report.js" })).toMatchObject({ result: { nextDraftNo: 2 } });
      expect(await edit(x, 2, { kind: "drop-target-path", taskId: "health-report", path: "src/health/model.js" })).toMatchObject({ result: { nextDraftNo: 3 } });
      const third = readDraft(x.store, "r", 3);
      // mutation: evaluateSplit adds a success condition's path again (impliedPathsOutsideTargets pushed into targetPaths)
      // -> the drop is undone, serial (or refused as no change), red
      expect(third).toMatchObject({ state: "awaiting-review", reasons: [], layers: [["health-model", "health-report"]], implicitEdges: [], impliedPathsAdded: null });
      expect(targetsOf(third.output, "health-model")).toEqual(["src/health/model.js", "test/health-model.test.js"]);
      expect(targetsOf(third.output, "health-report")).toEqual(["src/health/report.js", "test/health-report.test.js"]);
      // The sibling file each condition names is listed as a hint only.
      expect(readRequirementView(x.store, "e", "r").drafts.find((d) => d.draftNo === 3)).toMatchObject({ impliedPathsOutsideTargets: [
        { taskId: "health-model", path: "src/health/report.js", writers: ["health-report"] }, { taskId: "health-report", path: "src/health/model.js", writers: ["health-model"] },
      ] });
    } finally { await x.dispose(); }
  });
});

// #379-381 review (I1 b): an edit the re-validation undoes wrote a next draft identical to the reviewed one -- a silent
// no-op the person read as done. A path the task's goal names that the base commit lacks (src/fresh.ts; the harness has
// README.md and src/a.ts) is added back by the split's goal step (applyGoalPaths), so dropping it changes nothing.
describe("an edit that changes nothing once re-validated is refused (#379-381 review)", () => {
  it("drop-path of a goal-named new file is refused no-op-command:draft-edit-no-change, writing no draft", async () => {
    const split = { tasks: [task("make", ["src/a.ts", "src/fresh.ts"], [], { goal: "Create src/fresh.ts and use it from src/a.ts." }), task("docs", ["README.md"], [])], notes: "" };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: split }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const first = readDraft(x.store, "r", 1);
      expect(first).toMatchObject({ state: "awaiting-review", impliedPathsAdded: null });
      // mutation: drop the hash comparison in applyRequirementDraftEdit -> draft 2 is written, the same split, red
      expect(await edit(x, 1, { kind: "drop-target-path", taskId: "make", path: "src/fresh.ts" }))
        .toMatchObject({ error: { code: "no-op-command", message: "no-op-command:draft-edit-no-change" } });
      expect(readDraft(x.store, "r", 1)).toEqual(first);
      expect(() => readDraft(x.store, "r", 2)).toThrow();
      // An edit that does change the split still goes through.
      expect(await edit(x, 1, { kind: "drop-target-path", taskId: "make", path: "src/a.ts" })).toMatchObject({ result: { kind: "requirement-draft-edited", nextDraftNo: 2 } });
    } finally { await x.dispose(); }
  });
});

// Tester #379: after accept, every draft edit was refused as `group-state-invalid:not-clarifying`, which read as "wrong
// state, try later" -- while no later state takes a draft edit. Reopening an accepted split is not built: accept froze
// and queued the document's export (a commit in the target repository), imported the tasks and queued their estimate (a
// model call), so a reopen would have to undo work outside the store (spec 2026-10-02 requirement-to-split, Correction
// "tester #379, #380", item 2). The refusal now names that the split was accepted and which draft.
describe("a draft edit after the split was accepted (#379)", () => {
  it("feedback and every requirement-draft-edit are refused as requirement-already-accepted, naming the accepted draft, changing nothing", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: HEALTH }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const accepted = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash }));
      expect(accepted).toMatchObject({ result: { kind: "requirement-draft-accepted", draftNo: 1 } });
      const after = readDraft(x.store, "r", 1);
      expect(after.state).toBe("accepted");
      // mutation: drop the accepted check in reviewed() -> group-state-invalid:not-clarifying, red
      for (const change of [{ kind: "drop-target-path", taskId: "health-model", path: "src/health/report.js" }, { kind: "apply-parallel-candidates" },
        { kind: "narrow-target-path", taskId: "health-model", path: "src/health/report.js", to: ["src/health/report.js"] }]) {
        expect(await edit(x, 1, change)).toMatchObject({ error: { code: "requirement-already-accepted", message: "requirement-already-accepted:draft-edits-closed:1" } });
      }
      // mutation: drop the accepted check in applyRequirementDraftFeedback -> group-state-invalid:not-clarifying, red
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: "run them together" })))
        .toMatchObject({ error: { code: "requirement-already-accepted", message: "requirement-already-accepted:draft-edits-closed:1" } });
      expect(readDraft(x.store, "r", 1)).toEqual(after);
      expect(() => readDraft(x.store, "r", 2)).toThrow();
    } finally { await x.dispose(); }
  });
});
