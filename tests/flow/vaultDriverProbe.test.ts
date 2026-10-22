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
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { flowVaultRepoId } from "../../src/flow/groups.js";
import { getFlowRun, listExecutions } from "../../src/flow/store.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { ccloopWorlds, g, noBlocked, realBinary, startGroup, until, workRuns } from "../control/fixtures/ccloopWorld.js";
import { flowGit, flowRunWorld } from "./fixtures/flowCcloopWorld.js";

/** Every file under `dir` with its bytes' hash and mode: a byte-level picture of the person's `.git`. */
function treeDigest(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[]).sort().map((rel) => {
    const path = join(dir, rel);
    const stat = statSync(path);
    return stat.isDirectory() ? `${rel}/ ${stat.mode}` : `${rel} ${stat.mode} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  });
}
const ONE_STEP = {
  yaml: `format: orca-flow-v1
id: one
workspace: {kind: dir}
roles:
  writer: {tier: low, suggest: {agent: codex}}
steps:
  - {id: write, kind: work, role: writer, prompt: prompts/write.md}
`,
  assets: { "prompts/write.md": "Write answer.txt.\n" },
};
const DECISION = {
  question: "Where does the answer go?", chose: "answer.txt", alternatives: [{ option: "README.md", why_not: "the folder's own" }], because: "it is asked for",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "small", blast_radius: "answer.txt" }, scope: "file", kind: "implementation", importance: "major",
};

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

  it("C14: a dir run's work step runs as a hidden child on the vault through the driver; the folder keeps its .git and gets copy-back", async () => {
    const vaults = await realpath(await mkdtemp(join(tmpdir(), "orca-vault-probe-vaults-")));
    const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults } });
    const f = await flowRunWorld(w, { templates: { one: ONE_STEP }, folder: { "notes.md": "the person's notes\n" }, gitFolder: true, decisions: [DECISION] });
    const gitBefore = treeDigest(join(f.folder, ".git"));
    const vaultId = vaultKeyOf(realpathSync(f.folder));
    try {
      const { runtime, flowRunId, groupId } = await f.start("builtin/one");
      // The vault's repository has a non-keep default: a dir flow group keeps all the same (§5.1).
      writeRepositorySettingsBody(runtime.store, flowVaultRepoId(vaultId), { workspaceMode: "worktree", revision: 1, integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } });
      runtime.startPump(50);
      await until(() => {
        const stuck = listExecutions(runtime.store, flowRunId).find((e) => e.state === "failed" || e.state === "parked");
        if (stuck !== undefined) throw new Error(`${stuck.stepKey}#${stuck.seq} ${stuck.state}: ${JSON.stringify(stuck.body)}`);
        return getFlowRun(runtime.store, flowRunId)!.state === "done";
      }, 180_000, "the run to complete", 100);
      const run = getFlowRun(runtime.store, flowRunId)!;
      expect(run.vaultId).toBe(vaultId);
      const vault = join(vaults, `${vaultId}.git`);
      const execution = listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === "write")!;
      const child = execution.childGroupId!;
      // A hidden child with its own archived plan, confirmed proposal and snapshot; the parent has no task.
      expect(readArchivedPlan(runtime.store, child).plan.tasks.map((t) => t.taskId)).toEqual(["step"]);
      expect(readBudgetProposal(runtime.store, child)).toMatchObject({ state: "confirmed", executionSnapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(runtime.store.db.prepare("SELECT count(*) AS n FROM work_items WHERE group_id=?").get(groupId)).toMatchObject({ n: 0 });
      // The driver ran it with the vault as the target repository, from the composition.
      const childRun = runtime.store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(child).map((r) => JSON.parse(String(r.body))).find((r) => r.phase === "work")!;
      expect(childRun.drive.targetRepo).toBe(vault);
      expect(childRun.drive.base).toBe(execution.baseCommit);
      expect(g(vault, "cat-file", "-t", childRun.drive.attemptSha)).toBe("commit");
      expect(g(vault, "rev-parse", `refs/heads/orca/${child}`)).toBe(childRun.drive.landedCommit);
      expect(g(vault, "show", `refs/heads/orca/${child}:answer.txt`)).toBe("42");
      // No ledger file in the vault's history, no integration, nothing in the person's .git.
      expect(g(vault, "ls-tree", "-r", "--name-only", childRun.drive.landedCommit).split("\n").filter((p) => p.startsWith(".decisions/"))).toEqual([]);
      expect(Object.hasOwn(JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id=?").get(child)!.body)), "integration")).toBe(false);
      expect(g(vault, "for-each-ref", "--format=%(refname)").split("\n").filter((ref) => ref.startsWith("refs/heads/") && !ref.startsWith("refs/heads/orca/"))).toEqual([]);
      expect(runtime.store.db.prepare("SELECT grade, step_key FROM flow_decisions WHERE flow_run_id=?").all(flowRunId).map((r) => [String(r.grade), String(r.step_key)])).toEqual([["major", "write"]]);
      // The folder received the output by copy-back; its .git is byte-equal and its own history unmoved.
      expect(readFileSync(join(f.folder, "answer.txt"), "utf8")).toBe("42\n");
      expect(existsSync(join(f.folder, ".decisions"))).toBe(false);
      expect(treeDigest(join(f.folder, ".git"))).toEqual(gitBefore);
      expect(flowGit(f.folder, "log", "--format=%s")).toBe("the person's own history");
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
