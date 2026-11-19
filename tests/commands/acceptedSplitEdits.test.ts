// Tester #379: a draft edit on a group whose split was accepted is refused (requirement-already-accepted, detail
// draft-edits-closed:<n>). The CLI says that draft edits are closed and names the supported way to change the plan before
// confirm as the `next` command: since spec 2026-11-19 resplit-as-new-group, `orca requirement resplit`.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const refused = (route: string, message: string, code = "requirement-already-accepted") =>
  ({ [`POST groups/g-alpha/requirement/${route}`]: { status: 422, body: { error: { code, message, commandRevision: 6, evidenceIds: [], retryable: false } } } });
// Ruling (2026-11-19 #379-381 review): M1 -- the plan-library route names the edit between export and import (the step
// that actually changes dependsOn / targetPaths). (Was: export, then import, with no edit line.)
// Ruling (session 3ba26002, 2026-11-19, human 「这次批准改写所有必要的判据」; spec 2026-11-19 resplit-as-new-group §6): the
// way forward is now one command that splits the clarified requirement again as a new group and archives this one. (Was:
// the six plan-library commands, plan save .. group archive.) This criterion now encodes that the refusal names resplit.
const NEXT = ["orca requirement resplit g-alpha --feedback \"<what was wrong with the split>\""];

describe("a draft edit refused after accept says what changes the plan instead (#379)", () => {
  it.each([
    ["feedback", ["requirement", "feedback", "g-alpha", "--text", "x"]],
    ["edit", ["requirement", "apply-parallel", "g-alpha"]],
    ["edit", ["requirement", "add-implied-path", "g-alpha", "--task", "t", "--path", "p"]],
    ["edit", ["requirement", "narrow-path", "g-alpha", "--task", "t", "--path", "p", "--to", "p/a"]],
    ["edit", ["requirement", "drop-path", "g-alpha", "--task", "t", "--path", "p"]],
  ])("orca %s: %j", async (route, argv) => {
    const w = await world({}, refused(route, "requirement-already-accepted:draft-edits-closed:3"));
    const out = await cli(argv, w.dir);
    expect(out.code).toBe(2);
    // mutation: drop the hint from the row -> red
    expect(out.stderr).toContain("orca: the split was accepted (draft 3), so draft edits are closed; to split it again before the group is confirmed, re-split it as a new group with what was wrong");
    // mutation: drop the next from the row -> red
    for (const command of NEXT) expect(out.stderr).toContain(`orca: next: ${command}`);
    const json = await cli([...argv, "--json"], w.dir);
    expect((json.json().body as { next?: string[] }).next).toEqual(NEXT);
  });

  it("another refusal of the same rows gets no such hint", async () => {
    const w = await world({}, refused("edit", "group-state-invalid:not-clarifying", "group-state-invalid"));
    const out = await cli(["requirement", "drop-path", "g-alpha", "--task", "t", "--path", "p"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).not.toContain("draft edits are closed");
    expect(out.stderr).not.toContain("requirement resplit");
  });
});

// #379-381 review (I2): a folder project's or a multi-directory project's plan cannot go through the plan library (plan
// import refuses it: planImport.ts, dir-project-plan-import-unsupported / multi-dir-plan-import-unsupported), so for
// those the refusal named a new requirement and archiving this group, never the plan-library commands.
// Ruling (session 3ba26002, 2026-11-19, human 「这次批准改写所有必要的判据」; spec 2026-11-19 resplit-as-new-group §4): resplit
// copies a folder's or a multi-directory group's frozen fields, so every project kind gets the same next command and the
// CLI no longer reads the requirement's project. (Was: a folder/multi requirement named `orca requirement open … --project
// <key>` and `orca group archive`; a repository one the plan-library route.) This criterion now encodes that no project
// kind gets another route.
describe("every project kind's refusal names resplit (#379)", () => {
  const requirementOn = (repoId: string) => ({ "GET groups/g-alpha/requirement": { status: 200, body: {
    schema: "orca-requirement-view-v1", summary: { groupId: "g-alpha", commandRevision: 5, requirement: { roundNo: 2, draftNo: 3 } },
    requirement: { repoId }, rounds: [], drafts: [{ draftNo: 3, state: "accepted", draftHash: "d".repeat(64) }] } } });
  const projects = { "GET projects": { status: 200, body: { source: "file", projects: [
    { projectKey: "proj", name: "proj", path: "/repos/proj", controlRepoId: "repo-1" },
    { projectKey: "notes", name: "notes", path: "/folders/notes", controlRepoId: "dir-notes", kind: "dir" },
    { projectKey: "shop", name: "shop", path: "/repos/web", controlRepoId: "multi-shop", kind: "multi", dirs: [{ projectKey: "web" }, { projectKey: "api" }] },
  ] } } };
  it.each([["dir-notes"], ["multi-shop"], ["repo-1"]])("a %s requirement", async (repoId) => {
    const w = await world({}, { ...refused("edit", "requirement-already-accepted:draft-edits-closed:3"), ...requirementOn(repoId), ...projects });
    const json = await cli(["requirement", "drop-path", "g-alpha", "--task", "t", "--path", "p", "--json"], w.dir);
    expect(json.code).toBe(2);
    expect((json.json().body as { next?: string[] }).next).toEqual(NEXT);
  });
});

// #379-381 review (I1 b, M3): the draft-edit refusals that are not about accept say what to do instead.
describe("draft-edit refusals name the edit that does apply (#379-381 review)", () => {
  it("no-op-command:draft-edit-no-change says the re-validated split is the reviewed draft", async () => {
    const w = await world({}, refused("edit", "no-op-command:draft-edit-no-change", "no-op-command"));
    const out = await cli(["requirement", "drop-path", "g-alpha", "--task", "t", "--path", "p"], w.dir);
    expect(out.code).toBe(2);
    // mutation: drop the no-change hint -> the generic no-op line, red
    expect(out.stderr).toContain("orca: nothing changed: once re-validated, the edited split is the draft you reviewed");
  });

  it("apply-parallel's no-candidates refusal names drop-path", async () => {
    const w = await world({}, refused("edit", "group-state-invalid:draft-edit-no-parallel-candidates", "group-state-invalid"));
    const out = await cli(["requirement", "apply-parallel", "g-alpha"], w.dir);
    expect(out.code).toBe(2);
    // mutation: give apply-parallel the plain acceptedSplit hint -> the generic group-state-invalid line, red
    expect(out.stderr).toContain("orca requirement drop-path g-alpha --task <task> --path <file> on the one that only reads it");
  });

  it("requirement show names drop-path for a pair ordered by one file both tasks list, not for a broad overlap", async () => {
    const view = { schema: "orca-requirement-view-v1", summary: { groupId: "g-alpha", commandRevision: 5 }, rounds: [], drafts: [{
      draftNo: 2, state: "awaiting-review", layers: [["health-model"], ["health-report"]], output: { tasks: [{ taskId: "health-model" }, { taskId: "health-report" }] },
      implicitEdges: [{ from: "health-model", to: "health-report", conflicts: [{ a: "src/health/report.js", b: "src/health/report.js" }, { a: "src/**", b: "src/health/model.js" }] }] }] };
    const w = await world({}, { "GET groups/g-alpha/requirement": { status: 200, body: view } });
    const out = await cli(["requirement", "show", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the implicit-edge line from requirementShow -> red
    expect(out.stdout.split("\n").filter((line) => line.includes("requirement drop-path"))).toEqual([
      "draft 2 health-model and health-report run one after the other because both list src/health/report.js as a target path; if one of them only reads it, orca requirement drop-path <group> --task <health-model|health-report> --path src/health/report.js lets them run together",
    ]);
  });
});
