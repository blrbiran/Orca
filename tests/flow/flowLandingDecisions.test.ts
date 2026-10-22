/**
 * Flow engine spec §6.2 (plan Task 10, C14 part): a `dir` flow child's landing writes the decisions its run reported to
 * `flow_decisions`, in the same write that records the landing, and commits no `.decisions/` file -- the vault's tree
 * is what copy-back puts into the person's folder, so a `.decisions/` file there would land in their folder. A refused
 * entry is still a pending decision. An empty result (no landing merge) writes its decisions the same way, without the
 * ledger-only commit, once. Every assertion reads git or the store.
 */
import { describe, expect, it } from "vitest";
import { DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
import { listPendingDecisions } from "../../src/control/pendingDecisions.js";
import { insertFlowRun } from "../../src/flow/store.js";
import { driverHarness, git } from "../control/fixtures/driverHarness.js";

const good = (over: Record<string, unknown> = {}) => ({
  question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" }, scope: "task", kind: "interface", ...over,
});
const LANDED = ["landed", "settled"];
const BRANCH = "refs/heads/orca/g";

/** Make the harness's confirmed group `g` the `write` child of a `dir` flow run (the shape the child port opens). */
function asDirFlowChild(t: Awaited<ReturnType<typeof driverHarness>>, kind: "dir" | "repo" = "dir"): string {
  const store = t.h.store;
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('parent',0,1,0,?)").run(JSON.stringify({ groupId: "parent", status: "flow" }));
  insertFlowRun(store, {
    id: "fr-1", groupId: "parent", templateRef: "builtin/x", templateSha256: "t", workspace: { projectId: null, kind }, vaultId: "f".repeat(64),
    paramsSha256: "p", poolTokens: 1, poolDrawn: 0, state: "running", revision: 0, body: {},
  });
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, flow: { role: "child", flowRunId: "fr-1", parentGroupId: "parent", stepKey: "write", seq: 1 } }));
  return "fr-1";
}
const rows = (t: Awaited<ReturnType<typeof driverHarness>>) => t.h.store.db.prepare("SELECT seq, grade, step_key, body, \"by\" FROM flow_decisions WHERE flow_run_id='fr-1' ORDER BY seq").all()
  .map((row) => ({ seq: Number(row.seq), grade: String(row.grade), stepKey: String(row.step_key), id: JSON.parse(String(row.body)).id, by: String(row.by) }));
const inTree = (repo: string, commit: string, path: string): boolean => git(repo, "ls-tree", "-r", "--name-only", commit).split("\n").includes(path);

describe("dir flow landings write flow_decisions, never .decisions/ (C14 part)", () => {
  it("a landing records the reported decisions in flow_decisions and commits no .decisions/ file; a refused entry is pending", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good({ importance: "minor" }), good({ kind: "opinion" }), good()] }); try {
      asDirFlowChild(t);
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "show", `${landed}:a`)).toBe("a");
      expect(inTree(t.repo, landed, `.decisions/${runId}.jsonl`)).toBe(false);
      expect(rows(t)).toEqual([
        { seq: 1, grade: "minor", stepKey: "write", id: `${runId}/agent-0`, by: "orca-auto" },
        { seq: 2, grade: "major", stepKey: "write", id: `${runId}/agent-2`, by: "orca-auto" },
      ]);
      expect(listPendingDecisions(t.h.store, "g").map((p) => p.pendingId)).toEqual([`pending-${runId}-1`]);
      expect(t.body(runId).drive.stagedFlowDecisions).toEqual([]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("an empty result writes its decisions to flow_decisions once, with no ledger-only commit", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), decisions: () => [good()] }); try {
      asDirFlowChild(t);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(drive.base);
      expect(drive.ledgerCommit).toBe(null);
      expect(rows(t)).toEqual([{ seq: 1, grade: "major", stepKey: "write", id: `${runId}/agent-0`, by: "orca-auto" }]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("a death after the result was recorded replays E without writing the decisions twice (the probe reads flow_decisions)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), decisions: () => [good()] }); try {
      asDirFlowChild(t);
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (point) => { if (point === "E-after-acceptance") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed === "E-after-acceptance");
      expect(t.body(runId).state).toBe("landed");
      expect(rows(t)).toHaveLength(1);
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(rows(t)).toEqual([{ seq: 1, grade: "major", stepKey: "write", id: `${runId}/agent-0`, by: "orca-auto" }]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("a repo-workspace flow group keeps the git ledger (only dir runs move to flow_decisions)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good()] }); try {
      asDirFlowChild(t, "repo");
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      expect(inTree(t.repo, t.body(runId).drive.landedCommit, `.decisions/${runId}.jsonl`)).toBe(true);
      expect(rows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  }, 30000);
});
