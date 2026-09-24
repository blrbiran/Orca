import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecutionDriver } from "../../src/control/executionDriver.js";
import { landingPathOf } from "../../src/control/workspace.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Execution driver spec §5.1-§5.2 and criterion X1: land by merging in a detached worktree of the
// driver's own and moving orca/<group> by compare-and-swap; the person's checkout is never touched.
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("D: landing on orca/<group> (spec §5.1-§5.2)", () => {
  it("X1: lands while the person has orca/<group> checked out, leaving their files and index alone", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
      git(t.repo, "checkout", "-q", "orca/g");
      const index = sha256(join(t.repo, ".git", "index"));
      await t.until(driver, () => t.body(runId).state === "landed");
      const drive = t.body(runId).drive;
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect(drive.landedCommit).toBe(tip);
      expect(git(t.repo, "rev-parse", `${tip}^1`)).toBe(old);
      expect(git(t.repo, "rev-parse", `${tip}^2`)).toBe(drive.attemptSha);
      expect(git(t.repo, "log", "-1", "--format=%s", tip)).toBe(`orca: land ${runId}`);
      expect(git(t.repo, "show", `${tip}:a`)).toBe("a");
      expect(git(t.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/orca/g");
      expect(sha256(join(t.repo, ".git", "index"))).toBe(index);
      expect(existsSync(join(t.repo, "a"))).toBe(false);
      const landing = landingPathOf(t.deps.roots, runId);
      expect(existsSync(landing)).toBe(false);
      expect(git(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${landing}`);
    } finally { await t.h.dispose(); }
  });

  it("leaves the branch alone when it moved between the merge and the swap, and lands on the new tip next round", async () => {
    let moved: string | null = null;
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = createExecutionDriver({ ...t.deps, beforeCas: async () => {
        if (moved !== null) return;
        const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
        moved = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
        git(t.repo, "update-ref", "refs/heads/orca/g", moved, old);
      } });
      await t.until(driver, () => moved !== null);
      expect(t.body(runId).state).toBe("collected");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(moved);
      expect(existsSync(landingPathOf(t.deps.roots, runId))).toBe(false);
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(git(t.repo, "rev-parse", `${t.body(runId).drive.landedCommit}^1`)).toBe(moved);
    } finally { await t.h.dispose(); }
  });

  it("recognises a landing it already made and does not merge twice (a death after the swap)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      const landed = t.body(runId).drive.landedCommit;
      const commits = git(t.repo, "rev-list", "--count", "refs/heads/orca/g");
      const row = t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
      const body = JSON.parse(String(row.body));
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, state: "collected", drive: { ...body.drive, landedCommit: null } }), runId);
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(t.body(runId).drive.landedCommit).toBe(landed);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(landed);
      expect(git(t.repo, "rev-list", "--count", "refs/heads/orca/g")).toBe(commits);
    } finally { await t.h.dispose(); }
  });

  it("blocks the run by name when the repository path no longer resolves", async () => {
    let resolvable = true;
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = createExecutionDriver({ ...t.deps, resolveRepository: (repoId) => {
        if (!resolvable) throw new Error("control-path-escape");
        return t.deps.resolveRepository(repoId);
      } });
      await t.until(driver, () => t.body(runId).state === "collected");
      resolvable = false;
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "D", blockedReason: "repository-path" });
    } finally { await t.h.dispose(); }
  });
});
