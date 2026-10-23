import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { recordUsage } from "../../src/control/usage.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { Amount } from "../../src/control/types.js";
import { FIXTURE_AGENT_ID } from "./fixtures/agents.js";
import { webFixture, type WebFixtureOptions } from "./fixtures/web.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";
import { ESTIMATE_GRANT } from "../../src/control/estimator.js";

/**
 * Tester round 2 spec §4.2 (ruling H1): an estimate run over its grant is recorded on the run only -- it never changes
 * the group's status (C1), while a work run's breach still blocks (C2); the run view names the over dimensions (C3).
 * §4.2.5 (review C1, round 2 N2/N3): a limited group's token deficit is cured by a proposal-edit that raises the limit
 * (C1a); a non-token overrun grows the group's limit by the excess instead of becoming a deficit (C1b, C1c).
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const groupBody = (h: Fixture) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const runBody = (h: Fixture, runId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
let seqSource = 0;
const book = (h: Fixture, runId: string, eventSeq: number, cumulative: Amount) => recordUsage(h.store, {
  runId, generation: 1, eventSeq, bucket: "work", cumulative, source: { artifactId: `usage-${++seqSource}`, hash: "a".repeat(64) } });
async function claimed(options: WebFixtureOptions = {}) {
  const h = await webFixture(undefined, [{ taskId: "a" }], options);
  const service = new WebControlService(h.deps);
  const run = await service.claimEstimate("g", h.estimateId);
  if (run === null) throw new Error("estimate not claimed");
  return { h, service, runId: run.runId as string, grant: runBody(h, run.runId as string).grant.work as Amount };
}
/** Settle the estimate run as the driver would after a stop (state, then the settlement transaction). */
function settle(h: Fixture, service: WebControlService, runId: string): void {
  const row = runBody(h, runId); row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), runId);
  service.completeEstimate("g", h.estimateId, {});
}

describe("H1: an estimate breach never changes a group's status", () => {
  it("C1: leaves a draft group draft, with the breach recorded on the run", async () => {
    const { h, runId, grant } = await claimed(); try {
      expect(groupBody(h).status).toBe("draft");
      book(h, runId, 1, { ...grant, tokens: grant.tokens + 1 });
      expect(groupBody(h).status).toBe("draft");
      expect(runBody(h, runId).breaches).toEqual([1]);
    } finally { await h.dispose(); }
  });
  it("C1: leaves a ready group ready", async () => {
    const { h, service, runId, grant } = await claimed(); try {
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(groupBody(h).status).toBe("ready");
      book(h, runId, 1, { ...grant, tokens: grant.tokens + 5 });
      expect(groupBody(h).status).toBe("ready");
      expect(runBody(h, runId).breaches).toEqual([1]);
    } finally { await h.dispose(); }
  });
  it("C2: a work run over its grant still blocks the group", async () => {
    const { h, runId, grant } = await claimed(); try {
      // The breach rule reads only the run's phase; the same claimed run row, booked as a work run.
      const row = runBody(h, runId); row.phase = "work";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), runId);
      book(h, runId, 1, { ...grant, tokens: grant.tokens + 1 });
      expect(groupBody(h).status).toBe("blocked");
    } finally { await h.dispose(); }
  });
  it("C3: the run view names exactly the dimensions over the grant", async () => {
    const { h, runId, grant } = await claimed(); try {
      const overGrant = () => readControlGroup(h.store, "epoch", "g").runs.find(run => run.runId === runId)!.overGrant;
      book(h, runId, 1, { ...grant, tokens: grant.tokens - 1 });
      expect(overGrant()).toEqual([]);
      book(h, runId, 2, { ...grant, tokens: grant.tokens + 1 });
      expect(overGrant()).toEqual(["tokens"]);
      book(h, runId, 3, { ...grant, tokens: grant.tokens + 2, activeMs: grant.activeMs + 1 });
      expect(overGrant()).toEqual(["tokens", "activeMs"]);
    } finally { await h.dispose(); }
  });
});

describe("§4.2.5: no deficit-induced refusal from an estimate overrun", () => {
  it("C1a: limited -> overrun -> raise -> confirm", async () => {
    const { h, service, runId, grant } = await claimed(); try {
      book(h, runId, 1, { ...grant, tokens: grant.tokens + 40_000_000 });
      settle(h, service, runId);
      const ledger = () => readControlGroup(h.store, "epoch", "g").ledger;
      const deficit = ledger().budgetDeficit.tokens;
      expect(deficit).toBeGreaterThan(0);
      const version = () => readBudgetProposal(h.store, "g").proposalVersion;
      const limit = readBudgetProposal(h.store, "g").groupLimit;
      // A plain edit and a confirm stay refused while the deficit stands (today's check against the stored limit:
      // `residual` refuses the deficit first, as group-budget-unavailable).
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: version(), operations: [] }))).toMatchObject({ error: { code: "group-budget-unavailable" } });
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ error: { code: "group-budget-unavailable" } });
      // A raise still short of the deficit is refused; one that covers it is accepted and clears it.
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: version(), operations: [], proposedGroupLimit: { ...limit, tokens: limit.tokens! + deficit - 1 } })))
        .toMatchObject({ error: { code: "recovery-blocked" } });
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: version(), operations: [], proposedGroupLimit: { ...limit, tokens: limit.tokens! + deficit } })))
        .not.toHaveProperty("error");
      expect(ledger().budgetDeficit).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      expect(groupBody(h).ledger.budgetDeficit).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(groupBody(h).status).toBe("ready");
    } finally { await h.dispose(); }
  });

  it("C1b: an unlimited group's activeMs overrun grows the three limits by exactly the excess and leaves no deficit", async () => {
    const { h, service, runId, grant } = await claimed({ tokenPolicy: "optional-v1" }); try {
      const before = { group: groupBody(h).limit.activeMs, ledger: groupBody(h).ledger.groupLimit.activeMs, proposal: readBudgetProposal(h.store, "g").groupLimit.activeMs };
      expect(groupBody(h).limit.tokens).toBeNull();
      // Two growing events (3M, then 7M more), then one that moves only tokens: two entries, 10M in all, never twice.
      book(h, runId, 1, { ...grant, tokens: 10, activeMs: grant.activeMs + 3_000_000 });
      book(h, runId, 2, { ...grant, tokens: 20, activeMs: grant.activeMs + 10_000_000 });
      book(h, runId, 3, { ...grant, tokens: 30, activeMs: grant.activeMs + 10_000_000 });
      const body = groupBody(h), proposal = readBudgetProposal(h.store, "g");
      expect(body.estimateOverrunGrowth).toEqual([
        { runId, eventSeq: 1, dimension: "activeMs", amount: 3_000_000, at: expect.any(Number) },
        { runId, eventSeq: 2, dimension: "activeMs", amount: 7_000_000, at: expect.any(Number) },
      ]);
      expect(body.limit.activeMs).toBe(before.group + 10_000_000);
      expect(body.ledger.groupLimit.activeMs).toBe(before.ledger + 10_000_000);
      expect(proposal.groupLimit.activeMs).toBe(before.proposal + 10_000_000);
      expect(body.ledger.budgetDeficit).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      expect(body.status).toBe("draft");
      settle(h, service, runId);
      expect(readControlGroup(h.store, "epoch", "g").ledger.budgetDeficit).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion, scope: { kind: "group", slot: "worker" }, partial: { agent: FIXTURE_AGENT_ID } })))
        .not.toHaveProperty("error");
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
    } finally { await h.dispose(); }
  });

  it("C1b: a work run's overrun grows nothing", async () => {
    const { h, runId, grant } = await claimed({ tokenPolicy: "optional-v1" }); try {
      const limit = groupBody(h).limit, proposalLimit = readBudgetProposal(h.store, "g").groupLimit;
      const row = runBody(h, runId); row.phase = "work";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), runId);
      book(h, runId, 1, { ...grant, tokens: 10, activeMs: grant.activeMs + 3_000_000 });
      expect(groupBody(h).estimateOverrunGrowth).toBeUndefined();
      expect(groupBody(h).limit).toEqual(limit);
      expect(readBudgetProposal(h.store, "g").groupLimit).toEqual(proposalLimit);
    } finally { await h.dispose(); }
  });

  it("C1c (review M4): the driver's own collect books an estimate's activeMs overrun, which grows the three limits", async () => {
    // The real booking path: the execution driver collects the single call's events and books them (executionDriver.ts
    // recordUsage call). A run recovered after a restart re-enters this same collect, so it books the same way. The
    // estimate state `start-unknown` that §4.2.5 also names has no writer in src/ (grep: only readers), so there is no
    // separate start-unknown recovery to drive.
    const x = await estimateHarness({ usage: { activeMs: ESTIMATE_GRANT.activeMs + 3_000_000 } }); try {
      const before = { group: groupBody(x.h).limit.activeMs, proposal: readBudgetProposal(x.h.store, "g").groupLimit.activeMs };
      await x.rounds(() => x.estimate().state !== "running");
      expect(x.estimate().state).toBe("ready");
      const body = groupBody(x.h);
      expect(body.status).toBe("draft");
      expect(body.estimateOverrunGrowth).toEqual([{ runId: x.runId, eventSeq: 1, dimension: "activeMs", amount: 3_000_000, at: expect.any(Number) }]);
      expect(body.limit.activeMs).toBe(before.group + 3_000_000);
      expect(body.ledger.groupLimit).toEqual(body.limit);
      expect(readBudgetProposal(x.h.store, "g").groupLimit.activeMs).toBe(before.proposal + 3_000_000);
      expect(body.ledger.budgetDeficit).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
    } finally { await x.h.dispose(); }
  });

  it("C1c: settle-unknown-usage cannot book an estimate run (so it has no overrun to grow)", async () => {
    const { h, service, runId } = await claimed({ tokenPolicy: "optional-v1" }); try {
      const row = runBody(h, runId); row.state = "settled-unrecoverable"; row.unknown = { work: true, handoff: true };
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), runId);
      const { withCommandContext } = await import("../../src/control/commandClient.js");
      const command = h.command("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
      const answer = await withCommandContext(command.commandId, { client: "web", principal: "user:owner" }, () => service.settleUnknownUsage(command));
      expect(answer).toMatchObject({ error: { code: "run-usage-not-settleable" } });
      expect(groupBody(h).estimateOverrunGrowth).toBeUndefined();
    } finally { await h.dispose(); }
  });
});
