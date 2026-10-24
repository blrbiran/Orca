/**
 * Dir-requirements spec §10.1 (plan Task 6, D9): a reconciled landing of a `dir` flow child commits no `.decisions/`
 * -- the reconciled tree is what copy-back puts into the person's folder. The run's and the reconciliation's rows go to
 * `flow_decisions` in the landing's write, and a replay that finds the run's rows there stages none. Every assertion
 * reads git or the store.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { listPendingDecisions } from "../../src/control/pendingDecisions.js";
import { insertFlowRun } from "../../src/flow/store.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git, type HarnessOptions } from "../control/fixtures/driverHarness.js";

const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
const files = (id: string) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" });
const LANDED = ["landed", "settled"];
const good = (over: Record<string, unknown> = {}) => ({
  question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" }, scope: "task", kind: "interface", ...over,
});

/** Make the harness's confirmed group `g` the `write` child of a `dir` flow run (the shape the child port opens). */
function asDirFlowChild(t: Awaited<ReturnType<typeof driverHarness>>): void {
  const store = t.h.store;
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('parent',0,1,0,?)").run(JSON.stringify({ groupId: "parent", status: "flow" }));
  insertFlowRun(store, {
    id: "fr-1", groupId: "parent", templateRef: "builtin/x", templateSha256: "t", workspace: { projectId: null, kind: "dir" }, vaultId: "f".repeat(64),
    paramsSha256: "p", poolTokens: 1, poolDrawn: 0, state: "running", revision: 0, body: {},
  });
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, flow: { role: "child", flowRunId: "fr-1", parentGroupId: "parent", stepKey: "write", seq: 1 } }));
}

const rows = (t: Awaited<ReturnType<typeof driverHarness>>) => t.h.store.db.prepare("SELECT seq, grade, step_key, body, \"by\" FROM flow_decisions WHERE flow_run_id='fr-1' ORDER BY seq").all()
  .map((row) => ({ seq: Number(row.seq), grade: String(row.grade), stepKey: String(row.step_key), id: JSON.parse(String(row.body)).id, by: String(row.by) }));
const inTree = (repo: string, commit: string, path: string): boolean => git(repo, "ls-tree", "-r", "--name-only", commit).split("\n").includes(path);

// The reconciliation is a background process, so its progress is wall-clock time, not rounds (driverReconcile.test.ts).
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

// The `twoConflicting` pattern of driverReconcileDecisions.test.ts, with the run's and the reconciliation's decisions.
async function twoConflicting(reconcile: { files: Record<string, string>; decisions?: unknown }, runDecisions: HarnessOptions["decisions"]) {
  const t = await driverHarness(conflicting, { files, decisions: runDecisions });
  asDirFlowChild(t);
  await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
  const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const ids = [await t.claim(), await t.claim()];
  const spawned = () => existsSync(`${t.deps.agentsTablePath}.runs`) ? readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n") : [];
  const reconciled = () => ids.find((id) => t.body(id).drive?.reconcile != null);
  const setBody = (runId: string, change: (body: Record<string, any>) => Record<string, any>) => {
    const body = t.body(runId);
    t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(change(body)), runId);
  };
  return { ...t, ids, spawned, reconciled, setBody };
}

describe("R: a reconciled dir flow landing writes flow_decisions, never .decisions/ (D9)", { timeout: 60_000 }, () => {
  it("records the run's and the reconciler's rows in flow_decisions and commits no .decisions/ file", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, decisions: [good()] }, () => [good()]); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const runId = t.reconciled()!;
      const drive = t.body(runId).drive;
      const landed = drive.landedCommit;
      expect(git(t.repo, "rev-parse", `${landed}^2`)).toBe(drive.attemptSha);
      expect(git(t.repo, "show", `${landed}:shared.txt`)).toBe("A\nB");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(landed);
      // Mutation "drop-finishReconcile-dir-branch": the git ledger lands here -> both are true, red.
      expect(inTree(t.repo, landed, `.decisions/${runId}.jsonl`)).toBe(false);
      expect(inTree(t.repo, landed, `.decisions/reconcile-${runId}.jsonl`)).toBe(false);
      // The other run landed as a dir flow landing too; only this run's rows are ordered by this landing's write.
      const other = t.ids.find((id) => id !== runId)!;
      expect(rows(t).map((r) => r.id).sort()).toEqual([
        `${other}/agent-0`, `${runId}/agent-0`, `reconcile-${runId}/1`, `reconcile-${runId}/agent-0`,
      ].sort());
      const mine = rows(t).filter((r) => r.id === `${runId}/agent-0` || r.id.startsWith(`reconcile-${runId}/`));
      expect(mine.map((r) => r.id)).toEqual([`${runId}/agent-0`, `reconcile-${runId}/1`, `reconcile-${runId}/agent-0`]);
      expect(mine.map((r) => [r.grade, r.stepKey, r.by])).toEqual([
        ["major", "write", "orca-auto"], ["major", "write", "orca-auto"], ["major", "write", "orca-auto"],
      ]);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
      expect(t.body(runId).drive.stagedFlowDecisions).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a replay that finds the run's rows in flow_decisions stages none (the probe reads flow_decisions)", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, decisions: [good()] }, () => [good()]); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      const runId = t.reconciled()!;
      const written = rows(t);
      expect(written).toHaveLength(4);
      // A death after the landing's write leaves exactly this: the run is collected again, its rows are already there.
      t.setBody(runId, (body) => ({ ...body, state: "reconciling" }));
      await untilDeadline(driver, () => t.body(runId).state === "landed" || t.body(runId).state === "settled");
      expect(t.body(runId).state).toMatch(/^landed|settled/);
      // Mutation "skip-replay-probe": the events are staged again and D's recovery landing writes them twice -> six.
      expect(rows(t)).toEqual(written);
    } finally { await t.h.dispose(); }
  });
});
