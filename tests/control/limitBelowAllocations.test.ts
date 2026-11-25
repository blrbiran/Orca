// Tester #479 (controller decision, session 5d3d0c09; reopens ruling #212 only for this): `group confirm` accepted a group
// limit below its goal-review and handoff allocations, which the limit pays first, and each lane then got a sliver
// (3M limit, 1M goal-review, 8 x 300k handoffs: ≈ 608k a lane). The even per-claim split is unchanged; the arithmetic is
// shown (limitCheck, beside the funding preview) and a person's confirm of a limit below the allocations is refused
// `limit-below-allocations` unless the shortfall is accepted. Equal is not below; no finite limit, no check.
import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { budgetHeadroomLines } from "../../src/commands/domains/reads.js";
import { authoredAllocationTokens, fundingPreview, limitCheck } from "../../src/control/fundedAllowance.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

type Fixture = Awaited<ReturnType<typeof webFixture>>;

/** A person's proposal edit: the group's token limit, the goal-review allocation's and every handoff allocation's tokens. */
async function shape(h: Fixture, limitTokens: number | null, goalReviewTokens: number, handoffTokens: number): Promise<void> {
  const { WebControlService } = await import("../../src/control/webService.js");
  const proposal = readBudgetProposal(h.store, "g");
  const operations = [{ target: { scope: "goal-review" as const, dimension: "tokens" as const }, value: goalReviewTokens, provenance: "human" as const },
    ...TASKS.map(({ taskId }) => ({ target: { scope: "task" as const, taskId, allocation: "handoff" as const, dimension: "tokens" as const }, value: handoffTokens, provenance: "human" as const }))];
  const answer = new WebControlService(h.deps).editProposal(h.command("proposal-edit", { baseProposalVersion: proposal.proposalVersion, operations, proposedGroupLimit: { ...proposal.groupLimit, tokens: limitTokens } }));
  if ("error" in (answer as object)) throw new Error(JSON.stringify(answer));
}

const TASKS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"].map((taskId) => ({ taskId, tokenBudget: null }));
const fixture = () => webFixture(profileSnapshot(), TASKS, { tokenPolicy: "optional-v1", modelVersion: "followup-g" });

describe("a group limit below its authored allocations (#479)", () => {
  it("the arithmetic names the allocations, the limit and the lane share; equal is no warning", async () => {
    const h = await fixture();
    try {
      await shape(h, 3_000_000, 1_000_000, 300_000);
      expect(authoredAllocationTokens(readBudgetProposal(h.store, "g"))).toEqual({ goalReviewTokens: 1_000_000, handoffTokens: 2_400_000, allocationTokens: 3_400_000 });
      const check = limitCheck(h.store, "g", fundingPreview(h.store, "g", Date.now()))!;
      // mutation: compare with >= (or drop the check) -> no warning at 3.4M > 3M, or one at equality below, red
      expect(check.warnings.map((w) => w.code)).toContain("limit-below-allocations");
      const message = check.warnings.find((w) => w.code === "limit-below-allocations")!.message;
      expect(message).toContain("allocations 3,400,000 > limit 3,000,000");
      expect(message).toContain("the limit 3,000,000 pays goal-review (1,000,000) and handoffs (2,400,000) first; the lane share = remainder / concurrent candidates");
      await shape(h, 3_400_000, 1_000_000, 300_000);
      expect(limitCheck(h.store, "g", fundingPreview(h.store, "g", Date.now()))!.warnings.map((w) => w.code)).not.toContain("limit-below-allocations");
      await shape(h, null, 1_000_000, 300_000);
      expect(limitCheck(h.store, "g", fundingPreview(h.store, "g", Date.now()))).toBeNull();
    } finally { await h.dispose(); }
  });

  it("names a task expectation above the lane share a claim gets now", async () => {
    const h = await fixture();
    try {
      await shape(h, 20_000_000, 1_000_000, 300_000);
      const rows = fundingPreview(h.store, "g", Date.now());
      const lane = Math.max(...rows.filter((r) => r.reason === null && r.fundableTokens !== null).map((r) => r.fundableTokens!));
      const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='t3'").get()!.body));
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='t3'").run(JSON.stringify({ ...work, tokenIntent: { tokens: lane + 1, hard: false, provenance: "human", estimateId: null } }));
      const check = limitCheck(h.store, "g", fundingPreview(h.store, "g", Date.now()))!;
      // mutation: drop the lane-below-expected warning -> [], red
      expect(check.warnings.map((w) => w.code)).toEqual(["lane-below-expected"]);
      expect(check.warnings[0]!.message).toContain(`task t3 expects ${(lane + 1).toLocaleString("en-US")} tokens > the ${lane.toLocaleString("en-US")} a claim gets now`);
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='t3'").run(JSON.stringify({ ...work, tokenIntent: { tokens: lane, hard: false, provenance: "human", estimateId: null } }));
      expect(limitCheck(h.store, "g", fundingPreview(h.store, "g", Date.now()))!.warnings).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("a person's confirm is refused limit-below-allocations unless the shortfall is accepted; equal confirms", async () => {
    const { WebControlService } = await import("../../src/control/webService.js");
    const below = await fixture();
    try {
      await shape(below, 3_000_000, 1_000_000, 300_000);
      const service = new WebControlService(below.deps);
      // mutation: drop the refusal in confirm -> it confirms, red
      expect(await service.confirm(below.command("confirm", await below.confirmPayload()))).toMatchObject({ error: { code: "limit-below-allocations", message: "limit-below-allocations:3400000>3000000" } });
      expect(readBudgetProposal(below.store, "g").state).toBe("editable");
      expect(await service.confirm(below.command("confirm", { ...await below.confirmPayload(), acceptShortfall: true }))).toMatchObject({ result: expect.anything() });
      expect(readBudgetProposal(below.store, "g").state).toBe("confirmed");
    } finally { await below.dispose(); }
    const equal = await fixture();
    try {
      await shape(equal, 3_400_000, 1_000_000, 300_000);
      const service = new WebControlService(equal.deps);
      expect(await service.confirm(equal.command("confirm", await equal.confirmPayload()))).toMatchObject({ result: expect.anything() });
    } finally { await equal.dispose(); }
  });
});

// Tester #479 follow-up: with the group's headroom at 0, ready tasks were left unclaimed and the brief said so only as a
// JSON number (a "parallel" pair ran one at a time). The brief names `budget-headroom-zero:<n>` (and the CLI says it in
// words); the funding preview names `budget-slice-zero` on a candidate the headroom leaves nothing for.
describe("no headroom left for the ready tasks (#479)", () => {
  it("the preview names budget-slice-zero on the candidates the limit leaves nothing for", async () => {
    const { WebControlService } = await import("../../src/control/webService.js");
    const h = await fixture();
    try {
      await shape(h, 3_000_000, 1_000_000, 300_000);
      expect(await new WebControlService(h.deps).confirm(h.command("confirm", { ...await h.confirmPayload(), acceptShortfall: true }))).toMatchObject({ result: expect.anything() });
      // 3M pays the 1M goal-review and the handoffs first; the joint claim funds six lanes and leaves t7, t8 nothing.
      // mutation: drop the warning in fundingPreview -> no row names it, red
      expect(fundingPreview(h.store, "g", Date.now()).filter((row) => row.warning === "budget-slice-zero").map((row) => [row.taskId, row.reason]))
        .toEqual([["t7", "group-budget-unavailable"], ["t8", "group-budget-unavailable"]]);
    } finally { await h.dispose(); }
  });

  it("the brief warns budget-headroom-zero:<n> while running lanes hold the whole headroom and a ready task waits", async () => {
    const { driverHarness } = await import("./fixtures/driverHarness.js");
    const { readWebGroup } = await import("../../src/control/webService.js");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }, { taskId: "c", dependsOn: ["a"] }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", behaviour: () => "stoppable" });
    const server = createServer((() => { const app = express(); app.use(express.json());
      registerControlReadRoutes(app, { store: t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web"); return app; })());
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 10_000_000 } }));
      await t.claim(); await t.claim();
      // The two running lanes split the headroom; c, released from its dependency here, finds none left.
      t.h.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.dependsOn',json('[]')) WHERE group_id='g' AND id='c'").run();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const brief = await (await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/brief`)).json() as Record<string, unknown>;
      expect((brief.card as { budget: { headroomTokens: number } }).budget).toMatchObject({ headroomTokens: 0, waitingForBudget: 1 });
      // mutation: drop the budget-headroom-zero warning from the brief route -> absent, red
      expect(brief.warnings).toEqual(["budget-headroom-zero:1"]);
      expect(budgetHeadroomLines(brief)).toEqual([expect.stringMatching(/^warning: budget-headroom-zero:1: 1 ready task waits for budget -- the group's headroom is 0 \(limit 10000000, used \d+, reserved \d+ by running lanes and allocations\); claimed when a running lane ends, or raise the limit: orca group set-limit g --limit <higher> --as-person$/)]);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await t.h.dispose(); }
  });

  it("a group with headroom left has no such warning", async () => {
    expect(budgetHeadroomLines({ warnings: ["delivery-blocked:local:x"] })).toEqual([]);
    const h = await fixture();
    try {
      await shape(h, 20_000_000, 1_000_000, 300_000);
      expect(fundingPreview(h.store, "g", Date.now()).some((row) => row.warning !== undefined)).toBe(false);
    } finally { await h.dispose(); }
  });
});
