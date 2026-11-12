import { describe, expect, it } from "vitest";
import { readArtifact, writeArtifact } from "../../src/control/archive.js";
import { allDirsUnchanged, noChangeRouteOf, recordNoChangeCompletionInTransaction } from "../../src/control/noChange.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester follow-up G spec §1.1-§1.2 with §10.1 (human: 「希望 Orca 自动判完成（事后在活动里留一条可撤销的记录）」): a run
 * ccloop reports succeeded whose attempt tree equals its base completes its task as "no change" without any declaration
 * when ccloop's agent verifier approved the goal; the declared command path still completes; each completion leaves one
 * activity row naming who decided and the agent's own explanation.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const workOf = (t: Harness, taskId = "a") => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const rowsOf = (t: Harness, kind: string) => t.h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind=? ORDER BY seq").all(kind).map((r) => JSON.parse(String(r.body)));
const proofOf = async (t: Harness, runId: string) => {
  const row = t.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`acceptance:${runId}`);
  if (row === undefined) return null;
  return JSON.parse((await readArtifact(t.h.store, JSON.parse(String(row.body)).source)).toString());
};

/** The agent's task result: an explanation saying why nothing needed changing (what the run view reads). */
async function seedExplanation(t: Harness, runId: string, conclusion: string) {
  const ref = await writeArtifact(t.h.store, `explanation-${runId}`, Buffer.from(JSON.stringify({ schema: "task-result-v1", goal: "ship", completedWork: [], conclusions: [conclusion], outputs: [], limitations: [] })));
  const state = { schema: "orca-task-result-store-v1", identity: { runId }, revision: 1, sourceRevision: 1, currentAttempt: 1, status: "available", reason: null,
    observations: [{ manifestRef: ref, manifest: { attempt: 1, revision: 1, explanation: { status: "available", reason: null, ref } }, verification: null }] };
  t.h.store.db.prepare("INSERT INTO outbox VALUES (?, 'task-results', ?, 1)").run(`task-results:${runId}`, JSON.stringify(state));
}

describe("an empty run that ccloop's checks accepted completes as no change (tester follow-up G §1, §10.1)", () => {
  it("an agent-verified empty run completes as no change without a declaration, with one activity row naming the agent's explanation", async () => {
    let seeded = false;
    const t: Harness = await driverHarness([{ taskId: "a", verifierType: "agent" }], { files: () => ({}), duringCollect: async () => {
      if (seeded) return; seeded = true;
      const runId = String(t.h.store.db.prepare("SELECT id FROM runs WHERE work_item_id='a' ORDER BY rowid DESC").get()!.id);
      await seedExplanation(t, runId, "base.txt already ships the goal");
    } });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      // mutation M3a: restore the commandChecksDecideGoal gate on the proof -> no acceptance, work blocked, red
      expect(await proofOf(t, runId)).toMatchObject({ runId, checksPassed: true, landing: "no-change", decidedBy: "agent-verifier" });
      expect(workOf(t).status).toBe("done");
      expect(workOf(t).noChangeCompletion).toMatchObject({ runId, ordinal: 1, decidedBy: "agent-verifier" });
      expect(t.body(runId).drive.blockedReason).toBeNull();
      expect(rowsOf(t, "no-change-completed")).toEqual([{ runId, decidedBy: "agent-verifier", ordinal: 1, explanation: "base.txt already ships the goal" }]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("the declared command path still completes and says command-checks", async () => {
    const t = await driverHarness([{ taskId: "a", commandChecksDecideGoal: true }], { files: () => ({}) });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      // mutation M3b: map both routes to agent-verifier -> red
      expect(await proofOf(t, runId)).toMatchObject({ landing: "no-change", decidedBy: "command-checks" });
      expect(rowsOf(t, "no-change-completed")).toEqual([{ runId, decidedBy: "command-checks", ordinal: 1, explanation: null }]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("a criteria-review judge group keeps its empty attempt as its verdict", () => {
    const agent = { verification: { verifierType: "agent" } }, command = { verification: { verifierType: "command" } };
    const mark = (kind: string) => ({ systemDebug: { source: { kind, groupId: "g0", taskId: "a", runId: "run-1" }, stackOn: null, inputHash: "a".repeat(64), settled: null } });
    const review = mark("criteria-review"), ladder = mark("ladder");
    // mutation M3c: drop the criteria-review branch -> "complete", red
    expect(noChangeRouteOf(agent, review)).toBe("none");
    expect(noChangeRouteOf(agent, ladder)).toBe("complete");
    expect(noChangeRouteOf(command, ladder)).toBe("judge");
    expect(noChangeRouteOf({ verification: { verifierType: "command", commandChecksDecideGoal: true } }, {})).toBe("complete");
  });

  it("a multi run completes as no change only when every directory is unchanged", () => {
    // mutation M3d: `some` for `every` -> true for the second, red
    expect(allDirsUnchanged([{ baseTree: "t1", attemptTree: "t1" }, { baseTree: "t2", attemptTree: "t2" }])).toBe(true);
    expect(allDirsUnchanged([{ baseTree: "t1", attemptTree: "t1" }, { baseTree: "t2", attemptTree: "t3" }])).toBe(false);
    expect(allDirsUnchanged([])).toBe(false);
  });

  it("a second no-change completion of the same task says 2nd time", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const record = (runId: string) => t.h.store.transaction(() => recordNoChangeCompletionInTransaction(t.h.store, { groupId: "g", taskId: "a", runId, decidedBy: "judge", explanation: null }));
      // mutation M3e: ordinal constant 1 -> red on the second
      expect(record("run-1").ordinal).toBe(1);
      expect(record("run-2").ordinal).toBe(2);
      expect(rowsOf(t, "no-change-completed").map((row) => row.ordinal)).toEqual([1, 2]);
    } finally { await t.h.dispose(); }
  });
});
