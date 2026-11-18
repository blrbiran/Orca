// Tester #328 residual: a task's agent recorded a decision whose undo could not be executed ("undo.how not executable"); the
// landing refused it to tier 0, where only a person can approve or reject it. Nothing told the person to look -- the group
// card only counted it -- and the group reached done while the only sign that main did not change was that unanswered
// decision. Ruling (brief 2026-11-18-tester-small Part 3): a group with at least one PENDING tier-0 decision needs the person,
// and Overview shows a problem row naming how many and where they are answered (the task's decisions; `orca decision
// approve|reject`). Only pending tier-0 decisions count: answered ones, and pending entries refused for another reason, do not.
// Holding done or dependents is a later ruling, not tested here.
import { afterAll, describe, expect, it } from "vitest";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { command, createHarness, get, json, revision, GROUP } from "./fixtures/controlPanel.js";
import { insertPendingDecisions, settlePendingDecision } from "../../src/control/pendingDecisions.js";
import type { PendingEntry } from "../../src/control/runLedger.js";
import type { GroupSummaryV1 } from "../../web/src/controlTypes.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, confirm, overview } = createOverviewFixtures(h);

const pending = (runId: string, entryIndex: number, reason: string): PendingEntry => ({
  pendingId: `${runId}:${entryIndex}`, ledgerRun: runId, entryIndex, entry: { kind: "approach", question: `q${entryIndex}` }, reason,
  at: "2026-11-18T00:00:00.000Z", evidence: [`run ${runId}`],
});

describe("a pending tier-0 decision needs the person (#328 residual)", () => {
  it("raises a task-attention row naming the count and the task, and needs-you on Overview and the summary, until answered", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "start-328", expectedRevision: await revision(panel), payload: {} });
    await panel.drainWakes();
    const runId = String(panel.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(GROUP)!.id);
    const tier0Rows = async () => (await overview(panel)).steps.filter(s => s.groupId === GROUP && String(s.reason).startsWith("decision-tier0-pending"));
    const needsYou = async () => {
      const fromOverview = (await overview(panel)).groups.find(g => g.groupId === GROUP)?.needsYou;
      const summary = await json(await get(panel, "/api/control/summary")) as { groups: GroupSummaryV1[] };
      return { overview: fromOverview, summary: summary.groups.find(g => g.groupId === GROUP)?.needsYou };
    };
    expect(await tier0Rows()).toEqual([]);
    expect(await needsYou()).toEqual({ overview: false, summary: false });

    // A pending entry refused for another reason (not tier 0) is not this row.
    // mutation (count every pending decision, not only tier-0 ones) -> red here.
    panel.store.transaction(() => insertPendingDecisions(panel.store, GROUP, runId, [pending(runId, 0, "kind-unknown:\"x\"")]));
    expect(await tier0Rows()).toEqual([]);
    expect(await needsYou()).toEqual({ overview: false, summary: false });

    // mutation (no row for a pending tier-0 decision) -> red here.
    panel.store.transaction(() => insertPendingDecisions(panel.store, GROUP, runId, [
      pending(runId, 1, "tier-0: undo.how not executable"), pending(runId, 2, "tier-0: undo.kind no-change needs the run's own measured Git proof"),
    ]));
    expect(await tier0Rows()).toEqual([expect.objectContaining({
      kind: "task-attention", reason: "decision-tier0-pending:2", taskId: "a", runId: null,
      destination: { kind: "group", groupId: GROUP, region: "problem", taskId: "a", runId: null },
    })]);
    // mutation (the row is not a problem kind, e.g. acceptance-warning) -> red here.
    expect(await needsYou()).toEqual({ overview: true, summary: true });

    // Answered ones do not count: one approved leaves one; the other rejected leaves none.
    // mutation (count answered tier-0 decisions too) -> red here.
    panel.store.transaction(() => settlePendingDecision(panel.store, `${runId}:1`, { state: "approved", approvedId: "d-1" }));
    expect((await tier0Rows()).map(s => s.reason)).toEqual(["decision-tier0-pending:1"]);
    panel.store.transaction(() => settlePendingDecision(panel.store, `${runId}:2`, { state: "rejected", correctionId: "c-2" }));
    expect(await tier0Rows()).toEqual([]);
    expect(await needsYou()).toEqual({ overview: false, summary: false });
  });
});
