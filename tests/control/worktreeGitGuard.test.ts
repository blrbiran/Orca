import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { stepA1, stepA2, stepB, stepC } from "../../src/control/executionDriver.js";
import { stepD } from "../../src/control/driverLanding.js";
import { alternateGitDirOf } from "../../src/control/worktreeGitGuard.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Tester #328: a worktree workspace's `.git` points at the project's shared, read-only Git directory. An agent that
 * needs to make a merge commit there sometimes invents a second git directory inside the worktree
 * (`.git-merge-local`, `GIT_DIR=...`) and materialises the tree back. That attempt must not land as if it were a
 * merge: the landing refuses it by name.
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "orca-gitguard-"));
  roots.push(root);
  git(root, "init", "-q");
  writeFileSync(join(root, "base.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return root;
}

function commit(repoPath: string, files: Record<string, string>): { base: string; attempt: string } {
  const base = git(repoPath, "rev-parse", "HEAD");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repoPath, path)), { recursive: true });
    writeFileSync(join(repoPath, path), content);
  }
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-qm", "attempt");
  return { base, attempt: git(repoPath, "rev-parse", "HEAD") };
}

const drive = (base: string, attempt: string) => ({ base, attemptSha: attempt, sourceDir: join(tmpdir(), "unused-source") });

describe("an attempt that carries an alternate git directory (#328)", () => {
  it("names the path the agent invented", async () => {
    const r = repo();
    const { base, attempt } = commit(r, { ".git-merge-local/HEAD": "ref: refs/heads/main\n", "a.txt": "a\n" });
    // mutation (look only at the root entry `.git-merge-local`, not its children) -> null, red.
    expect(await alternateGitDirOf(r, drive(base, attempt))).toBe(".git-merge-local/HEAD");
  });

  it("leaves the dotfiles a repository legitimately carries alone", async () => {
    const r = repo();
    const { base, attempt } = commit(r, {
      ".gitignore": "node_modules\n",
      ".gitattributes": "* text=auto\n",
      ".git-blame-ignore-revs": "# a hash\n",
      ".github/workflows/ci.yml": "on: push\n",
      "a.txt": "a\n"
    });
    // mutation (treat every `.git*` entry as an alternate git dir) -> `.gitignore` is returned, red.
    expect(await alternateGitDirOf(r, drive(base, attempt))).toBeNull();
  });

  it("does not block on an unreadable range", async () => {
    const r = repo();
    const { base } = commit(r, { "a.txt": "a\n" });
    // mutation (throw instead of null) -> the landing would fail on an unrelated git error, red.
    expect(await alternateGitDirOf(r, drive(base, "0000000000000000000000000000000000000000"))).toBeNull();
  });

  it("blocks the landing by name and moves no tip", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({ a: "a\n", ".git-merge-local/HEAD": "ref: refs/heads/main\n" }) });
    try {
      const runId = await t.claim();
      for (const step of [stepA1, stepA2, stepB, stepC]) expect(await step(t.deps, runId)).toBe(true);
      expect(t.body(runId).state).toBe("collected");
      const before = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect(await stepD(t.deps, runId)).toBe(true);
      // mutation (record the landed tip anyway) -> state is `landed`, red.
      expect(t.body(runId).state).toBe("blocked");
      expect(t.body(runId).drive.blockedReason).toBe("workspace-git-readonly:.git-merge-local/HEAD");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(before);
    } finally { await t.h.dispose(); }
  }, 30_000);
});