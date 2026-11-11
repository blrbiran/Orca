/**
 * Tester issues #130, #135 and #136 (Orca session f958ec3f, 2026-11-11): rules the split instruction states
 * (NO_LOCKFILE_RULE, CHECK_SOURCE_RULE, NO_VERIFY_ONLY_RULE) that a model sometimes ignores. Each ignored rule was a guaranteed failed paid run, so code now
 * hands such a draft back with a reason the next draft is told the meaning of:
 * - #130 `setup-lockfile:<task>:<command>`: `npm ci`, or an `npm install` / `npm i` that would write package-lock.json,
 *   in a repository whose root commits no package-lock.json or npm-shrinkwrap.json (npm ci fails; ccloop refuses a setup
 *   that changes non-ignored files).
 * - #135 `check-module-system:<task>` (multi: `<task>:<dir>`): a `node -e/--eval/-p` check calling `require(` where the
 *   package.json at that directory's root says `"type": "module"`.
 * - #136 `check-git-state:<task>` (multi: `<task>:<dir>`): a check reading history or the diff instead of the delivered
 *   files (`git diff --name-only`, `git diff --stat`, `git rev-parse`, `git log`); `git diff --exit-code` stays allowed.
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

describe("#135: a node -e check that require()s in an ES module package", () => {
  const REQUIRE_CHECKS = [
    "node -e \"const { a } = require('./src/a.js'); if (a !== 2) process.exit(1)\"",
    "node --eval \"require('./src/a.js')\"",
    "node -p 'require(\"./src/a.js\").a'",
  ];
  it("hands it back where the root package.json says type module", async () => {
    for (const check of REQUIRE_CHECKS) {
      const out = await validate("esm", draft({ checks: [check] }));
      // mutation: drop the check-module-system push in validateSplitDraft -> [] -> red
      expect(out.reasons, check).toEqual(["check-module-system:T1"]);
    }
  });

  it("accepts the same checks in a CommonJS package, and an import() check in the module package", async () => {
    for (const key of ["cjs", "shrinkwrap"] as const) for (const check of REQUIRE_CHECKS) {
      const out = await validate(key, draft({ checks: [check] }));
      // mutation: treat every package as type module -> check-module-system:T1 -> red
      expect(out.reasons, `${key}: ${check}`).toEqual([]);
    }
    const out = await validate("esm", draft({ checks: ["node --input-type=module -e \"const { a } = await import('./src/a.js'); if (a !== 1) process.exit(1)\""] }));
    expect(out.reasons).toEqual([]);
    expect(out.ok).toBe(true);
  });
});

describe("#136: a check that inspects git history or the diff", () => {
  it("hands back git diff --name-only/--stat, git rev-parse and git log", async () => {
    for (const check of ["git diff --name-only HEAD | grep -x src/a.js", "git diff HEAD~1 --stat", "test \"$(git rev-parse HEAD)\" != base", "git log --oneline -1 | grep -q a", "git -C . log -1"]) {
      const out = await validate("cjs", draft({ checks: [check] }));
      // mutation: drop the check-git-state push in validateSplitDraft -> [] -> red
      expect(out.reasons, check).toEqual(["check-git-state:T1"]);
    }
  });

  it("keeps git diff --exit-code, which asserts the delivered files are unchanged by a formatter", async () => {
    for (const check of ["git diff --exit-code", "npx prettier --write src && git diff --exit-code -- src"]) {
      const out = await validate("cjs", draft({ checks: [check] }));
      // mutation: match any `git diff` -> check-git-state:T1 -> red
      expect(out.reasons, check).toEqual([]);
      expect(out.ok, check).toBe(true);
    }
  });
});

describe("the multi-directory split, per write's directory", () => {
  const multi = (writes: MultiSplitOutput["tasks"][number]["writes"]): MultiSplitOutput => ({ notes: "",
    tasks: [{ taskId: "t", title: "t", labels: [], goal: "G", successCondition: "S", writes, dependsOn: [], traces: ["AC1"] }] });
  const validateMulti = (output: MultiSplitOutput) => {
    const dirs = [{ key: "main", path: repos.esm.path }, { key: "other", path: repos.cjs.path }];
    const expanded = expandMultiSplitDraft(output, { targetRepo: repos.esm.path, ccloopBin: "/bin/false", runsDir: join(root, "runs"), groupId: "r", statement: "G", successConditions: ["S"], dirs });
    return validateMultiSplitDraft({ output, plan: expanded.plan, contracts: expanded.contracts, expandReasons: expanded.reasons,
      paths: new Map([["main", repos.esm.path], ["other", repos.cjs.path]]), commits: new Map([["main", repos.esm.commit], ["other", repos.cjs.commit]]), criterionIds: ["AC1"], adrIds: [] });
  };
  const requireCheck = "node -e \"require('./src/a.js')\"";

  it("judges a require() check by the package.json of the directory it runs in", async () => {
    const out = await validateMulti(multi([
      { dir: "main", targetPaths: ["src/a.js"], checks: [requireCheck] },
      { dir: "other", targetPaths: ["src/a.js"], checks: [requireCheck] },
    ]));
    // mutation: drop the check-module-system push in validateMultiSplitDraft -> [] -> red
    expect(out.reasons).toEqual(["check-module-system:t:main"]);
  });

  it("accepts a require() check only in the CommonJS directory", async () => {
    const out = await validateMulti(multi([
      { dir: "main", targetPaths: ["src/a.js"], checks: ["npm test"] },
      { dir: "other", targetPaths: ["src/a.js"], checks: [requireCheck] },
    ]));
    expect(out.reasons).toEqual([]);
    expect(out.ok).toBe(true);
  });

  it("hands back a git-state check in any write", async () => {
    const out = await validateMulti(multi([
      { dir: "main", targetPaths: ["src/a.js"], checks: ["npm test"] },
      { dir: "other", targetPaths: ["src/a.js"], checks: ["git diff --name-only HEAD"] },
    ]));
    // mutation: drop the check-git-state push in validateMultiSplitDraft -> [] -> red
    expect(out.reasons).toEqual(["check-git-state:t:other"]);
  });
});

describe("the meanings the next draft is told", () => {
  it("explains each new reason, and a revision prompt carries the explanation", () => {
    const reasons = ["setup-lockfile:T1:npm ci", "check-module-system:T1", "check-module-system:t:main", "check-git-state:T1"];
    for (const reason of reasons) expect(explainSplitReason(reason), reason).not.toBeNull();
    expect(explainSplitReason("setup-lockfile:T1:npm ci")).toMatch(/--no-package-lock/);
    expect(explainSplitReason("check-module-system:T1")).toMatch(/"type": "module"/);
    expect(explainSplitReason("check-git-state:T1")).toMatch(/git diff --exit-code/);
    const prompt = buildSplitPrompt({ document: "doc", overview: { canonicalJson: "{}", hash: "0".repeat(64) },
      earlierDrafts: [{ draftNo: 1, output: draft(), feedback: null, reasons } as never] });
    for (const reason of reasons) expect(prompt).toContain(`${reason} -- ${explainSplitReason(reason)}`.replaceAll("\"", "\\\""));
  });
});
