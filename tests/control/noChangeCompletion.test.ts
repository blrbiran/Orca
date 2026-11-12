import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readArtifact, writeArtifact } from "../../src/control/archive.js";
import { acceptanceEvidence } from "../../src/control/checkpoints.js";
import { listPendingDecisions } from "../../src/control/pendingDecisions.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Tester #127 and #138 (design Correction 2): an ordinary task may complete with no net tracked change only when its
// contract explicitly says its command checks decide the goal. The tree equality is checked against Git; every other
// empty result keeps D14's block. The declaration's type gate itself is pinned by decisiveChecksContract.test.ts.
const workOf = (t: Awaited<ReturnType<typeof driverHarness>>, runId: string) =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status;

describe("a checked no-change task completes only by its authored declaration", () => {
  it("accepts a proved clean tree, runs the declared checks, and names the no-change landing", async () => {
    const t = await driverHarness([{ taskId: "a", commandChecksDecideGoal: true }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      const row = t.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`acceptance:${runId}`);
      expect(row, "a declared clean result earns acceptance").toBeDefined();
      const acceptance = JSON.parse(String((row as { body: string }).body));
      // mutation: accept every empty result without the check evidence -> checksPassed is false here, red
      const bytes = JSON.parse((await readArtifact(t.h.store, acceptance.source)).toString());
      expect(bytes).toMatchObject({ runId, checksPassed: true, landing: "no-change", commit: drive.attemptSha });
      // mutation: drop the tree-equality guard -> this run's tree differs and the criterion must go red next test
      expect(gitTree(t, drive.attemptSha)).toBe(gitTree(t, drive.base));
      expect(workOf(t, runId)).toBe("done");
    } finally { await t.h.dispose(); }
  }, 30000);

  // Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — §10.1: a command-verified empty run asks the goal
  // judge; D14's block remains only for criteria-review verdicts and partial multi runs. Without the declaration the
  // same empty result is still not done and has no acceptance -- it waits for the judge instead of `empty-result`.
  it("asks the goal judge without the declaration, and the task is not done until it answers", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`acceptance:${runId}`)).toBeUndefined();
      expect(workOf(t, runId)).toBe("blocked");
      expect(t.body(runId).drive.blockedReason).toBeNull();
      expect(t.body(runId).drive.noChangeJudge).toMatchObject({ state: "pending" });
      const judges = t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND json_extract(body,'$.purpose')='no-change-judge'").all();
      expect(judges.map((row) => String(row.id))).toEqual([t.body(runId).drive.noChangeJudge.runId]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("does not count an acceptance whose proof names another attempt", async () => {
    const t = await driverHarness([{ taskId: "a", commandChecksDecideGoal: true }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(await acceptanceEvidence(t.h.store, runId)).toBe(true);
      // A forged proof — the right run, the right landing, a different attempt — must not count.
      const drive = t.body(runId).drive;
      const forged = await writeArtifact(t.h.store, `forged-acceptance-${runId}`, Buffer.from(JSON.stringify({ runId, checksPassed: true, landing: "no-change", commit: "1".repeat(40), noChange: { ...drive.noChange, attempt: "1".repeat(40) } })));
      t.h.store.db.prepare("UPDATE outbox SET body=? WHERE id=?").run(JSON.stringify({ runId, accepted: true, source: forged }), `acceptance:${runId}`);
      expect(await acceptanceEvidence(t.h.store, runId)).toBe(false);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("lands a no-change decision with the run's own proof, and refuses it to a person on any other run", async () => {
    const entry = {
      question: "should the attempt extend the suite?", chose: "No change was needed.",
      alternatives: [{ option: "extend it", why_not: "the checks already cover the goal" }], because: "the declared checks pass unchanged",
      undo: { how: "No change made; nothing to revert", cost: "none", blast_radius: "none", kind: "no-change" },
      scope: "task", kind: "criteria",
    };
    const landed = await driverHarness([{ taskId: "a", commandChecksDecideGoal: true }], { files: () => ({}), decisions: () => [entry] }); try {
      const runId = await landed.claim();
      await landed.until(landed.driver(), () => landed.body(runId).drive?.cleanedUp === true);
      // mutation: write the entry without the run's proof -> the kind is refused and this goes pending, red
      const rows = ledgerLines(landed, runId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.undo).toMatchObject({ kind: "no-change", proof: landed.body(runId).drive.noChange });
      expect(rows[0]!.undo.how).toBe("No change made; nothing to revert");
      expect(listPendingDecisions(landed.h.store, "g")).toEqual([]);
    } finally { await landed.h.dispose(); }
    // The same entry on a run whose tree changed: the agent's claim is not the controller's proof.
    // Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — spec §1.1/§10.1 measure the proof for every
    // succeeded empty run, declared or not, so "no declaration" no longer means "no proof"; a run that changed a file
    // still has none, and its no-change claim is still refused.
    const blocked = await driverHarness([{ taskId: "a" }], { files: () => ({ a: "a\n" }), decisions: () => [entry] }); try {
      const runId = await blocked.claim();
      await blocked.until(blocked.driver(), () => blocked.body(runId).drive?.cleanedUp === true);
      expect(ledgerLines(blocked, runId)).toEqual([]);
      expect(listPendingDecisions(blocked.h.store, "g").map((p) => p.entry.reason)).toEqual(["tier-0: undo.kind no-change needs the run's own measured Git proof"]);
    } finally { await blocked.h.dispose(); }
  }, 30000);
});

/** The lines this run's own ledger file holds, parsed; empty when no ledger was written. */
function ledgerLines(t: Awaited<ReturnType<typeof driverHarness>>, runId: string): Array<{ undo: Record<string, unknown> }> {
  const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
  try {
    return git(t.repo, "show", `${tip}:.decisions/${runId}.jsonl`).split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  } catch { return []; }
}

function gitTree(t: Awaited<ReturnType<typeof driverHarness>>, rev: string): string {
  return git(t.repo, "rev-parse", `${rev}^{tree}`);
}
