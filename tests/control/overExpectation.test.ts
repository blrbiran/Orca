// Tester follow-up G spec §2.2/§2.4 (plan Part B, O6, review focus 4): in an expectation-model group the first booking that
// takes a task's known work tokens past its expectation writes one `usage-over-expectation` row and marks the task (the
// Board card's amber hint); nothing stops and later bookings write no second row; usage that is not known writes nothing.
// The views carry the expectation (a person's amount has no estimate id) and the task's budget state; a legacy finite
// group's views gain no key.
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { readWork } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;

async function group(expectation: boolean): Promise<{ t: Harness; runId: string }> {
  const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: expectation ? "followup-g" as const : null, behaviour: () => "stoppable" });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 40 * M } }));
  if (expectation) {
    const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
    work.tokenIntent = { tokens: 2 * M, hard: false, provenance: "human", estimateId: null };
    t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
  }
  return { t, runId: await t.claim() };
}
let seq = 0;
const book = (t: Harness, runId: string, tokens: number | null) => recordUsage(t.h.store, { runId, generation: 1, eventSeq: ++seq, bucket: "work",
  cumulative: tokens === null ? null : { tokens, activeMs: 1, attempts: 1, sessions: 1 }, source: { artifactId: `usage-${seq}`, hash: "a".repeat(64) } });
const rows = (t: Harness) => readGroupActivity(t.h.store, "g", 50).filter(entry => entry.kind === "usage-over-expectation");

describe("over the expectation (spec §2.4)", { timeout: 120_000 }, () => {
  it("the first booking over the expectation writes one row, marks the task and the card turns amber", async () => {
    seq = 0;
    const { t, runId } = await group(true);
    try {
      book(t, runId, 1_500_000);
      expect(rows(t)).toEqual([]);
      expect(readControlGroup(t.h.store, "epoch", "g").workItems[0]!.expected).toEqual({ tokens: 2 * M, estimateId: null, stale: false, usedTokens: 1_500_000 });
      book(t, runId, 2_400_000);
      expect(rows(t).map(row => row.body)).toEqual([{ usedTokens: 2_400_000, expectationTokens: 2 * M, ratio: 1.2 }]);
      expect(readWork(t.h.store, "g", "a")).toMatchObject({ overExpectation: { usedTokens: 2_400_000, expectationTokens: 2 * M } });
      expect(readControlGroup(t.h.store, "epoch", "g").workItems[0]!.budgetState).toMatchObject({ overExpectation: { usedTokens: 2_400_000 }, hardCapTokens: null, usagePause: null });
      expect(JSON.stringify(readGroupSummary(t.h.store, "g"))).toContain("\"budgetAlerts\":{\"overExpectation\":1,\"waitingDecision\":0,\"groupCapReached\":0}");
      // The run goes on: nothing about it changed.
      expect(t.body(runId).state).not.toMatch(/settled|blocked/);
    } finally { await t.h.dispose(); }
  });

  it("a second booking over it writes no second row", async () => {
    seq = 0;
    const { t, runId } = await group(true);
    try {
      book(t, runId, 2_400_000);
      book(t, runId, 5_000_000);
      expect(rows(t)).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("an unknown usage writes no over-expectation row and no pause", async () => {
    seq = 0;
    const { t, runId } = await group(true);
    try {
      // An observation ccloop could not make: nothing is known to be over.
      book(t, runId, null);
      expect(rows(t)).toEqual([]);
      // A total that is only an approximate floor (soft-mode approximate usage) is not known either.
      const run = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      run.usageApproximate = { floorTokens: null, reason: "test", at: 1 };
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
      book(t, runId, 5_000_000);
      expect(rows(t)).toEqual([]);
      expect(readWork(t.h.store, "g", "a")).not.toHaveProperty("overExpectation");
      expect(readWork(t.h.store, "g", "a")).not.toHaveProperty("usagePause");
    } finally { await t.h.dispose(); }
  });

  it("a legacy finite group's views gain no key", async () => {
    seq = 0;
    const { t, runId } = await group(false);
    try {
      book(t, runId, 5_000_000);
      const view = readControlGroup(t.h.store, "epoch", "g");
      expect(view).not.toHaveProperty("expectationModel");
      expect(view.workItems[0]).not.toHaveProperty("budgetState");
      expect(view.workItems[0]).not.toHaveProperty("expected");
      expect(JSON.stringify(readGroupSummary(t.h.store, "g"))).not.toContain("budgetAlerts");
      expect(rows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});
