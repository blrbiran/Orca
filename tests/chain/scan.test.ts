import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TIER0_RULE, dynamicImportFiles, dynamicImports, offending, scanTree } from "../../scripts/forbidden-literals.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("the supervisor's own code makes none of the Rule 15 moves (D-launch spec §2.2-3, §8.2-9)", () => {
  it.each([
    ['await git(repo, ["push", "origin", "main"]);', ["push"]],
    ["execFile(`git`, [`push`]);", ["push"]],
    ['await git(repo, ["branch", "-D", name]);', ["branch"]],
    ['await git(repo, ["worktree", "remove", path]);', ["worktree"]],
    ['spawn("gh", ["pr", "merge", "1"]);', ["gh", "merge"]],
    ['const command = "git push origin main";', ["git push origin main"]],
    ['await git(repo, ["merge", "feat"]);', ["merge"]],
  ])("must catch: %s", (src, expected) => {
    expect(offending(src, TIER0_RULE)).toEqual(expected);
  });

  it.each([
    'await git(repo, ["merge-base", "--is-ancestor", a, b]);',
    '// never run "git push" here',
    '/* git(repo, ["merge", "feat"]) */',
    '"4. Pushing, merging into main, deleting a branch and removing a worktree are for a person"',
    'await git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]);',
    'const url = "http://127.0.0.1:7777"; // "git push"',
  ])("must not catch: %s", (src) => {
    expect(offending(src, TIER0_RULE)).toEqual([]);
  });

  it.each([
    ['const m = await import("./run.js");', 1],
    ['const m = await import ( "./x.js" );', 1],
  ] as const)("dynamic import, must catch: %s", (src, expected) => {
    expect(dynamicImports(src)).toBe(expected);
  });

  it.each(['import { a } from "./b.js";', '// const m = await import("./x.js");', 'const s = "await import(x)";'])("dynamic import, must not catch: %s", (src) => {
    expect(dynamicImports(src)).toBe(0);
  });

  it("src/chain/** has no dynamic import: the supervisor loads every module at start-up (spec §2, review 1; plan PC-23)", async () => {
    expect(await dynamicImportFiles(repoRoot, "src/chain")).toEqual([]);
  });

  it("src/chain/** holds exactly one such literal: the gate check's must-block sample, which is stdin data", async () => {
    expect(await scanTree(repoRoot, "src/chain", TIER0_RULE)).toEqual([{ file: "src/chain/gateCheck.ts", literal: "git push" }]);
  });
});
