import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createExecutionDriver, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { listPendingDecisions } from "../../src/control/pendingDecisions.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { reconcileDecision } from "../../src/scheduler/ledgerWiring.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";

// Control run decisions plan Task 6: a reconciled landing's merge commit holds both the conflicted run's own
// `.decisions/<runId>.jsonl` and the reconciliation's `.decisions/reconcile-<runId>.jsonl` (the reconcile
// template line, then what the reconciling agent reported). Every assertion reads git or the store.
const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
const files = (id: string) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" });
const LANDED = ["landed", "settled"];
const good = (over: Record<string, unknown> = {}) => ({
  question: "q",
  chose: "c",
  alternatives: [{ option: "o", why_not: "w" }],
  because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" },
  scope: "task",
  kind: "interface",
  ...over,
});
const ledgerLines = (repo: string, commit: string, ledgerRun: string): Record<string, unknown>[] =>
  git(repo, "show", `${commit}:.decisions/${ledgerRun}.jsonl`).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));

// The reconciliation is a background process, so its progress is wall-clock time, not rounds (driverReconcile.test.ts).
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

// The `twoConflicting` pattern of driverReconcile.test.ts, with the run's and the reconciliation's reported decisions.
async function twoConflicting(
  reconcile: { files: Record<string, string>; decisions?: unknown },
  runDecisions: HarnessOptions["decisions"],
) {
  const t = await driverHarness(conflicting, { files, decisions: runDecisions });
  await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
  const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const ids = [await t.claim(), await t.claim()];
  const spawns = () => existsSync(`${t.deps.agentsTablePath}.runs`) ? readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n") : [];
  const reconciled = () => ids.find((id) => t.body(id).drive?.reconcile != null);
  const setBody = (runId: string, change: (body: Record<string, any>) => Record<string, any>) => {
    const body = t.body(runId);
    t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(change(body)), runId);
  };
  return { ...t, ids, spawns, reconciled, setBody };
}

describe("R: a reconciled landing carries both runs' decisions (control run decisions Task 6)", { timeout: 60_000 }, () => {
  it("lands a reconciliation whose merge holds the run's file and the reconcile run's file", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, decisions: [good()] }, () => [good()]); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const runId = t.reconciled()!;
      const drive = t.body(runId).drive;
      const landed = drive.landedCommit;
      // Mutation R1: finishReconcile hands the unmodified tree to rebuildMergeCommit -> these `git show`s fail, red.
      const reconcileLines = ledgerLines(t.repo, landed, `reconcile-${runId}`);
      expect(reconcileLines.map((l) => l.id)).toEqual([`reconcile-${runId}/1`, `reconcile-${runId}/agent-0`]);
      expect(reconcileLines[0]!.kind).toBe("reconcile");
      expect(reconcileLines.map((l) => (l.evidence as string[]).slice(0, 2))).toEqual([
        [`run reconcile-${runId}`, `attempt ${drive.reconcile.attemptSha}`],
        [`run reconcile-${runId}`, `attempt ${drive.reconcile.attemptSha}`],
      ]);
      const runLines = ledgerLines(t.repo, landed, runId);
      expect(runLines.map((l) => l.id)).toEqual([`${runId}/agent-0`]);
      expect((runLines[0]!.evidence as string[]).slice(0, 2)).toEqual([`run ${runId}`, `attempt ${drive.attemptSha}`]);
      expect(git(t.repo, "rev-parse", `${landed}^2`)).toBe(drive.attemptSha);
      expect(git(t.repo, "show", `${landed}:shared.txt`)).toBe("A\nB");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(landed);
      // The other run's own ledger, already on the tip, is carried through unchanged.
      const other = t.ids.find((id) => id !== runId)!;
      expect(ledgerLines(t.repo, landed, other).map((l) => l.id)).toEqual([`${other}/agent-0`]);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("the reconcile line has the shared template's text", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }, undefined); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      const runId = t.reconciled()!;
      const run = t.body(runId);
      const record = run.drive.reconcile;
      const [line] = ledgerLines(t.repo, run.drive.landedCommit, `reconcile-${runId}`);
      expect(record.conflictBlocks.length).toBeGreaterThan(0);
      const expected = reconcileDecision(record.reconcileRunId, 1, run.taskId, record.otherTaskIds, {
        conflictedPaths: record.conflictedPaths, conflictCommit: record.conflictCommit, copyPath: record.copyPath, wTip: record.old, blocks: record.conflictBlocks,
      }, "orca/g", line!.at as string);
      expect(line!.question).toBe(expected.question);
      expect(line!.question).toContain(`(${record.conflictBlocks.length} block(s): shared.txt:`);
    } finally { await t.h.dispose(); }
  });

  it("re-lands on a moved tip without duplicating pending items", async () => {
    let moved: string | null = null;
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, decisions: [good({ kind: "opinion" })] }, undefined); try {
      const driver = createExecutionDriver({ ...t.deps, beforeCas: async () => {
        if (moved !== null || !t.ids.some((id) => t.body(id).state === "reconciling")) return;
        const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
        moved = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
        git(t.repo, "update-ref", "refs/heads/orca/g", moved, old);
      } });
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(moved).not.toBeNull();
      const runId = t.reconciled()!;
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "rev-parse", `${landed}^1`)).toBe(moved);
      expect(t.spawns()).toHaveLength(2);
      expect(ledgerLines(t.repo, landed, `reconcile-${runId}`).map((l) => l.id)).toEqual([`reconcile-${runId}/1`]);
      expect(listPendingDecisions(t.h.store, "g").map((p) => p.pendingId)).toEqual([`pending-reconcile-${runId}-0`]);
      expect(t.body(runId).drive.stagedPending).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  // Task 5 review finding: a D attempt that staged pending items and then hit a conflict reaches R with a stale
  // `drive.stagedPending`. R stages by replacement, so only what R computed becomes pending.
  it("inserts exactly the pending items R computed, never ones a D attempt staged before the conflict", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, decisions: [good({ kind: "opinion" })] }, () => [good(), good({ kind: "opinion" })]); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.reconciled() !== undefined && t.body(t.reconciled()!).state === "reconciling");
      const runId = t.reconciled()!;
      const stale = { pendingId: `pending-${runId}-7`, ledgerRun: runId, entryIndex: 7, entry: good({ kind: "stale" }), reason: "stale-d-attempt", at: "2026-10-18T00:00:00.000Z", evidence: [] };
      t.setBody(runId, (body) => ({ ...body, drive: { ...body.drive, stagedPending: [stale] } }));
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.body(runId).state).toBe("landed");
      const other = t.ids.find((id) => id !== runId)!;
      // Mutation "finishReconcile does not re-stage": the stale item is inserted and R's are not -> red.
      expect(listPendingDecisions(t.h.store, "g").map((p) => p.pendingId).sort()).toEqual(
        [`pending-${other}-1`, `pending-${runId}-1`, `pending-reconcile-${runId}-0`].sort(),
      );
      expect(t.body(runId).drive.stagedPending).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("skips the reconcile template for a record that predates conflictBlocks, and says so", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, decisions: [good()] }, undefined); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.reconciled() !== undefined && t.body(t.reconciled()!).state === "reconciling");
      const runId = t.reconciled()!;
      t.setBody(runId, (body) => {
        const { conflictBlocks: _dropped, ...record } = body.drive.reconcile;
        return { ...body, drive: { ...body.drive, reconcile: record } };
      });
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      const landed = t.body(runId).drive.landedCommit;
      expect(ledgerLines(t.repo, landed, `reconcile-${runId}`).map((l) => l.id)).toEqual([`reconcile-${runId}/agent-0`]);
      expect(stderr.mock.calls.map((call) => String(call[0]))).toContain(`orca-driver: ${runId}: reconcile decision skipped: record predates conflictBlocks\n`);
    } finally { stderr.mockRestore(); await t.h.dispose(); }
  });
});
