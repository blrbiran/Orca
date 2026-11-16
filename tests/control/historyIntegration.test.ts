import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { applyRetryIntegration } from "../../src/control/integrationCommands.js";
import { newGroupIntegration, readGroupIntegration, schemeHash, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { historySourcePinRef } from "../../src/control/historySource.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { webFixture } from "./fixtures/web.js";

const git = (repo: string, ...args: string[]): string => execFileSync("git",
  ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
  { cwd: repo, encoding: "utf8", env: { ...process.env, ...unsetInheritedGitEnv() } }).trim();

const SCHEME: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main",
  historyExpectation: { version: 1, targetRef: "refs/heads/main", directSecondParent: true,
    sourceRefs: [{ taskId: "a", ref: "refs/heads/orca/dogfood-a" }, { taskId: "b", ref: "refs/heads/orca/dogfood-b" }],
    artifactPaths: ["MERGE-NOTES.md"] } };

async function world(options: { sourceBConflicts?: boolean; artifactMissing?: boolean; sourceAAncestor?: boolean; sourceAEqualsTarget?: boolean } = {}) {
  const h = await webFixture(undefined, [{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]);
  const repo = join(h.root, "repo");
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, "add", "base.txt"); git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "main");
  // The fixture's untracked plan.json is not a person-owned dirty target worktree: keep main un-checked-out.
  git(repo, "checkout", "-q", "-b", "other");
  let ordinal = 0;
  const commitOn = (ref: string, parent: string, files: Record<string, string>): string => {
    const env = { ...process.env, ...unsetInheritedGitEnv(), GIT_INDEX_FILE: join(h.root, `index-${++ordinal}`) };
    const run = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd: repo, encoding: "utf8", env }).trim();
    run("read-tree", parent);
    for (const [path, text] of Object.entries(files)) {
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, encoding: "utf8", input: text, env }).trim();
      run("update-index", "--add", "--cacheinfo", `100644,${blob},${path}`);
    }
    const tree = run("write-tree"), next = run("commit-tree", tree, "-p", parent, "-m", `commit ${ordinal}`);
    git(repo, "update-ref", ref, next);
    return next;
  };
  const sourceA = options.sourceAAncestor || options.sourceAEqualsTarget
    ? (git(repo, "update-ref", "refs/heads/orca/dogfood-a", base), base)
    : commitOn("refs/heads/orca/dogfood-a", base, { "src-a.txt": "A\n" });
  const sourceB = commitOn("refs/heads/orca/dogfood-b", base,
    options.sourceBConflicts ? { "src-a.txt": "B\n" } : { "src-b.txt": "B\n" });
  const taskA = commitOn("refs/heads/orca/g", base, { "work-a.txt": "work A\n" });
  const groupTip = commitOn("refs/heads/orca/g", taskA,
    options.artifactMissing ? { "other.txt": "no notes\n" } : { "MERGE-NOTES.md": "two ordered merges\n" });
  const targetBase = options.sourceAAncestor ? commitOn("refs/heads/main", base, { "main-only.txt": "operator\n" }) : base;
  for (const [taskId, sha] of [["a", sourceA], ["b", sourceB]] as const) git(repo, "update-ref", historySourcePinRef("g", taskId, `run-${taskId}`), sha);
  const group = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  group.status = "review";
  group.acceptance = { tip: groupTip, result: "passed", commands: [], at: 1 };
  group.integration = { ...newGroupIntegration(SCHEME)!, frozen: true,
    historyBindings: [{ taskId: "a", runId: "run-a", landedCommit: taskA, sourceRef: "refs/heads/orca/dogfood-a", sourceSha: sourceA, contractHash: schemeHash(SCHEME) },
      { taskId: "b", runId: "run-b", landedCommit: groupTip, sourceRef: "refs/heads/orca/dogfood-b", sourceSha: sourceB, contractHash: schemeHash(SCHEME) }] };
  h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
  for (const id of ["a", "b"]) {
    const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body));
    work.status = "done";
    h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(work), id);
  }
  const deps: IntegrationDeps = { store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate,
    repoPathOf: () => repo, now: () => 1_000_000, ghBin: "/bin/false", stopped: () => false };
  return { h, repo, base: targetBase, groupTip, sourceA, sourceB, deps,
    record: () => readGroupIntegration(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)))!,
    commitOn };
}

describe("literal source-branch history delivery (#328)", { timeout: 60_000 }, () => {
  it("publishes each named source as the direct second parent in order, then carries the group artifact", async () => {
    const w = await world(); try {
      expect(await integratePendingGroups(w.deps)).toBe(true);
      const target = git(w.repo, "rev-parse", "refs/heads/main");
      const parents = git(w.repo, "rev-list", "--first-parent", `${w.base}..${target}`)
        .split("\n").filter(Boolean).reverse().map(sha => git(w.repo, "show", "-s", "--format=%P", sha).split(" "))
        .filter(shas => shas.length === 2).map(shas => shas[1]);
      expect(parents).toEqual([w.sourceA, w.sourceB]);
      expect(git(w.repo, "show", `${target}:MERGE-NOTES.md`)).toBe("two ordered merges");
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: w.groupTip,
        historyPublished: { groupTip: w.groupTip, targetTip: target } });
    } finally { await w.h.dispose(); }
  });

  it.each(["after-pending", "after-publish"] as const)("recovers a whole chain after %s without duplicating a source merge", async point => {
    const w = await world(); try {
      await expect(integratePendingGroups({ ...w.deps, crash: at => { if (at === point) throw new Error(`crash ${point}`); } }))
        .rejects.toThrow(`crash ${point}`);
      const pending = w.record().pending;
      expect(pending?.history).toMatchObject({ groupTip: w.groupTip, merges: [{ sourceSha: w.sourceA }, { sourceSha: w.sourceB }] });
      if (point === "after-pending") expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(w.base);
      else expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(pending!.new);
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(pending!.new);
      expect(w.record()).toMatchObject({ state: "idle", pending: null, historyPublished: { targetTip: pending!.new } });
      expect(await integratePendingGroups(w.deps)).toBe(false);
    } finally { await w.h.dispose(); }
  });

  it("rebuilds the same frozen sources on a target that moves once before the final CAS", async () => {
    const w = await world(); try {
      let moved: string | null = null;
      expect(await integratePendingGroups({ ...w.deps, beforePublish: async () => {
        if (moved !== null) return;
        moved = w.commitOn("refs/heads/main", w.base, { "operator.txt": "operator\n" });
      } })).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", pending: null,
        historyPublished: { base: moved, merges: [{ sourceSha: w.sourceA }, { sourceSha: w.sourceB }] } });
      expect(git(w.repo, "show", "main:operator.txt")).toBe("operator");
    } finally { await w.h.dispose(); }
  });

  it("uses the bound SHA even if its named branch moves before delivery", async () => {
    const w = await world(); try {
      w.commitOn("refs/heads/orca/dogfood-a", w.sourceA, { "src-a.txt": "changed after binding\n" });
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record().historyPublished?.merges[0]).toMatchObject({ sourceSha: w.sourceA });
      expect(git(w.repo, "show", "main:src-a.txt")).toBe("A");
    } finally { await w.h.dispose(); }
  });

  it("refuses a missing private source pin before publishing target history", async () => {
    const w = await world(); try {
      git(w.repo, "update-ref", "-d", historySourcePinRef("g", "a", "run-a"));
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "history-source-pin-invalid:refs/heads/orca/dogfood-a" });
      expect(git(w.repo, "rev-parse", "main")).toBe(w.base);
    } finally { await w.h.dispose(); }
  });

  it("refuses an identical source and target tip rather than claiming a Git merge with one parent", async () => {
    const w = await world({ sourceAEqualsTarget: true }); try {
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "history-source-equals-target:refs/heads/orca/dogfood-a" });
      expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(w.base);
    } finally { await w.h.dispose(); }
  });

  it("makes a real second parent even when the named source is already an ancestor", async () => {
    const w = await world({ sourceAAncestor: true }); try {
      expect(await integratePendingGroups(w.deps)).toBe(true);
      const published = w.record().historyPublished!;
      expect(published.merges[0]).toMatchObject({ sourceSha: w.sourceA, previous: w.base });
      expect(git(w.repo, "show", "-s", "--format=%P", published.merges[0]!.commit).split(" "))
        .toEqual([w.base, w.sourceA]);
    } finally { await w.h.dispose(); }
  });

  it("blocks before changing the target if the required artifact is absent", async () => {
    const w = await world({ artifactMissing: true }); try {
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "history-artifact-missing:MERGE-NOTES.md",
        pending: null, lastIntegrated: null });
      expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(w.base);
    } finally { await w.h.dispose(); }
  });

  it("names the conflicting source and path without publishing a partial merge prefix", async () => {
    const w = await world({ sourceBConflicts: true }); try {
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record().state).toBe("blocked");
      expect(w.record().reason).toContain("history-source-conflict:refs/heads/orca/dogfood-b:src-a.txt");
      expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(w.base);
      expect(w.record().historyPublished).toBeUndefined();
    } finally { await w.h.dispose(); }
  });

  it("refuses a corrupted pending parent chain before publishing any target commit", async () => {
    const w = await world(); try {
      await expect(integratePendingGroups({ ...w.deps, crash: at => { if (at === "after-pending") throw new Error("crash"); } })).rejects.toThrow("crash");
      const group = JSON.parse(String(w.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      group.integration.pending.history.merges[0].commit = w.base;
      w.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "history-pending-invalid" });
      expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(w.base);
    } finally { await w.h.dispose(); }
  });

  it("keeps a corrupt published pending record so retry cannot append duplicate merges", async () => {
    const w = await world(); try {
      await expect(integratePendingGroups({ ...w.deps, crash: at => { if (at === "after-publish") throw new Error("crash"); } })).rejects.toThrow("crash");
      const publishedTip = git(w.repo, "rev-parse", "main");
      const group = JSON.parse(String(w.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      group.integration.pending.history.merges[0].commit = w.base;
      w.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "history-pending-invalid",
        pending: { new: publishedTip, history: { groupTip: w.groupTip } } });
      expect(applyRetryIntegration({ store: w.h.store }, w.h.command("retry-integration", {}) as never)).toHaveProperty("result");
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(git(w.repo, "rev-parse", "main")).toBe(publishedTip);
      expect(w.record().historyPublished).toBeUndefined();
    } finally { await w.h.dispose(); }
  });

  it("ignores Git replacement objects when constructing source trees", async () => {
    const w = await world(); try {
      const replacement = w.commitOn("refs/heads/test-replacement", w.base, { "src-a.txt": "FORGED\n" });
      git(w.repo, "replace", w.sourceA, replacement);
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record().state).toBe("idle");
      expect(git(w.repo, "show", "main:src-a.txt")).toBe("A");
    } finally { await w.h.dispose(); }
  });

  it("notices a target move after publication instead of silently reusing old evidence", async () => {
    const w = await world(); try {
      expect(await integratePendingGroups(w.deps)).toBe(true);
      const published = w.record().historyPublished!;
      w.commitOn("refs/heads/main", published.targetTip, { "operator.txt": "new\n" });
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "history-target-moved-after-publication",
        historyPublished: { targetTip: published.targetTip } });
    } finally { await w.h.dispose(); }
  });

  it("retries the frozen sources after a person resolves a source conflict on the target", async () => {
    const w = await world({ sourceBConflicts: true }); try {
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record().state).toBe("blocked");
      // The person resolves both source tips in one explicit target commit; Orca must still write its own direct-parent merges.
      const resolved = git(w.repo, "commit-tree", `${w.sourceA}^{tree}`, "-p", w.base, "-p", w.sourceA, "-p", w.sourceB, "-m", "operator resolution");
      git(w.repo, "update-ref", "refs/heads/main", resolved, w.base);
      expect(applyRetryIntegration({ store: w.h.store }, w.h.command("retry-integration", {}) as never))
        .toMatchObject({ result: { kind: "integration-retried" } });
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", historyPublished: { base: resolved,
        merges: [{ sourceSha: w.sourceA }, { sourceSha: w.sourceB }] } });
      expect(git(w.repo, "show", "main:MERGE-NOTES.md")).toBe("two ordered merges");
    } finally { await w.h.dispose(); }
  });

  it("does not touch the person's dirty checkout when main is checked out", async () => {
    const w = await world(); try {
      git(w.repo, "checkout", "-q", "main");
      writeFileSync(join(w.repo, "person.txt"), "keep me\n");
      expect(await integratePendingGroups(w.deps)).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-worktree-dirty" });
      expect(git(w.repo, "rev-parse", "refs/heads/main")).toBe(w.base);
      expect(readFileSync(join(w.repo, "person.txt"), "utf8")).toBe("keep me\n");
    } finally { await w.h.dispose(); }
  });
});
