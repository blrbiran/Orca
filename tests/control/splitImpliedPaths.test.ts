import { describe, expect, it } from "vitest";
import { buildSplitPrompt } from "../../src/control/requirementSplit.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { impliedPathsOutsideTargets } from "../../src/control/splitImpliedPaths.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester #265: the split gave README.md only to a later docs task while the CLI task's success condition asked it to
// document its new commands; the CLI run wrote README.md, stopped on `allowlist miss` and cost 8.9M tokens. Code now lists,
// as a hint that never refuses a draft, each task whose success condition names a file only another task lists, and the
// instruction tells the model to give a task every file its success condition requires it to change.
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, targetPaths: string[], successCondition: string, dependsOn: string[] = []) =>
  ({ ...base, taskId, title: taskId, targetPaths, successCondition, checks: ["true"], dependsOn, traces: ["AC1", "AC2"] });
const README_SPLIT = { tasks: [
  task("cli", ["src/cli.js"], "src/cli.js prints the history; README.md documents the history command."),
  task("docs", ["README.md"], "README.md documents every command.", ["cli"]),
], notes: "" };

describe("a success condition naming a file only another task may write (#265)", () => {
  it("names the task, the file and its only writer -- the README case", () => {
    // mutation: drop the `mentions` test (warn on every other task's path) -> docs is also listed for src/cli.js, red
    // mutation: return [] -> red
    expect(impliedPathsOutsideTargets(README_SPLIT)).toEqual([{ taskId: "cli", path: "README.md", writers: ["docs"] }]);
  });

  it("a file the task itself lists, exactly or under a directory it lists, is not listed", () => {
    // mutation: drop the own-targets cover test -> cli listed for README.md / docs/guide.md, red
    expect(impliedPathsOutsideTargets({ tasks: [
      task("cli", ["src/cli.js", "README.md"], "README.md documents the history command."),
      task("docs", ["README.md"], "README.md documents every command.", ["cli"]),
    ], notes: "" })).toEqual([]);
    expect(impliedPathsOutsideTargets({ tasks: [
      task("cli", ["src/cli.js", "docs/"], "docs/guide.md explains the history command."),
      task("guide", ["docs/guide.md"], "docs/guide.md is complete.", ["cli"]),
    ], notes: "" })).toEqual([]);
  });

  it("a word that is not a path some task lists, or a longer path that contains one, is not listed", () => {
    // `docs` and `test` are bare words another task lists; config.yaml no task lists; README.md.bak and docs/README.md
    // contain README.md but are other paths.
    // mutation: drop pathLike (bare words count) -> cli listed for docs and test, red
    // mutation: drop the lookbehind / lookahead in `mentions` -> cli listed for README.md, red
    expect(impliedPathsOutsideTargets({ tasks: [
      task("cli", ["src/cli.js"], "The docs and test pass; config.yaml is read; README.md.bak and docs/README.md are untouched."),
      task("docs", ["README.md", "docs", "test"], "README.md documents every command.", ["cli"]),
    ], notes: "" })).toEqual([]);
  });

  it("the requirement view carries it on the draft, it adds no hand-back reason, and the draft is still accepted", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: README_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      expect(draft).toMatchObject({ state: "awaiting-review", reasons: [] });
      // mutation: drop impliedPathsOutsideTargets from readRequirementView -> undefined, red
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ reasons: [], impliedPathsOutsideTargets: [{ taskId: "cli", path: "README.md", writers: ["docs"] }] });
      const accepted = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: draft.draftHash }));
      expect(accepted).not.toHaveProperty("error");
    } finally { await x.dispose(); }
  });

  it("orca requirement show prints one line per entry", async () => {
    const { findCommand } = await import("../../src/commands/registry.js");
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    const out = found.def.format({ drafts: [{ draftNo: 2, layers: [["cli"], ["docs"]], impliedPathsOutsideTargets: [{ taskId: "cli", path: "README.md", writers: ["docs"] }] }] });
    // mutation: drop the line from requirementShow -> red
    expect(out).toContain("draft 2 implied-path-outside-targets: cli mentions README.md, which only docs may write");
  });

  it("the instruction tells the model to give a task every file its success condition requires, in both forms", () => {
    const overview = { canonicalJson: "{}", hash: "b".repeat(64) };
    const rule = "- Give a task every file its `successCondition` requires it to change in its target paths (a README or document it must update included); a task cannot write a file only another task lists.";
    // mutation: drop IMPLIED_PATH_RULE from either instruction -> red
    expect(buildSplitPrompt({ document: "D.", overview, earlierDrafts: [] })).toContain(rule);
    expect(buildSplitPrompt({ document: "D.", overview, earlierDrafts: [], multi: true })).toContain(rule);
  });
});
