/**
 * Tester issue #130 (Orca session f958ec3f, 2026-11-11): a rule the split instruction states (NO_LOCKFILE_RULE) that a
 * model sometimes ignores. Each ignored rule was a guaranteed failed paid run, so code now hands such a draft back with a
 * reason the next draft is told the meaning of:
 * - #130 `setup-lockfile:<task>:<command>`: `npm ci`, or an `npm install` / `npm i` that would write package-lock.json,
 *   in a repository whose root commits no package-lock.json or npm-shrinkwrap.json (npm ci fails; ccloop refuses a setup
 *   that changes non-ignored files).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSplitPrompt, expandSplitDraft, explainSplitReason, validateSplitDraft } from "../../src/control/requirementSplit.js";
import type { SplitOutput } from "../../src/control/requirementSchemas.js";
import { writeTree } from "./fixtures/dirRequirement.js";

const gitIn = (dir: string, ...args: string[]): string => execFileSync("git",
  ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "-C", dir, ...args], { encoding: "utf8" }).trim();

let root = "";
const repos: Record<"esm" | "cjs" | "shrinkwrap", { path: string; commit: string }> = { esm: { path: "", commit: "" }, cjs: { path: "", commit: "" }, shrinkwrap: { path: "", commit: "" } };
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "orca-split-rules-")));
  const trees: Record<keyof typeof repos, Record<string, string>> = {
    // An ES module package with no lockfile: the tester's #130 and #135 repository.
    esm: { "package.json": JSON.stringify({ name: "esm", type: "module", scripts: { test: "node --test" } }), "src/a.js": "export const a = 1;\n" },
    // A CommonJS package (no "type") with package-lock.json.
    cjs: { "package.json": JSON.stringify({ name: "cjs", scripts: { test: "node --test" } }), "package-lock.json": "{}\n", "src/a.js": "module.exports = 1;\n" },
    // An explicit "type": "commonjs" package whose only npm lockfile is npm-shrinkwrap.json.
    shrinkwrap: { "package.json": JSON.stringify({ name: "sw", type: "commonjs", scripts: { test: "node --test" } }), "npm-shrinkwrap.json": "{}\n", "src/a.js": "" },
  };
  for (const key of Object.keys(repos) as Array<keyof typeof repos>) {
    const path = join(root, key);
    writeTree(path, trees[key]);
    gitIn(path, "init", "-q", "-b", "main"); gitIn(path, "add", "-A"); gitIn(path, "commit", "-qm", "base");
    repos[key] = { path, commit: gitIn(path, "rev-parse", "HEAD") };
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const draft = (task: Partial<SplitOutput["tasks"][number]> = {}): SplitOutput => ({
  notes: "",
  tasks: [{ taskId: "T1", title: "A", labels: ["feature"], goal: "Change a.", successCondition: "a changed.", targetPaths: ["src/a.js"], checks: ["npm test"], dependsOn: [], traces: ["AC1"], ...task }],
});
const validate = (key: keyof typeof repos, output: SplitOutput) => validateSplitDraft({ output, repo: repos[key].path, commit: repos[key].commit, criterionIds: ["AC1"], adrIds: [],
  plan: expandSplitDraft(output, { targetRepo: repos[key].path, ccloopBin: "/bin/false", runsDir: join(root, "runs"), groupId: "r", statement: "A.", acceptanceCriteria: [{ id: "AC1", text: "a changes." }] }) });

describe("#130: an npm setup that needs or writes a lockfile, in a repository without one", () => {
  it("hands back npm ci, npm install and npm i where the root commits no npm lockfile", async () => {
    for (const command of ["npm ci", "npm install", "npm i", "CI=1 npm ci --silent", "npm install && npm run build"]) {
      const out = await validate("esm", draft({ setup: [command] }));
      // mutation: drop the setup-lockfile loop in validateSplitDraft -> no reason -> red
      expect(out.reasons, command).toEqual([`setup-lockfile:T1:${command}`]);
      expect(out.ok, command).toBe(false);
    }
  });

  it("accepts a lockfile-free install there, and a setup that is not npm", async () => {
    for (const command of ["npm install --no-package-lock", "npm i --package-lock=false", "pip install -r requirements.txt"]) {
      const out = await validate("esm", draft({ setup: [command] }));
      // mutation: drop the --no-package-lock exemption -> setup-lockfile:T1:npm install --no-package-lock -> red
      expect(out.reasons, command).toEqual([]);
      expect(out.ok, command).toBe(true);
    }
  });

  it("does not judge a command that installs somewhere other than the root", async () => {
    // The lockfile that matters is in that other directory, which this rule does not read.
    for (const command of ["cd tools && npm ci", "npm ci --prefix tools"]) {
      const out = await validate("esm", draft({ setup: [command] }));
      // mutation: drop the elsewhere() skip -> setup-lockfile:T1:<command> -> red
      expect(out.reasons, command).toEqual([]);
    }
  });

  it("accepts npm ci where the root commits package-lock.json or npm-shrinkwrap.json", async () => {
    for (const key of ["cjs", "shrinkwrap"] as const) {
      const out = await validate(key, draft({ setup: ["npm ci"] }));
      // mutation: make the lockfile predicate always false -> setup-lockfile:T1:npm ci -> red
      expect(out.reasons, key).toEqual([]);
      expect(out.ok, key).toBe(true);
    }
  });
});

describe("the meanings the next draft is told", () => {
  it("explains each new reason, and a revision prompt carries the explanation", () => {
    const reasons = ["setup-lockfile:T1:npm ci"];
    for (const reason of reasons) expect(explainSplitReason(reason), reason).not.toBeNull();
    expect(explainSplitReason("setup-lockfile:T1:npm ci")).toMatch(/--no-package-lock/);
    const prompt = buildSplitPrompt({ document: "doc", overview: { canonicalJson: "{}", hash: "0".repeat(64) },
      earlierDrafts: [{ draftNo: 1, output: draft(), feedback: null, reasons } as never] });
    for (const reason of reasons) expect(prompt).toContain(`${reason} -- ${explainSplitReason(reason)}`.replaceAll("\"", "\\\""));
  });
});
