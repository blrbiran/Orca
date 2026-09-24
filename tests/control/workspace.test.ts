import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupRunWorkspace, commitAttempt, compareAndSwap, controlWorkspaceRoots, ensureWorkBranch, ensureWorkspace,
  incomingRefOf, removeOwnPath, workspacePathOf,
} from "../../src/control/workspace.js";
import { within } from "../../src/control/archive.js";

// Execution driver spec §3 / §5.1: workspaces are the driver's own, the person's checkout is never touched.
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function target() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-workspace-")));
  roots.push(root);
  const repo = join(root, "target");
  await mkdir(repo);
  g(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "shared.txt"), "base\n");
  g(repo, "add", "shared.txt");
  g(repo, "commit", "-qm", "base");
  const state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  return { root, repo, state, roots: controlWorkspaceRoots(state), head: g(repo, "rev-parse", "HEAD") };
}

describe("workspace roots (execution driver §3.2, deviation D9)", () => {
  it("puts runs and workspaces beside the store directory, never inside it, at 0700", async () => {
    const t = await target();
    expect(t.roots).toEqual({ runsRoot: `${t.state}.runs`, workspacesRoot: `${t.state}.workspaces` });
    expect(within(t.state, t.roots.runsRoot)).toBe(false);
    expect(within(t.state, t.roots.workspacesRoot)).toBe(false);
    expect(statSync(t.roots.runsRoot).mode & 0o777).toBe(0o700);
    expect(statSync(t.roots.workspacesRoot).mode & 0o777).toBe(0o700);
  });
});

describe("the work branch (execution driver §5.1)", () => {
  it("creates orca/<group> at the current HEAD commit without moving HEAD or touching the index", async () => {
    const t = await target();
    const index = sha256(join(t.repo, ".git", "index"));
    expect(await ensureWorkBranch(t.repo, "g")).toBe(t.head);
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.head);
    expect(g(t.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(sha256(join(t.repo, ".git", "index"))).toBe(index);
  });

  it("leaves an existing branch where it is", async () => {
    const t = await target();
    await ensureWorkBranch(t.repo, "g");
    await writeFile(join(t.repo, "shared.txt"), "moved\n");
    g(t.repo, "commit", "-qam", "moved");
    expect(await ensureWorkBranch(t.repo, "g")).toBe(t.head);
  });
});

describe("the run workspace (execution driver §3.2)", () => {
  it("adds a detached worktree at base, registered in the target, and reuses it while HEAD is still base", async () => {
    const t = await target();
    const path = workspacePathOf(t.roots, "run-1");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    expect(g(t.repo, "worktree", "list", "--porcelain").split("\n")).toContain(`worktree ${path}`);
    expect(g(path, "rev-parse", "HEAD")).toBe(t.head);
    await writeFile(join(path, "marker.txt"), "kept\n");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    expect(await readFile(join(path, "marker.txt"), "utf8")).toBe("kept\n");
  });

  it("rebuilds a workspace whose HEAD is not base", async () => {
    const t = await target();
    const path = workspacePathOf(t.roots, "run-1");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    await writeFile(join(path, "marker.txt"), "stale\n");
    await writeFile(join(t.repo, "shared.txt"), "next\n");
    g(t.repo, "commit", "-qam", "next");
    const next = g(t.repo, "rev-parse", "HEAD");
    await ensureWorkspace(t.repo, "worktree", path, next, t.roots);
    expect(g(path, "rev-parse", "HEAD")).toBe(next);
    expect(existsSync(join(path, "marker.txt"))).toBe(false);
  });

  it("clones in clone mode: its own .git directory, detached at base, not registered in the target", async () => {
    const t = await target();
    const path = workspacePathOf(t.roots, "run-2");
    await ensureWorkspace(t.repo, "clone", path, t.head, t.roots);
    expect(statSync(join(path, ".git")).isDirectory()).toBe(true);
    expect(g(path, "rev-parse", "HEAD")).toBe(t.head);
    expect(g(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${path}`);
  });

  it("refuses to touch a path it did not name, and removes nothing", async () => {
    const t = await target();
    const foreign = join(t.root, "foreign");
    await mkdir(foreign);
    await writeFile(join(foreign, "keep.txt"), "mine\n");
    await expect(removeOwnPath(t.repo, t.roots, foreign)).rejects.toThrow(/not a workspace this driver named/);
    await expect(ensureWorkspace(t.repo, "worktree", foreign, t.head, t.roots)).rejects.toThrow(/not a workspace this driver named/);
    expect(await readFile(join(foreign, "keep.txt"), "utf8")).toBe("mine\n");
  });
});

describe("the attempt commit (execution driver §3.3)", () => {
  it("commits a dirty result repository on top of its HEAD and returns the new commit", async () => {
    const t = await target();
    const before = g(t.repo, "rev-parse", "HEAD");
    await writeFile(join(t.repo, "shared.txt"), "attempt\n");
    await writeFile(join(t.repo, "new.txt"), "untracked\n");
    const sha = await commitAttempt(t.repo);
    expect(g(t.repo, "rev-parse", `${sha}^`)).toBe(before);
    expect(g(t.repo, "show", `${sha}:new.txt`)).toBe("untracked");
    expect(g(t.repo, "log", "-1", "--format=%an <%ae>", sha)).toBe("orca <orca@invalid>");
  });

  it("returns HEAD unchanged for a clean result repository", async () => {
    const t = await target();
    expect(await commitAttempt(t.repo)).toBe(t.head);
    expect(g(t.repo, "rev-parse", "HEAD")).toBe(t.head);
  });
});

describe("compare-and-swap and cleanup (execution driver §5.1, §3.5)", () => {
  it("moves the branch only from the tip it was read at", async () => {
    const t = await target();
    await ensureWorkBranch(t.repo, "g");
    await writeFile(join(t.repo, "shared.txt"), "next\n");
    g(t.repo, "commit", "-qam", "next");
    const next = g(t.repo, "rev-parse", "HEAD");
    expect(await compareAndSwap(t.repo, "refs/heads/orca/g", next, next)).toBe(false);
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.head);
    expect(await compareAndSwap(t.repo, "refs/heads/orca/g", next, t.head)).toBe(true);
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(next);
  });

  it("removes the run's worktree registration and its incoming ref, and nothing named orca/<group>", async () => {
    const t = await target();
    await ensureWorkBranch(t.repo, "g");
    const path = workspacePathOf(t.roots, "run-3");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    g(t.repo, "update-ref", incomingRefOf("run-3"), t.head);
    await cleanupRunWorkspace(t.repo, t.roots, "run-3", path);
    expect(existsSync(path)).toBe(false);
    expect(g(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${path}`);
    expect(g(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/")).toBe("");
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.head);
  });
});
