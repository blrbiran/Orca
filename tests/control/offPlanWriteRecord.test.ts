/**
 * Off-plan writes spec W3 (#346, plan Task 4): when a run lands, the paths its attempt changed outside its task's
 * targetPaths are recorded as one `off-plan-write` activity row, written in the same transaction that makes the run
 * `landed` -- so a row exists exactly when the landing was recorded, and a replayed landing writes none again. The record
 * is information only: it never blocks or fails a landing. The run view carries it, and the requirement review is told.
 *
 * Off-plan files only reach a landing when the task's write set (targetPaths ∪ allowlistPaths) covers them, so these
 * tasks declare `targetPaths` narrow and `allowlistPaths: ["**"]`; the recorded paths are those outside `targetPaths`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DriverCrash, createExecutionDriver, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { OFF_PLAN_PATHS_MAX, offPlanPaths, offPlanWriteOf } from "../../src/control/offPlanWrites.js";
import { reviewFacts } from "../../src/control/requirementReview.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";

const LANDED = ["landed", "settled"];
const WIDE = { allowlistPaths: ["**"] };
const offPlanRows = (t: Awaited<ReturnType<typeof driverHarness>>) => t.h.store.db
  .prepare("SELECT task_id, run_id, body FROM activity WHERE group_id='g' AND kind='off-plan-write' ORDER BY seq").all()
  .map((row) => ({ taskId: row.task_id, runId: row.run_id, body: JSON.parse(String(row.body)) as { taskId: string; runId: string; paths: string[]; count: number } }));
/** `extra/f00.txt` .. : n files outside every target, in their sorted order. */
const extras = (n: number, prefix = "extra/f"): Record<string, string> =>
  Object.fromEntries(Array.from({ length: n }, (_, index) => [`${prefix}${String(index).padStart(2, "0")}.txt`, `${index}\n`]));

describe("offPlanPaths: the changed paths no target covers (pure)", () => {
  it("names the paths outside the targets, sorted", () => {
    expect(offPlanPaths(["src/a.ts", "src/board/cli.js", "README.md"], ["src/a.ts"])).toEqual(["README.md", "src/board/cli.js"]);
  });

  it("a directory target covers what lies under it, by path segment", () => {
    expect(offPlanPaths(["src/x/y.ts"], ["src/**"])).toEqual([]);
    // "src/a" does not cover "src/ab.ts": containment is per segment, as the write-set rules compare.
    expect(offPlanPaths(["src/ab.ts", "src/a/b.ts"], ["src/a"])).toEqual(["src/ab.ts"]);
  });

  it("the ledger Orca itself writes is never off-plan", () => {
    // mutation: drop the `.decisions` exclusion -> `.decisions/r.jsonl` is listed, red
    expect(offPlanPaths([".decisions/r.jsonl", "x.txt"], ["y.txt"])).toEqual(["x.txt"]);
    // Only the directory: a file merely named like it is still a write the plan did not name.
    expect(offPlanPaths([".decisions.md"], ["y.txt"])).toEqual([".decisions.md"]);
  });
});

describe("offPlanWriteOf: the record of one attempt, read from git", () => {
  it("caps the paths at 64 and keeps the full count; a git that cannot answer records nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-off-plan-")); try {
      git(root, "init", "-q", "-b", "main");
      await writeFile(join(root, "a.txt"), "a\n");
      git(root, "add", "a.txt"); git(root, "commit", "-qm", "base");
      const base = git(root, "rev-parse", "HEAD");
      for (const [path, text] of Object.entries(extras(70, "f"))) await writeFile(join(root, path), text);
      git(root, "add", "-A"); git(root, "commit", "-qm", "attempt");
      const record = await offPlanWriteOf(root, base, git(root, "rev-parse", "HEAD"), ["a.txt"]);
      // mutation: drop the cap -> 70 paths, red
      expect(OFF_PLAN_PATHS_MAX).toBe(64);
      expect(record).toEqual({ paths: Object.keys(extras(64, "f")), count: 70 });
      // Information only (spec W3): an unreadable range is no record, never an error that could block the landing.
      // mutation: drop the catch -> the call rejects, red
      expect(await offPlanWriteOf(join(root, "missing"), base, base, ["a.txt"])).toBe(null);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("a landing records its off-plan writes with the landing (D)", () => {
  it("70 off-plan files: one row with the first 64 sorted paths and count 70; the run view and the review facts say so", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["src/a.ts"], safetyPolicy: WIDE }], { files: () => ({ "src/a.ts": "a\n", ...extras(70) }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const paths = Object.keys(extras(64));
      // mutation: skip the row write in markLanded -> no row, red
      expect(offPlanRows(t)).toEqual([{ taskId: "a", runId, body: { taskId: "a", runId, paths, count: 70 } }]);
      // The task view's run line and `task show`/`run show` read it from the run view.
      // mutation: drop offPlanWrites from runViews -> undefined, red
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((run) => run.runId === runId)?.offPlanWrites).toEqual({ paths, count: 70 });
      // The review prompt's "What Orca recorded beyond the diff": one line per task with records.
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      // mutation: drop the off-plan lines from reviewFacts -> no such line, red
      expect(await reviewFacts(t.repo, {}, tip, t.h.store, "g")).toContain(`Off-plan writes by a: ${paths.join(", ")} (+6 more)`);
    } finally { await t.h.dispose(); }
  }, 30_000);

  it("a landing with no off-plan path records no row, and the review facts carry no such line", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["src/**"], safetyPolicy: WIDE }], { files: () => ({ "src/a.ts": "a\n", "src/b/c.ts": "c\n" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      // mutation: record a row with an empty list -> one row, red
      expect(offPlanRows(t)).toEqual([]);
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((run) => run.runId === runId)).not.toHaveProperty("offPlanWrites");
      const facts = await reviewFacts(t.repo, {}, git(t.repo, "rev-parse", "refs/heads/orca/g"), t.h.store, "g");
      expect(facts.some((line) => line.startsWith("Off-plan writes"))).toBe(false);
    } finally { await t.h.dispose(); }
  }, 30_000);

  it("a landing found after a death past the swap is recorded once, by the recovery (findLanding)", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"], safetyPolicy: WIDE }], { files: () => ({ a: "a\n", "notes.md": "n\n" }) }); try {
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (point) => { if (point === "D-after-cas") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed === "D-after-cas");
      await crashing.stop();
      expect(t.body(runId).state).toBe("collected");
      expect(offPlanRows(t)).toEqual([]);
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      // mutation: pass no record from the findLanding branch -> no row, red
      expect(offPlanRows(t).map((row) => row.body)).toEqual([{ taskId: "a", runId, paths: ["notes.md"], count: 1 }]);
    } finally { await t.h.dispose(); }
  }, 30_000);

  it("a landing that waited for its post-merge check records it too", async () => {
    // b lands after a moved the tip, so b's merged tree is one no check ran on: it lands through the post-merge check.
    const files: HarnessOptions["files"] = (id) => ({ [id]: `${id}\n`, [`${id}-notes.md`]: "n\n" });
    const t = await driverHarness([{ taskId: "a", safetyPolicy: WIDE }, { taskId: "b", safetyPolicy: WIDE }], { files }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver: ExecutionDriver = t.driver();
      await t.until(driver, () => ids.every((id) => LANDED.includes(t.body(id).state)), 120);
      const checked = ids.filter((id) => t.body(id).drive.postMergeCheck?.result === "passed");
      expect(checked).toHaveLength(1);
      const rows = offPlanRows(t);
      // mutation: pass no record from the post-merge-check branch -> one row, red
      expect(rows.map((row) => row.body).sort((x, y) => x.taskId.localeCompare(y.taskId))).toEqual([
        { taskId: "a", runId: rows.find((row) => row.taskId === "a")!.runId, paths: ["a-notes.md"], count: 1 },
        { taskId: "b", runId: rows.find((row) => row.taskId === "b")!.runId, paths: ["b-notes.md"], count: 1 },
      ]);
      expect(rows.map((row) => row.runId)).toContain(checked[0]);
    } finally { await t.h.dispose(); }
  }, 60_000);
});

// The reconciliation is a background process, so its progress is wall-clock time (dirGroupLandedTip.test.ts).
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 50)); await driver.round(); }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

describe("a reconciled landing records the task's own off-plan writes (R)", () => {
  it("the run that reconciled records its attempt's paths outside its targets, with its landing", async () => {
    const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"], safetyPolicy: WIDE }, { taskId: "b", targetPaths: ["shared.txt"], safetyPolicy: WIDE }];
    const files: HarnessOptions["files"] = (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n", [`${id}-notes.md`]: "n\n" });
    const t = await driverHarness(conflicting, { files }); try {
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
      const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      const ids = [await t.claim(), await t.claim()];
      await untilDeadline(t.driver(), () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const reconciled = ids.find((id) => t.body(id).drive?.reconcile != null)!;
      const taskId = t.body(reconciled).taskId as string;
      // mutation: skip the row write in finishReconcile's landed branch -> only the plain landing's row, red
      expect(offPlanRows(t).find((row) => row.runId === reconciled)?.body).toEqual({ taskId, runId: reconciled, paths: [`${taskId}-notes.md`], count: 1 });
      expect(offPlanRows(t)).toHaveLength(2);
    } finally { await t.h.dispose(); }
  }, 60_000);
});
