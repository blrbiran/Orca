import { describe, expect, it } from "vitest";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readWebGroup } from "../../src/control/webService.js";
import { queuedEstimateHarness } from "./fixtures/estimateHarness.js";

// Issue #147 (session 3cfc2e73): an estimate's answer is a suggestion applied to an editable proposal; once the proposal
// is confirmed no answer can apply, and the claim withdraws any such estimate. Asking for one anyway used to insert a
// dead estimate row, move a grant into committedRemaining and answer `estimate-created`. It is now refused by name
// before anything is booked: the person learns the estimate is pointless, and no row, wake or reservation appears.
describe("an estimate asked for on a confirmed proposal is refused before it is booked (#147)", () => {
  it("refuses with proposal-confirmed and leaves estimates, wakes and the group's reservation as they were", async () => {
    const x = await queuedEstimateHarness(); try {
      const confirm = { ...await x.h.confirmPayload(), budgetMode: "soft" as const };
      expect(await x.service.confirm(x.h.command("confirm", confirm))).toMatchObject({ result: { kind: "confirmed" } });
      const proposal = readBudgetProposal(x.h.store, "g");
      expect(proposal.state).toBe("confirmed");
      const count = (table: string) => Number(x.h.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE group_id='g'`).get()!.n);
      const before = { estimates: count("estimates"), wakes: count("scheduler_wakes"), reserved: readWebGroup(x.h.store, "g").reserved.tokens };
      const answer = await x.service.createEstimate(x.h.command("estimate", { proposalVersion: proposal.proposalVersion, estimatorProfileId: "all", estimatorProfileHash: x.h.frozen.profileHash, estimateMode: "soft" }));
      expect(answer).toMatchObject({ error: { code: "proposal-confirmed" } });
      expect({ estimates: count("estimates"), wakes: count("scheduler_wakes"), reserved: readWebGroup(x.h.store, "g").reserved.tokens }).toEqual(before);
    } finally { await x.h.dispose(); }
  });

  it("control: on the same harness before confirm, the same command books a second estimate", async () => {
    const x = await queuedEstimateHarness(); try {
      const proposal = readBudgetProposal(x.h.store, "g");
      const answer = await x.service.createEstimate(x.h.command("estimate", { proposalVersion: proposal.proposalVersion, estimatorProfileId: "all", estimatorProfileHash: x.h.frozen.profileHash, estimateMode: "soft" }));
      expect(answer).not.toMatchObject({ error: { code: "proposal-confirmed" } });
      expect(answer).toMatchObject({ result: { kind: "estimate-created" } });
    } finally { await x.h.dispose(); }
  });
});
