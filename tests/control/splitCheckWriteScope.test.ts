/**
 * Tester #239 (plan 2026-11-10 tester follow-up B, T4): a task's required check that names a committed test file outside
 * that task's own targetPaths cannot be fixed by the task -- ccloop's allowlist (targetPaths, unchanged) blocks the edit.
 * The split validators hand such a draft back as `check-write-scope:<taskId>:<path>` (multi: `<taskId>:<dir>:<path>`),
 * one per path, so the model widens targetPaths or narrows the check. A dependency writing the file does not make it
 * this task's to fix. A check that names no file (`npm test`, `make`) is not judged.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSplitPrompt, expandMultiSplitDraft, expandSplitDraft, explainSplitReason, validateMultiSplitDraft, validateSplitDraft } from "../../src/control/requirementSplit.js";
import type { MultiSplitOutput, SplitOutput } from "../../src/control/requirementSchemas.js";
import { writeTree } from "./fixtures/dirRequirement.js";

const gitIn = (dir: string, ...args: string[]): string => execFileSync("git",
  ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "-C", dir, ...args], { encoding: "utf8" }).trim();

let root = "", repo = "", commit = "", other = "", otherCommit = "";
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "orca-check-scope-")));
  repo = join(root, "repo"); other = join(root, "other");
  // The tester's tree at T2's base, as far as the check reaches: three of the five test files the check names are
  // committed; test/workflow-history.test.js and test/cli-workflow-run.test.js are T1's new files.
  writeTree(repo, {
    "package.json": JSON.stringify({ name: "wf", type: "module", scripts: { test: "node --test" } }),
    "src/workflow-storage.js": "", "src/workflow-edit-command.js": "", "src/workflow-query-transfer-command.js": "",
    "src/workflow-run-command.js": "", "src/workflow-scheduler.js": "", "src/workflow-history.js": "",
    "test/cli-workflow-integration.test.js": "", "test/cli-workflow.test.js": "", "test/cli-workflow-transfer.test.js": "",
  });
  writeTree(other, { "README.md": "# Other\n", "lib/b.js": "", "test/b.test.js": "" });
  for (const dir of [repo, other]) { gitIn(dir, "init", "-q", "-b", "main"); gitIn(dir, "add", "-A"); gitIn(dir, "commit", "-qm", "base"); }
  commit = gitIn(repo, "rev-parse", "HEAD"); otherCommit = gitIn(other, "rev-parse", "HEAD");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T2_CHECK = "node --test test/workflow-history.test.js test/cli-workflow-integration.test.js test/cli-workflow.test.js test/cli-workflow-run.test.js test/cli-workflow-transfer.test.js";
const T2_TARGETS = ["src/workflow-storage.js", "src/workflow-edit-command.js", "src/workflow-query-transfer-command.js", "src/workflow-run-command.js",
  "src/workflow-scheduler.js", "test/cli-workflow-integration.test.js"];
const split = (t2: Partial<SplitOutput["tasks"][number]> = {}): SplitOutput => ({
  notes: "",
  tasks: [
    // T1 also writes test/cli-workflow.test.js: a dependency's write set does not let T2 fix that file.
    { taskId: "T1", title: "History", labels: ["feature"], goal: "Record workflow history.", successCondition: "History is stored.",
      targetPaths: ["src/workflow-history.js", "test/workflow-history.test.js", "test/cli-workflow-run.test.js", "test/cli-workflow.test.js"],
      checks: ["node --test test/workflow-history.test.js"], dependsOn: [], traces: ["AC1"] },
    { taskId: "T2", title: "Commands", labels: ["feature"], goal: "Wire history into the commands.", successCondition: "The commands record history.",
      targetPaths: T2_TARGETS, checks: [T2_CHECK], dependsOn: ["T1"], traces: ["AC1"], ...t2 },
  ],
});
const criteria = [{ id: "AC1", text: "Workflows keep their history." }];
const validate = (output: SplitOutput) => validateSplitDraft({ output, repo, commit, criterionIds: ["AC1"], adrIds: [],
  plan: expandSplitDraft(output, { targetRepo: repo, ccloopBin: "/bin/false", runsDir: join(root, "runs"), groupId: "r", statement: "History.", acceptanceCriteria: criteria }) });
const scopeReasons = (reasons: readonly string[]) => reasons.filter((reason) => reason.startsWith("check-write-scope:"));

describe("a check naming a committed test file outside its task's targetPaths (#239)", () => {
  it("hands back the tester's T2 draft naming each committed file it cannot write, and only those", async () => {
    const out = await validate(split());
    expect(out.ok).toBe(false);
    // Not test/cli-workflow-integration.test.js (T2 writes it), not the two files T1 creates (not committed).
    // mutation: drop the check-write-scope loop in validateSplitDraft -> [] -> red
    expect(scopeReasons(out.reasons)).toEqual(["check-write-scope:T2:test/cli-workflow.test.js", "check-write-scope:T2:test/cli-workflow-transfer.test.js"]);
  });

  it("passes once targetPaths hold the files, as exact paths or as their directory", async () => {
    for (const widened of [[...T2_TARGETS, "test/cli-workflow.test.js", "test/cli-workflow-transfer.test.js"], [...T2_TARGETS.slice(0, 5), "test/**"]]) {
      const out = await validate(split({ targetPaths: widened }));
      expect(out.reasons).toEqual([]);
      expect(out.ok).toBe(true);
    }
  });

  it("reads the files of a chained check, normalized, and judges each task alone", async () => {
    const out = await validate(split({ checks: ["npm test && node --test ./test/cli-workflow.test.js; echo done | cat"] }));
    expect(scopeReasons(out.reasons)).toEqual(["check-write-scope:T2:test/cli-workflow.test.js"]);
  });

  it("does not judge a check that names no file", async () => {
    for (const check of ["npm test", "make"]) {
      const out = await validate(split({ checks: [check] }));
      expect(out.reasons, check).toEqual([]);
      expect(out.ok, check).toBe(true);
    }
  });

  it("explains the reason, and a revision prompt carries the explanation to the model", () => {
    const meaning = explainSplitReason("check-write-scope:T2:test/cli-workflow.test.js");
    expect(meaning).toMatch(/check names a committed test file outside the task's targetPaths/);
    const prompt = buildSplitPrompt({ document: "doc", overview: { canonicalJson: "{}", hash: "0".repeat(64) },
      earlierDrafts: [{ draftNo: 1, output: split(), feedback: null, reasons: ["check-write-scope:T2:test/cli-workflow.test.js"] } as never] });
    expect(prompt).toContain(`check-write-scope:T2:test/cli-workflow.test.js -- ${meaning}`);
  });
});

describe("the same rule per directory in a multi split (#239)", () => {
  const multi = (writes: MultiSplitOutput["tasks"][number]["writes"]): MultiSplitOutput => ({ notes: "",
    tasks: [{ taskId: "t", title: "t", labels: [], goal: "G", successCondition: "S", writes, dependsOn: [], traces: ["AC1"] }] });
  const validateMulti = (draft: MultiSplitOutput) => {
    const expanded = expandMultiSplitDraft(draft, { targetRepo: repo, ccloopBin: "/bin/false", runsDir: join(root, "runs"), groupId: "r", statement: "G",
      successConditions: ["S"], dirs: [{ key: "main", path: repo }, { key: "other", path: other }] });
    return validateMultiSplitDraft({ output: draft, plan: expanded.plan, contracts: expanded.contracts, expandReasons: expanded.reasons,
      paths: new Map([["main", repo], ["other", other]]), commits: new Map([["main", commit], ["other", otherCommit]]), criterionIds: ["AC1"], adrIds: [] });
  };

  it("names the directory and path a write's check reads but the write cannot change", async () => {
    const out = await validateMulti(multi([
      { dir: "main", targetPaths: ["src/workflow-storage.js"], checks: ["npm test"] },
      // test/cli-workflow.test.js exists only in main: a check run in other does not read main's file.
      { dir: "other", targetPaths: ["lib/b.js"], checks: ["node --test test/b.test.js test/cli-workflow.test.js"] },
    ]));
    // mutation: drop the check-write-scope loop in validateMultiSplitDraft -> [] -> red
    expect(scopeReasons(out.reasons)).toEqual(["check-write-scope:t:other:test/b.test.js"]);
    expect(explainSplitReason("check-write-scope:t:other:test/b.test.js")).toBe(explainSplitReason("check-write-scope:T2:test/b.test.js"));
  });

  it("passes when that write holds the file", async () => {
    const out = await validateMulti(multi([
      { dir: "main", targetPaths: ["src/workflow-storage.js"], checks: ["npm test"] },
      { dir: "other", targetPaths: ["lib/b.js", "test/b.test.js"], checks: ["node --test test/b.test.js"] },
    ]));
    expect(out.reasons).toEqual([]);
    expect(out.ok).toBe(true);
  });
});
