import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { creatableAt } from "../../src/control/requirementOverview.js";
import { draftBodySchema } from "../../src/control/requirementSchemas.js";
import {
  applyGoalPaths, applyImpliedPaths, GOAL_PATH_PROBE_LIMIT, goalPathsOutsideTargets, goalPathsToProbe,
} from "../../src/control/splitImpliedPaths.js";
import { requirementViewSchema } from "../../src/control/webProtocol.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester #345: the split gave board-cli `src/cli.js` and its test, while the file it had to create, src/board/cli.js, was
// in no task's targetPaths; #265 reads only the success condition and only paths some task lists, so it saw nothing and
// the run would stop on an allowlist miss (or cram the code into src/cli.js). The goal is now read too: a file it names
// that the base commit lacks and no task covers is added to the task; one the commit has is a hint, never added (a goal
// often names a file it only reads, and a wider write set serialises tasks).
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, targetPaths: string[], goal: string, successCondition = `${taskId} is done.`, dependsOn: string[] = []) =>
  ({ ...base, taskId, title: taskId, targetPaths, goal, successCondition, checks: ["true"], dependsOn, traces: ["AC1", "AC2"] });
/** The #345 field case, as the controller framed it: board-cli's goal names a new src/board/cli.js no task lists. */
const FIELD_SPLIT = { tasks: [
  task("board-render", ["src/board/render.js", "test/board-render.test.js"], "Write the board renderer in src/board/render.js."),
  task("board-cli", ["src/cli.js", "test/board-cli.test.js"], "Create src/board/cli.js with the board add and list commands, and change src/cli.js to register them.",
    "src/cli.js registers board add and list.", ["board-render"]),
], notes: "" };

describe("a goal naming a file no task may write (#345)", () => {
  it("the field case: board-cli's goal names src/board/cli.js, which no task's targetPaths cover", () => {
    // mutation: return [] from goalPathsOutsideTargets -> red
    expect(goalPathsOutsideTargets(FIELD_SPLIT)).toEqual([{ taskId: "board-cli", path: "src/board/cli.js" }]);
  });

  it("a path some task covers -- exactly, under a listed directory, or by a <dir>/** or ** glob -- is not listed", () => {
    const goal = "Create src/board/cli.js.";
    // mutation: drop the glob shapes from coversShape (use covers alone) -> the src/board/** and ** cases are listed, red
    for (const targets of [["src/board/cli.js"], ["src/board"], ["src/board/"], ["src/board/**"], ["src/**"], ["**"]]) {
      expect(goalPathsOutsideTargets({ tasks: [task("cli", targets, goal)], notes: "" })).toEqual([]);
    }
    // Another task's cover counts as well: that task holds the path, so the goal scan leaves it alone.
    // mutation: test only the task's own targets -> cli listed, red
    expect(goalPathsOutsideTargets({ tasks: [task("cli", ["src/cli.js"], goal), task("report", ["src/**"], "Report.")], notes: "" })).toEqual([]);
  });

  it("only a whole-token concrete path counts: a directory part, an extension starting with a letter, no ./.. segment", () => {
    const goal = "Use Node.js and e.g. version 1.0/2.5; see https://example.org/docs/a.js, ../up/x.js, ./src/y.js, "
      + "src/board/*.js, src/board/, /abs/z.js and src/board/cli.js.bak. Then write src/board/cli.js.";
    // A sentence's closing dot is not part of the path; a longer path containing it is a path of its own.
    // mutation: drop the lookbehind in GOAL_PATH -> example.org/docs/a.js and abs/z.js listed, red
    // mutation: allow a digit to start the extension -> 1.0/2.5 listed, red
    // mutation: drop exactShape -> ../up/x.js and ./src/y.js listed, red
    expect(goalPathsOutsideTargets({ tasks: [task("cli", ["src/cli.js"], goal)], notes: "" })).toEqual([
      { taskId: "cli", path: "src/board/cli.js.bak" }, { taskId: "cli", path: "src/board/cli.js" },
    ]);
  });

  it("review fix: a node: specifier is not a path, and an extension is all lower or all upper case", () => {
    const goal = "Import node:fs/promises.js, then write src/board.Then add src/board/cli.js and docs/README.MD.";
    // mutation: drop `:` from the lookbehind -> fs/promises.js listed, red
    // mutation: accept a mixed-case extension -> src/board.Then listed, red
    // mutation: drop the all-upper-case branch -> docs/README.MD not listed, red
    expect(goalPathsOutsideTargets({ tasks: [task("cli", ["src/cli.js"], goal)], notes: "" })).toEqual([
      { taskId: "cli", path: "src/board/cli.js" }, { taskId: "cli", path: "docs/README.MD" },
    ]);
  });

  it("a path named twice is listed once per task; each task naming it is listed; a multi-directory draft has none", () => {
    // mutation: drop the per-task Set -> board-cli listed twice, red
    expect(goalPathsOutsideTargets({ tasks: [
      task("a", ["src/a.ts"], "Write src/new.ts, then test src/new.ts."), task("b", ["src/b.ts"], "Import src/new.ts."),
    ], notes: "" })).toEqual([{ taskId: "a", path: "src/new.ts" }, { taskId: "b", path: "src/new.ts" }]);
    // mutation: drop the multi-directory guard -> cli listed, red
    expect(goalPathsOutsideTargets({ notes: "", tasks: [{ taskId: "cli", title: "cli", labels: [], goal: "Write src/new.ts.", successCondition: "done",
      writes: [{ dir: "alpha", targetPaths: ["src/a.ts"], checks: ["true"] }], dependsOn: [], traces: ["AC1"] }] })).toEqual([]);
  });

  it("at most GOAL_PATH_PROBE_LIMIT distinct paths are looked up, in the order they were named", () => {
    const entries = Array.from({ length: GOAL_PATH_PROBE_LIMIT + 6 }, (_, i) => ({ taskId: "t", path: `src/f${i}.ts` }));
    // mutation: drop the slice -> 70 paths, red
    // mutation: drop the Set -> the duplicated first path is looked up twice, red
    const probed = goalPathsToProbe([entries[0]!, ...entries]);
    expect(probed).toHaveLength(GOAL_PATH_PROBE_LIMIT);
    expect(probed).toEqual(entries.slice(0, GOAL_PATH_PROBE_LIMIT).map((entry) => entry.path));
  });

  it("creatableAt: a new file in a directory the commit has is creatable; an existing file or a missing directory is not", async () => {
    const repo = mkdtempSync(join(tmpdir(), "orca-345-"));
    try {
      const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8" }).trim();
      g("init", "-q", "-b", "main");
      mkdirSync(join(repo, "src", "board"), { recursive: true });
      writeFileSync(join(repo, "src", "cli.js"), "export {};\n");
      writeFileSync(join(repo, "src", "board", "render.js"), "export {};\n");
      writeFileSync(join(repo, "README.md"), "# r\n");
      g("add", "-A"); g("commit", "-qm", "base");
      const commit = g("rev-parse", "HEAD");
      // src/board and src/board/cli.js asked together: git must not answer for the parent with its children (or vice versa).
      // mutation: drop `!entries.has(path)` -> src/cli.js and README.md creatable, red
      // mutation: drop the empty-parent test -> src/missing/x.js and README.md/x.js creatable, red
      // mutation: skip the root (always list a parent) -> CHANGELOG.md not creatable, red
      const got = await creatableAt(repo, commit, ["src/board/cli.js", "src/cli.js", "src/missing/x.js", "README.md", "README.md/x.js", "CHANGELOG.md", "src/board/render.js"]);
      expect([...got].sort()).toEqual(["CHANGELOG.md", "src/board/cli.js"]);
      // The field case end to end, in code: board-cli gets the file it must create, recorded as a goal addition.
      const applied = applyGoalPaths(FIELD_SPLIT, await creatableAt(repo, commit, goalPathsToProbe(goalPathsOutsideTargets(FIELD_SPLIT))));
      expect(applied.added).toEqual([{ taskId: "board-cli", path: "src/board/cli.js", writers: [], source: "goal" }]);
      expect(applied.output.tasks[1]!.targetPaths).toEqual(["src/cli.js", "test/board-cli.test.js", "src/board/cli.js"]);
      expect(goalPathsOutsideTargets(applied.output)).toEqual([]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it("review fix: creatableAt does not take a submodule (gitlink) parent for a directory", async () => {
    const repo = mkdtempSync(join(tmpdir(), "orca-345-"));
    try {
      const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8" }).trim();
      g("init", "-q", "-b", "main");
      mkdirSync(join(repo, "vendor"), { recursive: true });
      writeFileSync(join(repo, "vendor", "keep.js"), "export {};\n");
      g("add", "-A"); g("commit", "-qm", "base");
      // A gitlink entry (mode 160000) at vendor/lib, as a submodule leaves in the tree.
      g("update-index", "--add", "--cacheinfo", `160000,${g("rev-parse", "HEAD")},vendor/lib`);
      g("commit", "-qm", "submodule");
      const commit = g("rev-parse", "HEAD");
      // `ls-tree -- vendor/lib/` prints the gitlink itself, so a parent with entries is not yet a directory.
      // mutation: count a parent with any entry as a directory -> vendor/lib/new.js creatable, red
      expect([...await creatableAt(repo, commit, ["vendor/lib/new.js", "vendor/new.js"])]).toEqual(["vendor/new.js"]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it("applyGoalPaths adds only what creatable holds and exactly one task's goal names, and returns the same draft otherwise", () => {
    // mutation: drop the creatable filter -> src/old.ts added too, red
    // mutation: drop the one-task rule -> a and b both get src/shared.ts (and run serially on a guess), red
    const split = { tasks: [task("a", ["src/a.ts"], "Write src/new.ts and src/shared.ts; read src/old.ts."), task("b", ["src/b.ts"], "Import src/shared.ts.")], notes: "" };
    const applied = applyGoalPaths(split, new Set(["src/new.ts", "src/shared.ts"]));
    expect(applied.added).toEqual([{ taskId: "a", path: "src/new.ts", writers: [], source: "goal" }]);
    expect(applied.output.tasks.map((t) => t.targetPaths)).toEqual([["src/a.ts", "src/new.ts"], ["src/b.ts"]]);
    // Two goals name src/shared.ts: neither is given it; each keeps a hint.
    expect(goalPathsOutsideTargets(applied.output)).toEqual([
      { taskId: "a", path: "src/shared.ts" }, { taskId: "a", path: "src/old.ts" }, { taskId: "b", path: "src/shared.ts" },
    ]);
    expect(split.tasks[0]!.targetPaths).toEqual(["src/a.ts"]);
    const none = applyGoalPaths(split, new Set());
    expect(none.output).toBe(split);
    expect(none.added).toEqual([]);
    // A success-condition addition (#265) has no source and keeps its shape.
    expect(applyImpliedPaths({ tasks: [task("cli", ["src/cli.js"], "g", "README.md documents it."), task("docs", ["README.md"], "g")], notes: "" }).added)
      .toEqual([{ taskId: "cli", path: "README.md", writers: ["docs"] }]);
  });

  it("the draft record takes a goal addition and still takes a success-condition one; a goal addition names no writer", () => {
    const draft = { draftNo: 1, state: "awaiting-review", autoRetry: 0, waiting: null, feedback: null, output: null, plan: null, draftHash: null, reasons: [],
      layers: null, implicitEdges: null, reasonCode: null, calls: [] };
    // mutation: drop the goal branch of the union -> red
    expect(draftBodySchema.safeParse({ ...draft, impliedPathsAdded: [{ taskId: "cli", path: "src/board/cli.js", writers: [], source: "goal" }] }).success).toBe(true);
    expect(draftBodySchema.safeParse({ ...draft, impliedPathsAdded: [{ taskId: "cli", path: "README.md", writers: ["docs"] }] }).success).toBe(true);
    expect(draftBodySchema.safeParse({ ...draft, impliedPathsAdded: [{ taskId: "cli", path: "README.md", writers: [] }] }).success).toBe(false);
    expect(draftBodySchema.safeParse({ ...draft, impliedPathsAdded: [{ taskId: "cli", path: "README.md", writers: ["docs"], source: "goal" }] }).success).toBe(false);
  });

  it("the split adds a new file its goal names, and the view hints at the ones it did not add", async () => {
    // Base: README.md, src/a.ts (the harness), plus src/board/render.js and test/ committed here.
    const split = { tasks: [
      task("board-render", ["src/board/render.js"], "Write the board renderer in src/board/render.js.", "src/board/render.js renders the board."),
      task("board-cli", ["src/cli.js", "test/board-cli.test.js"], "Create src/board/cli.js with the board add and list commands, change src/cli.js to register them, and read the note format from src/a.ts.",
        "src/cli.js registers board add and list.", ["board-render"]),
      task("docs", ["README.md"], "Document the commands; src/later/plan.md is out of scope.", "README.md documents the board commands.", ["board-cli"]),
    ], notes: "" };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: split }], startAt: "split" });
    try {
      mkdirSync(join(x.repo, "src", "board"), { recursive: true });
      mkdirSync(join(x.repo, "test"), { recursive: true });
      writeFileSync(join(x.repo, "src", "board", "render.js"), "export {};\n");
      writeFileSync(join(x.repo, "test", "keep.test.js"), "\n");
      x.git("add", "-A"); x.git("commit", "-qm", "board base");
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      // mutation: drop the goal step from evaluateSplit -> impliedPathsAdded null, red
      expect(draft).toMatchObject({ state: "awaiting-review", reasons: [], impliedPathsAdded: [{ taskId: "board-cli", path: "src/board/cli.js", writers: [], source: "goal" }] });
      const cli = (draft.output as { tasks: Array<{ taskId: string; targetPaths: string[] }> }).tasks.find((t) => t.taskId === "board-cli")!;
      expect(cli.targetPaths).toEqual(["src/cli.js", "test/board-cli.test.js", "src/board/cli.js"]);
      // src/a.ts exists at base (read, not added); src/later/plan.md is under a directory the base lacks (validation would
      // refuse it as a target), so it is a hint too.
      // mutation: drop goalPathsOutsideTargets from the view -> red
      const view = readRequirementView(x.store, "e", "r");
      expect(view.drafts[0]).toMatchObject({ goalPathsOutsideTargets: [{ taskId: "board-cli", path: "src/a.ts" }, { taskId: "docs", path: "src/later/plan.md" }] });
      // mutation: drop goalPathsOutsideTargets from the protocol's draft -> strict parse fails, red
      expect(requirementViewSchema.safeParse(view).success).toBe(true);
      const accepted = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: draft.draftHash }));
      expect(accepted).not.toHaveProperty("error");
    } finally { await x.dispose(); }
  });

  it("orca requirement show prints a goal addition and a goal hint, one line each", async () => {
    const { findCommand } = await import("../../src/commands/registry.js");
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    // mutation: drop the goal branch of impliedPathAddedLine -> the success-condition wording, red
    expect(found.def.format({ drafts: [{ draftNo: 2, layers: [["cli"]], impliedPathsAdded: [{ taskId: "cli", path: "src/board/cli.js", writers: [], source: "goal" }] }] }))
      .toContain("draft 2 implied-path-added: cli now writes src/board/cli.js (its goal names it, the base commit does not have it, and no task listed it)");
    // mutation: drop the goal hint line from requirementShow -> red
    expect(found.def.format({ drafts: [{ draftNo: 3, layers: [["cli"]], goalPathsOutsideTargets: [{ taskId: "cli", path: "src/a.ts" }] }] }))
      .toContain("draft 3 goal-path-outside-targets: cli's goal names src/a.ts, which no task may write (if cli must change it, send feedback to give it the file)");
  });
});
