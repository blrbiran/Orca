import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { ESTIMATE_GRANT } from "../../src/control/estimator.js";
import { readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { queuedEstimateHarness } from "./fixtures/estimateHarness.js";

// Estimate usable-answer spec, "Correction (session 3d229487, 2026-10-20)": a queued estimate whose answer could no
// longer be used -- the group started, the proposal was confirmed, or a newer estimate superseded it -- used to be
// claimed and run (a paid call the panel cannot apply), or, once the group had started, to throw inside the claim so
// its wake was re-delivered every pump pass, the estimate stayed `queued` forever and its grant stayed reserved. The
// claim now decides by code to withdraw it: terminal state `withdrawn`, grant released, no run, no retry, wake done.
type X = Awaited<ReturnType<typeof queuedEstimateHarness>>;
const rows = (x: X) => x.h.store.db.prepare("SELECT id,estimate_version,state FROM estimates WHERE group_id='g' ORDER BY estimate_version").all()
  .map(row => ({ id: String(row.id), version: Number(row.estimate_version), state: String(row.state) }));
const wakeOf = (x: X, estimateId: string) => Number(x.h.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id=?").get(`scheduler-wake:g:estimate:${estimateId}`)!.delivered);
const runsFor = (x: X, estimateId: string) => Number(x.h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND work_item_id=?").get(estimateId)!.n);
/** The work items the synthetic ccloop was asked to accept: each is one paid call. */
const launched = (x: X) => x.fake.calls.accept.map(envelope => envelope.claim.workItemId);
const setGroup = (x: X, patch: Record<string, unknown>) => {
  const group = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  x.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...group, ...patch }));
};
/** Raises the group limit and its unallocated reserve by two grants, so the person's second estimate can queue. */
function widenBudget(x: X): void {
  const proposal = readBudgetProposal(x.h.store, "g");
  const group = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  const reserveRow = proposal.allocations.find(a => a.ownerKind === "reserve")!;
  for (const d of ["tokens", "activeMs", "attempts", "sessions"] as const) {
    const more = 2 * ESTIMATE_GRANT[d];
    proposal.groupLimit[d]! += more; proposal.explicitUnallocatedReserve[d]! += more; reserveRow.amount[d]! += more;
    group.limit[d] += more; group.ledger.groupLimit[d] += more; group.ledger.explicitUnallocatedReserve[d] += more;
  }
  x.h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(canonicalBytes(proposal).toString("utf8"));
  x.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
}

/**
 * The withdrawn shape every reason shares, measured against the numbers taken before the claim: the reason is named,
 * no run row exists, the wake is done, no retry row was written, and the grant left `committedRemaining` (the proposal's
 * reserve grew by it). Pumping and driving again changes nothing and launches nothing.
 */
async function expectWithdrawn(x: X, estimateId: string, reason: string, before: { reserved: number; reserve: number }): Promise<void> {
  const estimate = readEstimateRecord(x.h.store, "g", estimateId);
  expect(estimate).toMatchObject({ state: "withdrawn", reasonCode: `estimate-withdrawn:${reason}`, output: null });
  expect(estimate.retriedAs).toBeUndefined(); expect(estimate.retrySkipped).toBeUndefined();
  expect(runsFor(x, estimateId)).toBe(0);
  expect(wakeOf(x, estimateId)).toBe(1);
  expect(rows(x).filter(row => row.id !== estimateId).every(row => row.version > estimate.estimateVersion)).toBe(true);
  const group = readWebGroup(x.h.store, "g");
  expect(group.reserved.tokens).toBe(before.reserved - ESTIMATE_GRANT.tokens);
  expect(group.ledger.committedRemaining.tokens).toBe(before.reserved - ESTIMATE_GRANT.tokens);
  expect(readBudgetProposal(x.h.store, "g").explicitUnallocatedReserve.tokens).toBe(before.reserve + ESTIMATE_GRANT.tokens);
  const snapshot = JSON.stringify(rows(x));
  await x.pump(); await x.rounds(3);
  expect(launched(x)).not.toContain(estimateId);
  expect(JSON.stringify(rows(x))).toBe(snapshot);
}
/** A soft confirm: a strict one parks every estimate run at A1 (strict-proof-unimplemented), which would hide a paid call. */
const softConfirm = async (x: X) => ({ ...await x.h.confirmPayload(), budgetMode: "soft" as const });
const numbers = (x: X) => ({ reserved: readWebGroup(x.h.store, "g").reserved.tokens, reserve: readBudgetProposal(x.h.store, "g").explicitUnallocatedReserve.tokens! });

describe("a queued estimate whose answer can no longer be used is withdrawn at claim time (spec correction 2026-10-20)", () => {
  it("control: an untouched queued estimate is claimed through its wake and the paid call is launched", async () => {
    const x = await queuedEstimateHarness(); try {
      await x.pump();
      expect(readEstimateRecord(x.h.store, "g", x.h.estimateId).state).toBe("running");
      await x.rounds();
      expect(launched(x)).toEqual([x.h.estimateId]);
      expect(readEstimateRecord(x.h.store, "g", x.h.estimateId).state).toBe("ready");
    } finally { await x.h.dispose(); }
  });

  it("proposal-confirmed: the proposal was confirmed while the estimate waited -- no paid call, grant released", async () => {
    const x = await queuedEstimateHarness(); try {
      expect(await x.service.confirm(x.h.command("confirm", await softConfirm(x)))).toMatchObject({ result: { kind: "confirmed" } });
      const before = numbers(x);
      await x.pump(); await x.rounds();
      expect(launched(x)).toEqual([]);
      await expectWithdrawn(x, x.h.estimateId, "proposal-confirmed", before);
    } finally { await x.h.dispose(); }
  });

  it("superseded: the person queued a newer estimate -- the older is not paid for, the newer one runs", async () => {
    const x = await queuedEstimateHarness(); try {
      widenBudget(x);
      const created = await x.service.createEstimate(x.h.command("estimate", { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: x.h.frozen.profileHash, estimateMode: "soft" }));
      expect(created).toMatchObject({ result: { kind: "estimate-created", estimateVersion: 2, estimateState: "queued" } });
      const newer = (created as { result: { estimateId: string } }).result.estimateId;
      const before = numbers(x);
      // Claim the older wake alone first, so the grant arithmetic is read before the newer estimate takes its claim.
      expect(await x.service.claimEstimate("g", x.h.estimateId)).toBeNull();
      const estimate = readEstimateRecord(x.h.store, "g", x.h.estimateId);
      expect(estimate).toMatchObject({ state: "withdrawn", reasonCode: "estimate-withdrawn:superseded" });
      expect(readWebGroup(x.h.store, "g").reserved.tokens).toBe(before.reserved - ESTIMATE_GRANT.tokens);
      expect(readBudgetProposal(x.h.store, "g").explicitUnallocatedReserve.tokens).toBe(before.reserve + ESTIMATE_GRANT.tokens);
      await x.pump(); await x.rounds();
      expect(launched(x)).toEqual([newer]);
      expect(wakeOf(x, x.h.estimateId)).toBe(1);
      expect(runsFor(x, x.h.estimateId)).toBe(0);
      expect(rows(x).map(row => [row.version, row.state])).toEqual([[1, "withdrawn"], [2, "ready"]]);
    } finally { await x.h.dispose(); }
  });

  it("group-started: a start is pending (the stored status stays ready) -- withdrawn for the start, not the confirm", async () => {
    const x = await queuedEstimateHarness(); try {
      expect(await x.service.confirm(x.h.command("confirm", await softConfirm(x)))).toMatchObject({ result: { kind: "confirmed" } });
      expect(await x.service.start(x.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      expect(readWebGroup(x.h.store, "g").status).toBe("ready");
      const before = numbers(x);
      await x.pump(); await x.rounds();
      expect(launched(x)).toEqual([]);
      await expectWithdrawn(x, x.h.estimateId, "group-started", before);
    } finally { await x.h.dispose(); }
  });

  it("group-started: a group past pre-start used to throw in the claim and re-deliver the wake forever; the wake now stops", async () => {
    const x = await queuedEstimateHarness(); try {
      expect(await x.service.confirm(x.h.command("confirm", await softConfirm(x)))).toMatchObject({ result: { kind: "confirmed" } });
      setGroup(x, { status: "running" });
      const before = numbers(x);
      const first = await x.pump();
      expect(first.delivered).toEqual([`scheduler-wake:g:estimate:${x.h.estimateId}`]);
      await x.rounds();
      expect(launched(x)).toEqual([]);
      await expectWithdrawn(x, x.h.estimateId, "group-started", before);
      expect((await x.pump()).deferred).toEqual([]);
    } finally { await x.h.dispose(); }
  });

  it("the group view shows the withdrawn estimate and its reason (the panel and the agent path read it)", async () => {
    const x = await queuedEstimateHarness(); try {
      await x.service.confirm(x.h.command("confirm", await softConfirm(x)));
      await x.pump();
      const view = readControlGroup(x.h.store, "epoch", "g");
      expect(view.estimates.find(e => e.estimateId === x.h.estimateId)).toMatchObject({ state: "withdrawn", reasonCode: "estimate-withdrawn:proposal-confirmed" });
    } finally { await x.h.dispose(); }
  });

  it("a withdrawn record must name one of the three reasons (the reader refuses anything else)", async () => {
    const x = await queuedEstimateHarness(); try {
      await x.service.confirm(x.h.command("confirm", await softConfirm(x)));
      await x.pump();
      const body = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(x.h.estimateId)!.body));
      x.h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?").run(canonicalBytes({ ...body, reasonCode: "estimate-withdrawn:other" }).toString("utf8"), x.h.estimateId);
      expect(() => readEstimateRecord(x.h.store, "g", x.h.estimateId)).toThrow();
    } finally { await x.h.dispose(); }
  });
});
