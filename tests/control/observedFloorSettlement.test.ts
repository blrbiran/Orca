// Tester follow-up F §2 (#116; human 「要改」, ledger C3, session 5abcad7d): a run with unknown usage in a group with a finite
// token limit could only be settled by charging the whole remaining grant (or, when proved, at known zero). Now a person, or
// a socket agent without a token, may say so explicitly: `charge-observed-floor` books ccloop's observed floor -- the same
// source and arithmetic Orca's soft path uses for groups with no limit -- marked approximate. It is never automatic in a
// finite group (the limit is the operator's statement), never for an unlimited remainder, and never without a floor.
import { describe, expect, it } from "vitest";
import { renderHelp } from "../../src/commands/help.js";
import { REGISTRY } from "../../src/commands/registry.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readBudgetProposal, readWork } from "../../src/control/queries.js";
import { hasValidUsageSettlement, lineageWorkUsage } from "../../src/control/usageSettlement.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { readControlGroup, requirementSummaryOf } from "../../src/panel/controlViews.js";
import { socketTier } from "../../src/panel/humanOnly.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";
import { groupBody, loopUnknown, settledActivity, stoppedUnknown, workLedger, type Harness } from "./fixtures/softLoop.js";

const OWNER: Principal = { kind: "user", userId: "owner", name: "owner", roles: ["owner"] };
const AGENT: Principal = { kind: "agent", client: "cli" };
const DISPATCHED: Principal = { kind: "agent", client: "cli", dispatchedRun: "run-dispatched" };
const MEMBER: Principal = { kind: "user", userId: "u-member", name: "bo", roles: ["member"] };
const BY = { by: "ana", via: "cli" };
const FLOOR = "charge-observed-floor";

const settleAs = async (t: Harness, runId: string, acknowledge: string, who: Principal | "web-owner" = "web-owner") => {
  const c = (t.h.command as (verb: string, payload: unknown) => { commandId: string })("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge });
  const context = who === "web-owner" ? { client: "web", principal: "user:owner" } : routedCommandContext(who.kind === "user" ? "web" : who.client, who, BY);
  try {
    const answer = await withCommandContext(c.commandId, context as never, () => (t.service as never as { settleUnknownUsage(c: unknown): Promise<any> }).settleUnknownUsage(c));
    return { answer, commandId: c.commandId };
  } catch (error) { return { answer: { thrown: String(error) }, commandId: c.commandId }; }
};
const runView = (t: Harness, runId: string) => readControlGroup(t.h.store, "epoch", "g").runs.find(r => r.runId === runId)!;
const business = (t: Harness) => ["runs", "work_items", "budget_proposals", "usage_ledger", "handoff_requests", "groups"]
  .map(table => t.h.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

describe("charge-observed-floor: who may send it (tester follow-up F §2)", () => {
  it("is open to a socket agent without a token on both verbs, refused to a run Orca dispatched and to a Web member", () => {
    // mutation: drop charge-observed-floor from AGENT_SETTLE_ACKNOWLEDGE -> control-person-token-required, red
    expect(permissionRefusal(AGENT, "settle-unknown-usage", { taskId: "a", runId: "run-1", generation: 1, acknowledge: FLOOR })).toBeNull();
    expect(socketTier("settle-unknown-usage", { acknowledge: FLOOR })).toBe("open");
    expect(permissionRefusal(DISPATCHED, "settle-unknown-usage", { taskId: "a", runId: "run-1", generation: 1, acknowledge: FLOOR })?.code).toBe("control-dispatched-run-refused");
    expect(permissionRefusal(MEMBER, "settle-unknown-usage", { taskId: "a", runId: "run-1", generation: 1, acknowledge: FLOOR })?.code).toBe("control-verb-human-only");
    const retry = { scope: "run", runId: "run-1", acknowledge: FLOOR };
    expect(permissionRefusal(AGENT, "recovery-retry", retry)).toBeNull();
    expect(permissionRefusal(DISPATCHED, "recovery-retry", retry)?.code).toBe("control-dispatched-run-refused");
  });

  it("the CLI accepts it on both verbs and its help names it", () => {
    // mutation: drop it from the settle-usage flag summary -> red
    expect(renderHelp(["task", "settle-usage"])).toContain("charge-observed-floor");
    expect(renderHelp(["recovery", "retry"])).toContain("charge-observed-floor");
    const def = REGISTRY.find((d) => d.domain === "task" && d.action === "settle-usage")!;
    expect(def.hint?.({ code: "control-person-token-required", message: "" })).toContain("charge-observed-floor");
  });
});

describe("charge-observed-floor on a finite group's loop run (tester follow-up F §2)", { timeout: 120_000 }, () => {
  it("books exactly the floor, approximate as the soft path marks it, offered on the view beside the grant form, and readers accept it", async () => {
    const { t, runId, driver } = await loopUnknown({ floor: 500 }); try {
      const before = t.body(runId), used = groupBody(t).used.tokens, reserved = groupBody(t).reserved.tokens, rows = workLedger(t, runId);
      expect(groupBody(t).limit.tokens).not.toBeNull();
      expect(before.remaining.work.tokens).not.toBeNull();
      // The view offers the form with the floor and its own admission answer; the grant form stays the remainder's.
      // mutation: drop the observedFloor preview in settlementPreview -> undefined, red
      expect(runView(t, runId).unknownUsageSettlement).toMatchObject({ acknowledge: "charge-remaining-grant", allowed: true, observedFloor: { tokens: 500, allowed: true, refusalReason: null } });
      const { answer, commandId } = await settleAs(t, runId, FLOOR);
      // mutation: settlementAdmission keeps refusing anything but settlementAcknowledgeFor -> finite-remainder, red
      expect(answer).toMatchObject({ result: { kind: "usage-settled", method: "observed-floor", charged: { work: { tokens: 500, activeMs: 0, attempts: 0, sessions: 0 } } } });
      const run = t.body(runId);
      // The charged amount is the floor, not the remainder: cumulative B + F, used + F, the rest of the grant left.
      // mutation: charge run.remaining (chargeRunRemainder) for the floor form -> red
      expect(run.cumulative.work.tokens).toBe(before.cumulative.work.tokens + 500);
      expect(groupBody(t).used.tokens).toBe(used + 500);
      expect(run.remaining.work.tokens).toBe(Math.max(before.grant.work.tokens - before.cumulative.work.tokens - 500, 0));
      // Committed: only the floor leaves the run's reservation (soft path §3.4); the rest stays for its retry.
      expect(groupBody(t).reserved.tokens).toBe(reserved - Math.min(500, before.remaining.work.tokens));
      expect(workLedger(t, runId)).toEqual([...rows, 500]);
      expect(run.unknown).toEqual({ work: false, handoff: false });
      // Marker: the soft path's shape (floorTokens, reason; usageApproximate matches) with its own method and the settler.
      expect(run.usageSettlement).toMatchObject({ method: "observed-floor", principal: "user:owner", commandId, floorTokens: 500, reason: "terminal:failed", reservationDisposition: "committed",
        charged: { work: { tokens: 500, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } } });
      expect(run.usageApproximate).toEqual({ floorTokens: 500, reason: "terminal:failed", at: run.usageSettlement.at });
      // mutation: the validator leaves observed-floor to the remaining-grant arithmetic -> false, red
      expect(hasValidUsageSettlement(t.h.store, run)).toBe(true);
      const forged = structuredClone(run); forged.usageApproximate.floorTokens = 499;
      expect(hasValidUsageSettlement(t.h.store, forged)).toBe(false);
      // Provider-observed usage stays in the lineage (as the approximate floor's).
      expect(lineageWorkUsage(run)).toEqual(run.cumulative.work);
      // Where the soft path shows "approximate": the run view's usageApproximate (the Runs table badge) and the ledger count.
      const view = readControlGroup(t.h.store, "epoch", "g");
      expect(view.runs.find(r => r.runId === runId)).toMatchObject({ usageApproximate: { floorTokens: 500 }, unknownUsageSettlement: { settlement: { method: "observed-floor" } } });
      expect(view.runs.find(r => r.runId === runId)!.unknownUsageSettlement!.observedFloor).toBeUndefined();
      expect(view.ledger).toMatchObject({ usageUnknown: false });
      expect(settledActivity(t, runId)).toEqual([{ method: "observed-floor", floorTokens: 500, reason: "terminal:failed", charged: run.usageSettlement.charged, principal: "user:owner", at: run.usageSettlement.at }]);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("no floor: refused observed-floor-unknown, nothing written, and the view offers no floor form", async () => {
    const { t, runId, driver } = await loopUnknown({}); try {
      expect(runView(t, runId).unknownUsageSettlement!.observedFloor).toBeUndefined();
      const before = business(t);
      // mutation: drop the floor check in settlementAdmission -> books 0 approximate, red
      expect((await settleAs(t, runId, FLOOR)).answer.error).toMatchObject({ code: "run-usage-not-settleable", message: "run-usage-not-settleable:observed-floor-unknown" });
      expect(business(t)).toEqual(before);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("an unlimited remainder keeps its forms: refused unlimited-remainder even with a floor", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      expect(t.body(runId).remaining.work.tokens).toBeNull();
      expect(runView(t, runId).unknownUsageSettlement!.observedFloor).toBeUndefined();
      const before = business(t);
      // mutation: drop the remainder check for the floor form -> settles, red
      expect((await settleAs(t, runId, FLOOR)).answer.error).toMatchObject({ code: "run-usage-not-settleable", message: "run-usage-not-settleable:unlimited-remainder" });
      expect(business(t)).toEqual(before);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("a socket agent without a token settles it, booked to the agent; a run Orca dispatched is refused", async () => {
    const { t, runId, driver } = await loopUnknown({ floor: 500 }); try {
      const before = t.body(runId);
      // mutation: drop the dispatched-run check in settlingPrincipalFor -> settles, red
      expect((await settleAs(t, runId, FLOOR, DISPATCHED)).answer).toMatchObject({ thrown: expect.stringContaining("control-verb-human-only") });
      expect(t.body(runId)).toEqual(before);
      const { answer, commandId } = await settleAs(t, runId, FLOOR, AGENT);
      expect(answer).not.toHaveProperty("thrown");
      expect(answer).not.toHaveProperty("error");
      expect(t.body(runId).usageSettlement).toMatchObject({ method: "observed-floor", principal: "agent:cli", commandId });
      expect(t.h.store.db.prepare("SELECT client,principal,person_principal FROM commands WHERE id=?").get(commandId)).toEqual({ client: "cli", principal: "agent:cli", person_principal: null });
      expect(hasValidUsageSettlement(t.h.store, t.body(runId))).toBe(true);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("finite-legacy stop: the reserve check counts the floor and the remainder after it (where the whole grant does not fit)", async () => {
    const { t, runId, driver } = await stoppedUnknown(undefined, 1_000_000, 700); try {
      const run = t.body(runId), g = groupBody(t);
      const after = Math.max(run.grant.work.tokens - run.cumulative.work.tokens - 700, 0);
      // Room for at least the floor plus the remainder after it, re-parked for the continuation (the floor is under the
      // remainder, so that is the parked commitment once; a limit may only be raised while usage is unknown). The whole
      // grant charged and parked again does not fit; the floor form does.
      const need: Record<string, number> = { tokens: 700 + after + run.remaining.handoff.tokens, activeMs: run.remaining.work.activeMs + run.remaining.handoff.activeMs,
        attempts: run.remaining.work.attempts + run.remaining.handoff.attempts, sessions: run.remaining.work.sessions + run.remaining.handoff.sessions };
      const limit = Object.fromEntries(Object.keys(need).map(d => [d, Math.max(g.limit[d], g.used[d] + g.reserved[d] + need[d]!)]));
      if (Object.keys(need).some(d => limit[d] !== g.limit[d])) expect(t.service.setLimit(t.h.command("set-limit", { limit: limit as never }))).not.toHaveProperty("error");
      // The existing refusal is kept for the grant form.
      expect((await settleAs(t, runId, "charge-remaining-grant")).answer.error.message).toMatch(/^group-reserve-insufficient:/);
      // mutation: the floor form keeps the 2 x remainder need -> refused group-reserve-insufficient, red
      const { answer } = await settleAs(t, runId, FLOOR);
      expect(answer).not.toHaveProperty("error");
      const settled = t.body(runId);
      expect(settled.usageSettlement).toMatchObject({ method: "observed-floor", reservationDisposition: "recovered", floorTokens: 700 });
      expect(settled.remaining.work.tokens).toBe(after);
      expect(readWork(t.h.store, "g", "a")).toMatchObject({ status: "held", grant: settled.remaining });
      expect(Object.fromEntries(readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task").map(a => [a.bucket, a.state]))).toEqual({ work: "held", handoff: "held" });
      expect(hasValidUsageSettlement(t.h.store, settled)).toBe(true);
    } finally { await driver.stop(); await t.h.dispose(); }
  });
});

describe("charge-observed-floor on a single call (tester follow-up F §2)", { timeout: 120_000 }, () => {
  const STALLED = { outcome: "failed" as const, output: null, tokens: null, errorCode: "omp-stalled", recordExtra: { usageLowerBound: { tokens: 1_234 } } };
  type X = Awaited<ReturnType<typeof requirementHarness>>;
  const retry = (x: X, runId: string, acknowledge: string, who: Principal) => {
    const command = x.command("recovery-retry", { scope: "run", runId, acknowledge }, { kind: "run", groupId: "r", runId }) as { commandId: string };
    const context = who.kind === "user" ? { client: "web", principal: `user:${who.userId}` } : routedCommandContext(who.client, who, BY);
    return withCommandContext(command.commandId, context as never, () => x.service.recoveryRetry(command as never)) as Promise<{ error?: { code: string; message?: string }; result?: unknown }>;
  };

  it("charges the call's floor, marks it approximate, and the retry goes on", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      expect(requirementSummaryOf(x.store, "r")).toMatchObject({ blockedRunCharge: { usageLowerBound: 1_234 } });
      // mutation: stopIntent retryRun keeps only charge-remaining-grant -> acknowledge-required, red
      expect(await retry(x, blocked.runId, FLOOR, OWNER)).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      const [settled] = x.runs();
      // mutation: the single-call settlement charges the grant for the floor form -> 1,000,000, red
      expect(settled).toMatchObject({ state: "settled-restartable", cumulative: { work: { tokens: 1_234 } }, unknown: { work: false, handoff: false },
        usageApproximate: { floorTokens: 1_234, reason: "requirement-usage-unknown:omp-stalled" },
        singleCallSettlement: { method: "observed-floor", principal: "user:owner", charged: { tokens: 1_234, activeMs: 0, attempts: 0, sessions: 0 }, usageLowerBound: { tokens: 1_234 }, disposition: "completed" } });
      // Only the floor is used; the rest of the call's grant is not held once the call completed.
      expect(x.group()).toMatchObject({ used: { tokens: 1_234 }, reserved: { tokens: 0 }, ledger: { usageUnknown: false } });
      await x.until(() => x.runs().length === 2 && x.runs()[1]!.state === "settled-restartable");
    } finally { await x.dispose(); }
  });

  it("refused observed-floor-unknown without ccloop's floor; booked to a socket agent without a token when there is one", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", outcome: "failed", output: null, tokens: null, errorCode: "omp-stalled" }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const before = x.runs()[0]!;
      // mutation: drop the floor check in the single-call settlement -> books 0, red
      expect((await retry(x, before.runId, FLOOR, OWNER)).error).toMatchObject({ code: "run-usage-not-settleable", message: "run-usage-not-settleable:observed-floor-unknown" });
      expect(x.runs()[0]).toEqual(before);
    } finally { await x.dispose(); }
    const y = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await y.until(() => y.runs()[0]?.state === "blocked");
      const runId = y.runs()[0]!.runId;
      expect((await retry(y, runId, FLOOR, DISPATCHED)).error).toMatchObject({ code: "run-usage-not-settleable" });
      expect(await retry(y, runId, FLOOR, AGENT)).toMatchObject({ result: { resolved: true } });
      expect(y.runs()[0]).toMatchObject({ singleCallSettlement: { method: "observed-floor", principal: "agent:cli" } });
    } finally { await y.dispose(); }
  });
});
