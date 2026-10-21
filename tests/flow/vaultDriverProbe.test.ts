/**
 * Flow engine spec §5.2 [BC-B1] / §17 package 0 (plan Task 2, spike case only; Task 10 completes C14): the existing
 * execution driver takes a bare vault as its target repository unchanged. The vault is made the way a vault is made
 * (`git init --bare --shared=0600`, a tree committed by plumbing, HEAD unborn); the group's work branch is created at
 * that commit as the explicit start point, as the kernel will (§5.3). The real ccloop build (ORCA_CCLOOP_BIN) and its
 * scripted fake codex run one task, and everything the driver makes -- the attempt worktree, the attempt commit, the
 * landing on `orca/<groupId>` -- must live in the vault.
 *
 * If this cannot pass without changing ccloop or the driver beyond repository resolution, the builder stops (§16.2).
 */
import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { ccloopWorlds, g, noBlocked, realBinary, startGroup, until, workRuns } from "../control/fixtures/ccloopWorld.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-vault-probe-", epochPrefix: "epoch-vault-probe-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("vault as the driver's target repository (flow spec §5.2, C14 spike)", { timeout: 420_000 }, () => {
  relocateHome("orca-vault-probe-home-");

  it("P1: one task runs and lands with a bare vault as the target; worktree, attempt and orca/<group> are all in the vault", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["out.txt"] }], { a: { files: { "out.txt": "written\n" } } }, { bareTarget: true });
    expect(g(w.repo, "rev-parse", "--is-bare-repository")).toBe("true");
    const imported = g(w.repo, "rev-parse", "refs/heads/orca/g");
    // HEAD is unborn: nothing below may lean on it.
    expect(() => g(w.repo, "rev-parse", "--verify", "-q", "HEAD")).toThrow();
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      let worktreeSeen = false;
      await until(() => {
        noBlocked(runtime);
        const run = workRuns(runtime)[0];
        const drive = run?.body.drive;
        if (drive?.prepared === true && run!.body.state !== "settled" && existsSync(drive.workspacePath)) {
          // The driver adds and removes worktrees meanwhile (its landing one too); a list read mid-write is no answer, not a failure.
          let list: string[] = [];
          try { list = g(w.repo, "worktree", "list", "--porcelain").split("\n"); } catch { /* read again on the next poll */ }
          if (list.includes(`worktree ${drive.workspacePath}`)) worktreeSeen = true;
        }
        return drive?.cleanedUp === true;
      }, 360_000, "the run to settle", 20);
      expect(worktreeSeen).toBe(true);
      const drive = workRuns(runtime)[0]!.body.drive;
      expect(workRuns(runtime)[0]!.body.state).toBe("settled");
      // The attempt commit and the landing are objects of the vault, and orca/g moved from the import onto the landing.
      expect(g(w.repo, "cat-file", "-t", drive.attemptSha)).toBe("commit");
      const tip = g(w.repo, "rev-parse", "refs/heads/orca/g");
      expect(tip).toBe(drive.landedCommit);
      expect(tip).not.toBe(imported);
      expect(() => g(w.repo, "merge-base", "--is-ancestor", imported, tip)).not.toThrow();
      expect(g(w.repo, "show", "refs/heads/orca/g:out.txt")).toBe("written");
      expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("base");
      // Still bare, HEAD still unborn, and only the bare entry is left in the worktree list.
      expect(g(w.repo, "rev-parse", "--is-bare-repository")).toBe("true");
      expect(() => g(w.repo, "rev-parse", "--verify", "-q", "HEAD")).toThrow();
      expect(g(w.repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree "))).toEqual([`worktree ${w.repo}`]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
