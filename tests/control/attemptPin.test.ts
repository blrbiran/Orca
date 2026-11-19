import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAttempt, pinAttempt } from "../../src/control/attemptPin.js";

/**
 * Change-sized runs spec 2026-11-19 §5.3 (P2; #363 #366): step C's checks and the create-only pin
 * `refs/orca/runs/<runId>` in the target repository (criteria P2-2, P2-3).
 */
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
function repos() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-attempt-pin-")));
  const target = join(root, "target");
  execFileSync("git", ["init", "-q", target]);
  writeFileSync(join(target, "a.txt"), "a\n");
  git(target, "add", "-A"); git(target, "commit", "-q", "-m", "base");
  const base = git(target, "rev-parse", "HEAD");
  const commit = (repo: string, parent: string, content: string) => {
    writeFileSync(join(root, "blob"), content);
    const blob = git(repo, "hash-object", "-w", join(root, "blob"));
    const tree = execFileSync("git", ["mktree"], { cwd: repo, input: `100644 blob ${blob}\ta.txt\n`, encoding: "utf8" }).trim();
    return git(repo, "commit-tree", tree, "-p", parent, "-m", content);
  };
  return { root, target, base, commit };
}
const refs = (repo: string) => git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/orca/");

describe("pinAttempt (§5.3, review I3)", () => {
  it("creates the pin, answers the same pin again, and leaves the ref alone", async () => {
    const r = repos();
    const attempt = r.commit(r.target, r.base, "attempt\n");
    expect(await pinAttempt(r.target, r.target, "run-1", attempt)).toEqual({ pinned: { ref: "refs/orca/runs/run-1", sha: attempt } });
    expect(await pinAttempt(r.target, r.target, "run-1", attempt)).toEqual({ pinned: { ref: "refs/orca/runs/run-1", sha: attempt } });
    expect(refs(r.target)).toBe(`refs/orca/runs/run-1 ${attempt}`);
  });

  // P2-2. Mutation: a plain refspec fetch (`<sha>:refs/orca/runs/<runId>`) or a forced/plain update-ref -> the ancestor is
  // fast-forwarded to the attempt and the answer is pinned, red.
  it("refuses a ref already at an ancestor of the attempt as run-ref-conflict and never moves it", async () => {
    const r = repos();
    const attempt = r.commit(r.target, r.base, "attempt\n");
    git(r.target, "update-ref", "refs/orca/runs/run-1", r.base);
    expect(await pinAttempt(r.target, r.target, "run-1", attempt)).toEqual({ refused: `run-ref-conflict:${r.base}` });
    expect(refs(r.target)).toBe(`refs/orca/runs/run-1 ${r.base}`);
  });

  // P2-1 (git level). Mutation: skip the fetch -> update-ref of a missing object fails, red.
  it("in clone mode fetches the attempt from the run's workspace without writing any other ref, and the pin outlives the clone", async () => {
    const r = repos();
    const clone = join(r.root, "ws");
    execFileSync("git", ["clone", "-q", "--local", "--no-checkout", r.target, clone]);
    const attempt = r.commit(clone, r.base, "attempt\n");
    git(clone, "update-ref", "refs/ccloop/run-1/attempts/1", attempt);
    expect(await pinAttempt(r.target, clone, "run-1", attempt)).toEqual({ pinned: { ref: "refs/orca/runs/run-1", sha: attempt } });
    execFileSync("/bin/rm", ["-rf", clone]);
    expect(git(r.target, "cat-file", "-t", attempt)).toBe("commit");
    expect(refs(r.target)).toBe(`refs/orca/runs/run-1 ${attempt}`);
    expect(git(r.target, "for-each-ref", "--format=%(refname)", "refs/ccloop/")).toBe("");
  });
});

describe("step C's checks (§5.3, P2-3)", () => {
  it("passes an attempt that descends from base, with the recorded tree and ref", async () => {
    const r = repos();
    const agentCommit = r.commit(r.target, r.base, "agent\n");
    const attempt = r.commit(r.target, agentCommit, "attempt\n");
    git(r.target, "update-ref", "refs/ccloop/run-1/attempts/1", attempt);
    // attempt^ is the agent's own commit, not base: ancestry, never equality.
    expect(await checkAttempt(r.target, r.base, attempt, { tree: git(r.target, "rev-parse", `${attempt}^{tree}`), ref: "refs/ccloop/run-1/attempts/1" })).toBeNull();
  });

  // One mutation per check: drop it -> its case below passes, red.
  it("names each failed check", async () => {
    const r = repos();
    const attempt = r.commit(r.target, r.base, "attempt\n");
    git(r.target, "update-ref", "refs/ccloop/run-1/attempts/1", attempt);
    const tree = git(r.target, "rev-parse", `${attempt}^{tree}`);
    expect(await checkAttempt(r.target, r.base, "f".repeat(40), { tree, ref: "refs/ccloop/run-1/attempts/1" })).toBe("attempt-missing");
    const unrelated = git(r.target, "commit-tree", tree, "-m", "root");
    expect(await checkAttempt(r.target, r.base, unrelated, { tree, ref: "refs/ccloop/run-1/attempts/1" })).toBe("attempt-not-from-base");
    expect(await checkAttempt(r.target, r.base, attempt, { tree: git(r.target, "rev-parse", `${r.base}^{tree}`), ref: "refs/ccloop/run-1/attempts/1" })).toBe("attempt-tree-mismatch");
    git(r.target, "update-ref", "refs/ccloop/run-1/attempts/1", r.base);
    expect(await checkAttempt(r.target, r.base, attempt, { tree, ref: "refs/ccloop/run-1/attempts/1" })).toBe("attempt-ref-mismatch");
    // A legacy attempt (Orca's own commit) has no recorded tree or ref to check.
    expect(await checkAttempt(r.target, r.base, attempt)).toBeNull();
  });
});
