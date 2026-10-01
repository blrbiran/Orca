import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentCheck } from "../../src/control/loopPlans.js";

/**
 * C4 (human ruling 2026-10-01): design and investigate v2 are command-verified, so the only thing standing between an
 * empty or missing deliverable and "succeeded" is this check. ccloop runs each required check with `sh -lc` in the
 * attempt's worktree; these criteria run the generated command the same way against real files.
 */
const passes = (cwd: string, target: string): boolean =>
  spawnSync("sh", ["-lc", documentCheck(target)], { cwd, encoding: "utf8" }).status === 0;
const worktree = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "doc-check-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
};

describe("an exact target document", () => {
  it("passes only when it is a non-empty regular file", () => {
    expect(passes(worktree({ "docs/report.md": "findings\n" }), "docs/report.md")).toBe(true);
    expect(passes(worktree({}), "docs/report.md")).toBe(false);
    expect(passes(worktree({ "docs/report.md": "" }), "docs/report.md")).toBe(false);
    expect(passes(worktree({ "docs/report.md/inner.md": "x" }), "docs/report.md")).toBe(false);
  });
});

describe("a <prefix>/** target", () => {
  it("passes only when some file under the prefix is non-empty", () => {
    expect(passes(worktree({ "docs/design/a/b.md": "plan" }), "docs/design/**")).toBe(true);
    expect(passes(worktree({}), "docs/design/**")).toBe(false);
    expect(passes(worktree({ "docs/design/a.md": "", "docs/design/b/c.md": "" }), "docs/design/**")).toBe(false);
    expect(passes(worktree({ "docs/other.md": "x" }), "docs/design/**")).toBe(false);
  });
});

describe("a path is one shell word", () => {
  it("is not split, expanded or read as an option", () => {
    const root = worktree({ "-n": "x", "it's.md": "x", "a b.md": "x" });
    expect(passes(root, "-n")).toBe(true);
    expect(passes(root, "it's.md")).toBe(true);
    expect(passes(root, "a b.md")).toBe(true);
    expect(passes(root, "a")).toBe(false);
    expect(passes(root, "$(touch pwned).md")).toBe(false);
    expect(readdirSync(root).sort()).toEqual(["-n", "a b.md", "it's.md"]);
  });
});
