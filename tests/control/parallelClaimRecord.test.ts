/**
 * Off-plan writes #346, W4, plan Task 5 fix round 1 (controller ruling, Orca session 4389b15f, 2026-11-18): a stop on a
 * parallel sibling's frozen claim is classified once, when the driver records the block, and kept on the drive record as
 * `drive.parallelClaim` -- absent when the stop is on no sibling's claim. Two block sites are driven here through the
 * synthetic ccloop: ccloop's `blocked_waiting_human` terminal with `denylist match: <path>`, and Orca's own harvest bound
 * at collect (`out-of-bounds:<paths>`). The stored claim is what the diagnosis reads, so it outlives a later change to the
 * task's frozen entry (Task 6's `--after` drops that sibling).
 */
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";

const CLAIM = { path: "b", repoKey: null, siblingIds: ["b"] };
const alphaKey = controlRepoKey("alpha");
/** A second real repository, "alpha", beside the fixture's "repo" (as multiDirDispatch.test.ts registers it). */
const withAlpha = async (root: string): Promise<Record<string, string>> => {
  const alpha = join(root, "alpha"); await mkdir(alpha); git(alpha, "init", "-q", "-b", "main");
  await writeFile(join(alpha, "base.txt"), "alpha\n"); git(alpha, "add", "base.txt"); git(alpha, "commit", "-qm", "alpha");
  return { [alphaKey]: await realpath(alpha) };
};

/** a and b run in parallel: b's claim `b` is frozen into a's denylist; `.env` is a's own protected path. */
async function blockedRun(options: HarnessOptions) {
  const t = await driverHarness([{ taskId: "a", safetyPolicy: { denylistPaths: [".env"] } }, { taskId: "b" }], options);
  const runId = await t.claim();
  if (t.body(runId).taskId !== "a") throw new Error(`claimed ${t.body(runId).taskId}, not a`);
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  return { t, runId };
}
const denylistStop = (path: string): HarnessOptions => ({
  behaviour: (id) => id === "a" ? "blocked-waiting-human" : "succeed", stopReason: (id) => id === "a" ? `denylist match: ${path}` : null,
});

describe("the driver stores a parallel claim where it records the block", { timeout: 60_000 }, () => {
  it("ccloop's denylist stop on b's claim: stored, and still read after a's frozen entry no longer names b", async () => {
    const { t, runId } = await blockedRun(denylistStop("b"));
    let body: any;
    try {
      body = t.body(runId);
      expect(body.drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:blocked_waiting_human", stopReason: "denylist match: b" });
      // mutation: the terminal block site does not classify -> no parallelClaim, red
      expect(body.drive.parallelClaim).toEqual(CLAIM);
      expect(readRunDiagnosis(t.h.store, body)).toMatchObject({ cause: "parallel-claim", siblings: ["b"] });
    } finally { await t.h.dispose(); }
    // The same group and task with no frozen sibling -- what Task 6's `--after b` leaves of a's entry. The run's own record
    // still says why it stopped.
    // mutation: the view classifies against the task's current confirmed execution (first round) -> unknown, red
    const after = await driverHarness([{ taskId: "a" }]); try {
      expect(readRunDiagnosis(after.h.store, body)).toMatchObject({ cause: "parallel-claim", siblings: ["b"] });
    } finally { await after.h.dispose(); }
  });

  it("ccloop's denylist stop on a protected path only: nothing stored", async () => {
    const { t, runId } = await blockedRun(denylistStop(".env")); try {
      expect(t.body(runId).drive.stopReason).toBe("denylist match: .env");
      // mutation: a stop on no sibling's claim stores a claim anyway -> present, red
      expect(Object.hasOwn(t.body(runId).drive, "parallelClaim")).toBe(false);
      expect(readRunDiagnosis(t.h.store, t.body(runId)).cause).toBe("unknown");
    } finally { await t.h.dispose(); }
  });

  it("Orca's out-of-bounds block at collect on b's claim: stored", async () => {
    // The synthetic ccloop enforces no denylist, so a's write into `b` reaches Orca's own bound (Task 4b).
    const { t, runId } = await blockedRun({ files: (id): Record<string, string> => id === "a" ? { a: "a\n", b: "from a\n" } : { b: "b\n" } }); try {
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "out-of-bounds:b" });
      // mutation: the out-of-bounds block site does not classify -> no parallelClaim, red
      expect(t.body(runId).drive.parallelClaim).toEqual(CLAIM);
    } finally { await t.h.dispose(); }
  });

  // Fix round 2 (controller ruling, Orca session 4389b15f, 2026-11-18; reviewer's probe): the multi-directory block site is
  // reachable through the synthetic ccloop -- a frozen multiDir of `main` and an unwritten `alpha`, task a writing `main`
  // only -- and keys its paths by directory, the run's first directory being the receiver's primary.
  it("Orca's multi-directory out-of-bounds block on b's claim in the primary directory: stored", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }],
      { repositories: withAlpha, files: (id): Record<string, string> => id === "a" ? { a: "a\n", b: "from a\n" } : { b: "b\n" } });
    try {
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      group.multiDir = { project: "multi", landing: null, dirs: [{ kind: "repo", key: "main", repoId: "repo" }, { kind: "repo", key: "alpha", repoId: alphaKey }] };
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      for (const taskId of ["a", "b"]) {
        const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)) as Record<string, unknown>;
        work.writes = [{ dir: "main", targetPaths: [taskId], checks: [] }];
        t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(work), taskId);
      }
      const runId = await t.claim();
      expect(t.body(runId).taskId).toBe("a");
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "out-of-bounds:main:b" });
      // mutation: the multi site does not pass drive.dirs[0].key -> `main:b` read as one primary path, nothing stored, red
      expect(t.body(runId).drive.parallelClaim).toEqual(CLAIM);
    } finally { await t.h.dispose(); }
  });

  // Fix round 2 (controller ruling): an unreadable confirmed execution at the terminal block stores no claim, and the block
  // is still recorded as it always was. Here the work item's frozen agent stops matching the snapshot during collect, so the
  // read refuses `recovery-blocked`.
  it("ccloop's denylist stop with an unreadable confirmed execution: blocked as before, nothing stored", async () => {
    let t: Awaited<ReturnType<typeof driverHarness>> | undefined;
    const breakFrozenAgent = async () => {
      const work = JSON.parse(String(t!.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as { killGraceMs: number };
      work.killGraceMs += 1;
      t!.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
    };
    t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { ...denylistStop("b"), duringCollect: breakFrozenAgent,
      pathPolicyMisses: (id) => id === "a" ? [{ repoKey: null, path: "x" }] : undefined });
    try {
      const runId = await t.claim();
      expect(t.body(runId).taskId).toBe("a");
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      // mutation: the terminal read is not guarded -> the throw blocks the run `recovery-blocked`, losing the terminal, its
      // stopReason and misses, red
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:blocked_waiting_human", outcome: "blocked_waiting_human",
        stopReason: "denylist match: b", pathPolicyMisses: [{ repoKey: null, path: "x" }] });
      expect(Object.hasOwn(t.body(runId).drive, "parallelClaim")).toBe(false);
    } finally { await t.h.dispose(); }
  });
});
