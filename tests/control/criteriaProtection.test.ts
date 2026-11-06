import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPaths, classifyCriteriaChange, flagged, type CriteriaChangeKind } from "../../src/control/criteriaProtection.js";
import { listFlaggedDecisions } from "../../src/control/flaggedDecisions.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Protect-acceptance-criteria spec 2026-10-21 §3-§4: what an attempt did to the files that define its checks, by code,
 * with a must-flag and a must-not-flag sample set (a detector needs both); and the landing that writes the `criteria`
 * decision and flags it without blocking. Every sample is a real commit pair in a scratch repository.
 */
const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();

const TEST = "import { expect, it } from 'vitest';\nit('adds', () => {\n  expect(1 + 1).toBe(2);\n  expect(2 + 2).toBe(4);\n});\n";
const BASE: Record<string, string> = {
  "README.md": "Install this package.\n",
  "src/add.ts": "export const add = (a: number, b: number) => a + b;\n",
  "tests/add.test.ts": TEST,
  "tests/helpers/sum.js": "module.exports = (xs) => xs.reduce((a, b) => a + b, 0);\n",
  "check.js": "process.exit(require('./src/add').add(1, 1) === 2 ? 0 : 1);\n",
  "register.js": "module.exports = {};\n",
  "scripts/setup.sh": "echo setup\n",
  "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2) + "\n",
};

/** base: BASE committed; attempt: `change` applied on top (null deletes). Answers the classification. */
async function classify(change: Record<string, string | null>, checks: string[] = ["node check.js", "npm test"]): Promise<{ kind: CriteriaChangeKind; signals: string[]; files: string[] }> {
  const repo = await mkdtemp(join(tmpdir(), "orca-criteria-"));
  try {
    g(repo, "init", "-q", "-b", "main");
    for (const [path, text] of Object.entries(BASE)) { await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), text); }
    g(repo, "add", "-A"); g(repo, "commit", "-qm", "base");
    const base = g(repo, "rev-parse", "HEAD");
    for (const [path, text] of Object.entries(change)) {
      if (text === null) { g(repo, "rm", "-q", path); continue; }
      await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), text);
    }
    g(repo, "add", "-A"); g(repo, "commit", "-qm", "attempt", "--allow-empty");
    return await classifyCriteriaChange(repo, base, g(repo, "rev-parse", "HEAD"), checks);
  } finally { await rm(repo, { recursive: true, force: true }); }
}

describe("classifying an attempt's change to its checks (spec §3-§4.1)", () => {
  it("does not treat a README checked by grep as the file defining that check (#198)", async () => {
    const checks = ["grep -q 'npm link' README.md"];
    expect([...checkPaths(checks)]).toEqual([]);
    const result = await classify({ "README.md": "Install this package with npm link.\n" }, checks);
    expect(result).toEqual({ kind: "none", files: [], signals: [] });
    expect(flagged(result)).toBe(false);
  });

  it.each(["FOO=1 node check.js", "env FOO=1 node check.js", "npx --yes tsx check.js", "npm exec -- tsx check.js"])(
    "protects a check script behind %s", async (command) => {
      expect([...checkPaths([command])]).toContain("check.js");
      expect((await classify({ "check.js": "process.exit(0);\n" }, [command])).kind).toBe("modified");
    });

  it.each(["node --require register.js check.js", "node --import tsx check.js", "node -r register.js check.js"])(
    "protects the check script after interpreter options in %s", async (command) => {
      expect([...checkPaths([command])]).toContain("check.js");
      expect((await classify({ "check.js": "process.exit(0);\n" }, [command])).kind).toBe("modified");
    });

  it.each(["sh -c 'node check.js'", "bash -lc 'source ./scripts/setup.sh'"])(
    "protects a statically named script in %s", async (command) => {
      const path = command.includes("setup") ? "scripts/setup.sh" : "check.js";
      expect([...checkPaths([command])]).toContain(path);
      expect((await classify({ [path]: "echo changed\n" }, [command])).kind).toBe("modified");
    });

  // Must not flag: growth of the tests, code-only changes, package.json changes outside `scripts`, a new script.
  it.each([
    ["only code changed", { "src/add.ts": "export const add = (a: number, b: number) => b + a;\n" }, "none"],
    ["a new test file", { "tests/sub.test.ts": "it('subs', () => { expect(1 - 1).toBe(0); });\n" }, "additive"],
    ["lines only added to a test", { "tests/add.test.ts": `${TEST}it('adds zero', () => { expect(1 + 0).toBe(1); });\n` }, "additive"],
    ["package.json outside scripts", { "package.json": JSON.stringify({ name: "x", version: "1.1.0", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2) + "\n" }, "none"],
    ["a new script", { "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "vitest run", lint: "eslint .", build: "tsc" } }, null, 2) + "\n" }, "additive"],
  ] as const)("does not flag %s", async (_name, change, kind) => {
    const result = await classify(change);
    expect(result.kind).toBe(kind);
    expect(flagged(result)).toBe(false);
  });

  // Must flag: every weakening signal, and a modification that is not only additions.
  it.each([
    ["a deleted test", { "tests/add.test.ts": null }, "weakening", ["deleted:tests/add.test.ts"]],
    ["a deleted test helper (by directory, not by name)", { "tests/helpers/sum.js": null }, "weakening", ["deleted:tests/helpers/sum.js"]],
    ["an assertion removed", { "tests/add.test.ts": TEST.replace("  expect(2 + 2).toBe(4);\n", "") }, "weakening", ["fewer-assertions:tests/add.test.ts:2->1"]],
    ["a test skipped", { "tests/add.test.ts": TEST.replace("it('adds'", "it.skip('adds'") }, "weakening", ["skip-added:tests/add.test.ts"]],
    ["the test script made a no-op", { "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "exit 0", lint: "eslint ." } }, null, 2) + "\n" }, "weakening", ["script-no-op:package.json#test"]],
    ["a script removed", { "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "vitest run" } }, null, 2) + "\n" }, "weakening", ["script-removed:package.json#lint"]],
    ["the required check's own file deleted", { "check.js": null }, "weakening", ["deleted:check.js"]],
    ["an assertion changed (same count)", { "tests/add.test.ts": TEST.replace("toBe(4)", "toBeGreaterThan(3)") }, "modified", []],
    ["the required check's own file edited", { "check.js": "process.exit(0);\n" }, "modified", []],
  ] as const)("flags %s", async (_name, change, kind, signals) => {
    const result = await classify(change);
    expect(result.kind).toBe(kind);
    expect(result.signals).toEqual(signals);
    expect(flagged(result)).toBe(true);
  });
});

// Task setup spec 2026-11-04 §4.6: a file a setup command names defines the checks as much as a check's own file does.
describe("the files a task's setup names (task setup spec §4.6)", () => {
  it("checkPaths reads paths from setup commands too", async () => {
    // Mutation A4-M4 (ignore setup in checkPaths) -> the set lacks scripts/setup.sh, red.
    expect([...checkPaths(["node check.js"], ["sh ./scripts/setup.sh --fast", "npm ci"])].sort()).toEqual(["check.js", "scripts/setup.sh"]);
    expect([...checkPaths(["node check.js"])]).toEqual(["check.js"]);
    expect([...checkPaths(["./scripts/check", "npx tsx scripts/verify.ts", "tsc -p tsconfig.json", "grep -q npm README.md"])].sort())
      .toEqual(["scripts/check", "scripts/verify.ts", "tsconfig.json"]);
    expect([...checkPaths(["node -p 'README.md'"])]).toEqual([]);
    // The classification reads them: an edit to the setup script is a modification of the checks, not a code change.
    const repo = await mkdtemp(join(tmpdir(), "orca-criteria-setup-"));
    try {
      g(repo, "init", "-q", "-b", "main");
      await mkdir(join(repo, "scripts"), { recursive: true });
      await writeFile(join(repo, "scripts", "setup.sh"), "npm ci\n"); await writeFile(join(repo, "check.js"), "process.exit(0);\n");
      g(repo, "add", "-A"); g(repo, "commit", "-qm", "base");
      const base = g(repo, "rev-parse", "HEAD");
      await writeFile(join(repo, "scripts", "setup.sh"), "npm ci --ignore-scripts\n");
      g(repo, "add", "-A"); g(repo, "commit", "-qm", "attempt");
      const attempt = g(repo, "rev-parse", "HEAD");
      expect(await classifyCriteriaChange(repo, base, attempt, ["node check.js"], ["sh scripts/setup.sh"])).toEqual({ kind: "modified", files: ["scripts/setup.sh"], signals: [] });
      expect((await classifyCriteriaChange(repo, base, attempt, ["node check.js"])).kind).toBe("none");
    } finally { await rm(repo, { recursive: true, force: true }); }
  });
});

describe("the landing writes the criteria decision and flags it, without blocking (spec §4.3)", () => {
  async function landing(files: Record<string, string>) {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["tests/**", "a"] }], { files: () => files });
    await mkdir(join(t.repo, "tests"), { recursive: true });
    await writeFile(join(t.repo, "tests", "add.test.ts"), TEST);
    git(t.repo, "add", "tests/add.test.ts"); git(t.repo, "commit", "-qm", "tests");
    const runId = await t.claim();
    const driver = t.driver();
    await t.until(driver, () => t.body(runId).drive?.landedCommit != null || t.body(runId).state === "blocked", 120);
    return { t, runId };
  }

  it("lands a README task checked by grep without opening a criteria flag (#198)", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["README.md"] }], {
      files: () => ({ "README.md": "Install with npm link.\n" }), requiredChecks: ["grep -q 'npm link' README.md"],
    });
    try {
      await writeFile(join(t.repo, "README.md"), "Install this package.\n");
      git(t.repo, "add", "README.md"); git(t.repo, "commit", "-qm", "readme-base");
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.landedCommit != null || t.body(runId).state === "blocked", 120);
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([]);
      expect(readControlGroup(t.h.store, "epoch-test", "g").summary.card?.pendingDecisions ?? 0).toBe(0);
    } finally { await t.h.dispose(); }
  });

  it("lands a weakened test, writes a major criteria decision in the run's ledger and flags it as a test change", async () => {
    const { t, runId } = await landing({ "tests/add.test.ts": TEST.replace("  expect(2 + 2).toBe(4);\n", "") }); try {
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      const ledger = git(t.repo, "show", `refs/heads/orca/g:.decisions/${runId}.jsonl`).split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(ledger).toContainEqual(expect.objectContaining({ id: `${runId}/orca-criteria`, kind: "criteria", importance: "major", evidence: ["fewer-assertions:tests/add.test.ts:2->1", "changed: tests/add.test.ts"] }));
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([expect.objectContaining({ decisionId: `${runId}/orca-criteria`, source: "test-change", state: "flagged", flaggedBy: "orca-auto" })]);
      expect(t.body(runId).drive.stagedCriteriaFlag).toBeNull();
      expect(readControlGroup(t.h.store, "epoch-test", "g").summary.card?.pendingDecisions).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("says nothing about a new test (no decision, no flag)", async () => {
    const { t, runId } = await landing({ "tests/sub.test.ts": "it('subs', () => { expect(1 - 1).toBe(0); });\n" }); try {
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([]);
      const tree = git(t.repo, "ls-tree", "-r", "--name-only", "refs/heads/orca/g");
      expect(tree.includes(`.decisions/${runId}.jsonl`) ? git(t.repo, "show", `refs/heads/orca/g:.decisions/${runId}.jsonl`) : "").not.toContain("orca-criteria");
    } finally { await t.h.dispose(); }
  });
});
