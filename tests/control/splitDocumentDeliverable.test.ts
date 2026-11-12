/**
 * Issue #280 (full suite spec 2026-11-12 §6): the tester's docs task targeted `README.md` + `test/readme.test.js` under the
 * constraint "The deliverable is a document; change no code." and carried `npm test`; the `.js` path made it not
 * documentation-only by its paths, so #168's rule let the suite through, and the task ran the whole suite four times for 53
 * minutes with nothing it was allowed to fix. A task whose plan makes its deliverable a document (design, investigate) is
 * now judged by that plan as well as its paths. The instruction tells the model that repository-wide regression criteria
 * are group acceptance's, not one task's.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSplitPrompt, expandMultiSplitDraft, expandSplitDraft, validateMultiSplitDraft, validateSplitDraft } from "../../src/control/requirementSplit.js";
import type { MultiSplitOutput, SplitOutput } from "../../src/control/requirementSchemas.js";
import { writeTree } from "./fixtures/dirRequirement.js";

const gitIn = (dir: string, ...args: string[]): string => execFileSync("git",
  ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "-C", dir, ...args], { encoding: "utf8" }).trim();

let root = "", repo = { path: "", commit: "" };
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "orca-split-doc-")));
  const path = join(root, "repo");
  writeTree(path, {
    "package.json": JSON.stringify({ name: "d", scripts: { test: "node --test" } }), "package-lock.json": "{}\n",
    "README.md": "# d\n", "test/readme.test.js": "// reads README.md\n", "src/a.js": "module.exports = 1;\n",
  });
  gitIn(path, "init", "-q", "-b", "main"); gitIn(path, "add", "-A"); gitIn(path, "commit", "-qm", "base");
  repo = { path, commit: gitIn(path, "rev-parse", "HEAD") };
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const validate = (task: Partial<SplitOutput["tasks"][number]>) => {
  const output: SplitOutput = { notes: "", tasks: [{ taskId: "T1", title: "A", labels: ["feature"], goal: "G.", successCondition: "S.", targetPaths: ["src/a.js"], checks: ["npm test"], dependsOn: [], traces: ["AC1"], ...task }] };
  return validateSplitDraft({ output, repo: repo.path, commit: repo.commit, criterionIds: ["AC1"], adrIds: [],
    plan: expandSplitDraft(output, { targetRepo: repo.path, ccloopBin: "/bin/false", runsDir: join(root, "runs"), groupId: "r", statement: "A.", acceptanceCriteria: [{ id: "AC1", text: "a." }] }) });
};
const DOC_PATHS = ["README.md", "test/readme.test.js"];

describe("#280: a task whose deliverable is a document is held to no repository-wide suite", () => {
  it.each([
    ["loopPlan design", { loopPlan: "design" }],
    ["the doc label", { labels: ["doc"] }],
    ["the design label", { labels: ["design"] }],
  ])("%s with a .js target path and `npm test`: refused check-docs-only-suite", async (_name, plan) => {
    const out = await validate({ ...plan, targetPaths: DOC_PATHS, checks: ["test -s README.md", "npm test"] });
    // mutation: drop `documentTask ||` in docsOnlySuite -> [] (README.md + a .js path is not documentation-only) -> red
    expect(out.reasons).toEqual(["check-docs-only-suite:T1"]);
    expect(out.ok).toBe(false);
  });

  it("an investigate task with `npm test` is refused whatever its one path", async () => {
    const out = await validate({ loopPlan: "investigate", targetPaths: ["src/a.js"], checks: ["npm test"] });
    // mutation: judge `design` alone in documentDeliverable -> [] -> red
    expect(out.reasons).toEqual(["check-docs-only-suite:T1"]);
  });

  it("the same task checking only the test that reads its document is kept", async () => {
    const out = await validate({ loopPlan: "design", targetPaths: DOC_PATHS, checks: ["test -s README.md", "npm test -- test/readme.test.js"] });
    expect(out.reasons).toEqual([]);
    expect(out.ok).toBe(true);
  });

  it("a source task with the same paths and `npm test` is kept (it may repair what it breaks)", async () => {
    // mutation: count every task as a document deliverable -> check-docs-only-suite:T1 -> red
    const out = await validate({ labels: ["feature"], targetPaths: DOC_PATHS, checks: ["npm test"] });
    expect(out.reasons).toEqual([]);
  });

  it("each write of a multi-directory design task is judged too", async () => {
    const output: MultiSplitOutput = { notes: "", tasks: [{ taskId: "t", title: "t", labels: [], loopPlan: "design", goal: "G", successCondition: "S", dependsOn: [], traces: ["AC1"],
      writes: [{ dir: "main", targetPaths: DOC_PATHS, checks: ["npm test"] }] }] };
    const dirs = [{ key: "main", path: repo.path }];
    const expanded = expandMultiSplitDraft(output, { targetRepo: repo.path, ccloopBin: "/bin/false", runsDir: join(root, "runs"), groupId: "r", statement: "G", successConditions: ["S"], dirs });
    const out = await validateMultiSplitDraft({ output, plan: expanded.plan, contracts: expanded.contracts, expandReasons: expanded.reasons,
      paths: new Map([["main", repo.path]]), commits: new Map([["main", repo.commit]]), criterionIds: ["AC1"], adrIds: [] });
    // mutation: pass `false` for documentTask in validateMultiSplitDraft -> [] -> red
    expect(out.reasons).toEqual(["check-docs-only-suite:t:main"]);
  });
});

describe("#280: the instruction leaves repository-wide regression criteria to group acceptance", () => {
  for (const multi of [false, true]) {
    it(multi ? "several directories" : "one repository", () => {
      const prompt = buildSplitPrompt({ document: "d", overview: { canonicalJson: "{}", hash: "a".repeat(64) }, earlierDrafts: [], ...(multi ? { multi: true } : {}) });
      const instruction = prompt.slice(0, prompt.indexOf("\n\n<<<ORCA-DATA requirement-document "));
      // mutation: drop REGRESSION_CRITERIA_RULE from either instruction -> red
      expect(instruction).toContain("- A criterion that only asks that existing behaviour keep working across the repository (such as \"all existing tests still pass\") is checked by Orca's group acceptance, which runs the project's full-suite command, when it has one, once on the group's final tree. It is no single task's job: never trace it to a documentation or investigate task, do not add the repository-wide suite to a task's checks for it, and trace it to the tasks that change source.");
    });
  }
});
