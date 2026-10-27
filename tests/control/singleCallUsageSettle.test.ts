import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { ControlError } from "../../src/control/errors.js";
import { readDraft, writeRound } from "../../src/control/requirementRecords.js";
import { SETTLEABLE_USAGE_UNKNOWN_REASONS, settleableSingleCallBlock } from "../../src/control/singleCall.js";
import { settleSingleCallUsageInTransaction } from "../../src/control/singleCallSettlement.js";
import { singleCallHandler } from "../../src/control/singleCallPurposes.js";
import { applyRecoveryRetry } from "../../src/control/stopIntent.js";
import { readControlOverview } from "../../src/panel/controlOverview.js";
import { humanOnlyRefusal, socketTier } from "../../src/panel/humanOnly.js";
import { readControlGroup, readGroupSummary, readOverviewGroupSource, requirementSummaryOf } from "../../src/panel/controlViews.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Spec 2026-10-27 single-call unknown usage (tester #62), §9 R1-R4: a single call blocked at C because its usage is unknown
// is settled by the person -- recovery-retry on the run, with the charge of its remaining grant acknowledged -- and its
// purpose's own retry rule then applies. Before this, the block was final: the requirement could never make another call.

const OWNER = { client: "web", principal: "user:owner" };
const GRANT = { tokens: 1_000_000, activeMs: 1_200_000, attempts: 1, sessions: 1 };
/** omp's stream watchdog as ccloop names it after spec C1 (`omp-stalled`), with the lower bound C2 puts in the record. */
const STALLED = { outcome: "failed" as const, output: null, tokens: null, errorCode: "omp-stalled", recordExtra: { usageLowerBound: { tokens: 1_234 } } };

type Harness = Awaited<ReturnType<typeof requirementHarness>>;
const retry = (x: Harness, runId: string, acknowledge?: "charge-remaining-grant") =>
  x.command("recovery-retry", { scope: "run", runId, ...(acknowledge === undefined ? {} : { acknowledge }) }, { kind: "run", groupId: "r", runId }) as { commandId: string };
const asOwner = <T>(command: { commandId: string }, fn: () => T): T => withCommandContext(command.commandId, OWNER, fn);
const refusal = async (promise: Promise<unknown>): Promise<{ code: string; message?: string }> => {
  try {
    const result = await promise as { error?: { code: string; message?: string } };
    if (result.error === undefined) return { code: "succeeded" };
    // The durable refusal's message is `<code>:<detail>`; the detail is what names the failed condition.
    const { code, message } = result.error;
    return { code, ...(message === undefined ? {} : { message: message.startsWith(`${code}:`) ? message.slice(code.length + 1) : message }) };
  }
  catch (error) { if (error instanceof ControlError) return { code: error.code, message: error.detail }; throw error; }
};
const usageLedgerTokens = (x: Harness, runId: string): number => Number(x.store.db.prepare("SELECT COALESCE(SUM(tokens),0) AS n FROM usage_ledger WHERE run_id=?").get(runId)!.n);

describe("settling a clarify call blocked on unknown usage (§9 R1-R4)", () => {
  it("charges the grant's remainder, clears the ledger flag, records a failed call, and the queued retry is claimed and answered", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      // O1/R4: the record's lower bound parsed and stayed on the blocked run; the summary offers the charge (R6).
      expect(blocked).toMatchObject({ drive: { blockedAt: "C", blockedReason: "requirement-usage-unknown:omp-stalled" }, singleCallUsageLowerBound: { tokens: 1_234 }, unknown: { work: true } });
      expect(requirementSummaryOf(x.store, "r")).toMatchObject({ blockedRun: { runId: blocked.runId }, blockedRunCharge: { tokens: GRANT.tokens, usageLowerBound: 1_234 } });
      expect(x.group().ledger.usageUnknown).toBe(true);
      const command = retry(x, blocked.runId, "charge-remaining-grant");
      expect(await asOwner(command, () => x.service.recoveryRetry(command as never))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      const [settled] = x.runs();
      expect(settled).toMatchObject({ state: "settled-restartable", active: 0, remaining: { work: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, cumulative: { work: GRANT }, unknown: { work: false, handoff: false },
        singleCallSettlement: { method: "remaining-grant", principal: "user:owner", charged: GRANT, usageLowerBound: { tokens: 1_234 }, blockedReason: "requirement-usage-unknown:omp-stalled", disposition: "completed" } });
      expect(settled.drive).toMatchObject({ blockedAt: null, blockedReason: null });
      // R3: the flag is recomputed in the same transaction; the charge is booked as settled usage (spend caps read it).
      // The charge moves the grant from `reserved` to `used` (code review S3: before the retry is claimed, nothing is held).
      expect(x.group()).toMatchObject({ used: { tokens: GRANT.tokens }, reserved: { tokens: 0 }, ledger: { usageUnknown: false } });
      expect(usageLedgerTokens(x, blocked.runId)).toBe(GRANT.tokens);
      expect(x.round(1)).toMatchObject({ state: "drafting", retries: 1, calls: [{ runId: blocked.runId, outcome: "failed", reason: "omp-stalled", usage: GRANT }] });
      expect(x.store.db.prepare("SELECT kind FROM activity WHERE run_id=? AND kind='usage-settled'").all(blocked.runId)).toHaveLength(1);
      // The next claim is not parked on requirement-usage-unknown: the retry is sent and answered.
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.round(1).waiting).toBeNull();
      expect(x.fake.calls.accept).toHaveLength(2);
      expect(x.group()).toMatchObject({ used: { tokens: GRANT.tokens + 777 }, ledger: { usageUnknown: false } });
    } finally { await x.dispose(); }
  });

  it("records a call that completed with unknown usage (a reason with no code) as failed `usage-unknown`", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE, tokens: null }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      expect(blocked.drive.blockedReason).toBe("requirement-usage-unknown");
      const command = retry(x, blocked.runId, "charge-remaining-grant");
      await asOwner(command, () => x.service.recoveryRetry(command as never));
      expect(x.round(1).calls).toEqual([expect.objectContaining({ outcome: "failed", reason: "usage-unknown" })]);
    } finally { await x.dispose(); }
  });

  it("the read model parses with the lower bound and the settlement marker on the run (summary and Overview, R4)", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }, { purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      // The Overview's own reader parses every run of the group with the strict run schema (it throws run-invalid otherwise);
      // the Overview catches that per group, so its output must not name it either.
      expect(readOverviewGroupSource(x.store, "r")?.summary).toMatchObject({ groupId: "r" });
      expect(JSON.stringify(readControlOverview(x.store, "epoch"))).not.toContain("run-invalid");
      const command = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      await asOwner(command, () => x.service.recoveryRetry(command as never));
      // The retry blocks the same way: one settled run with a marker, one blocked run with a lower bound.
      await x.until(() => x.runs()[1]?.state === "blocked");
      expect(x.runs().map((run) => [run.singleCallSettlement !== undefined, run.singleCallUsageLowerBound !== undefined])).toEqual([[true, true], [false, true]]);
      expect(readGroupSummary(x.store, "r")).toMatchObject({ groupId: "r" });
      expect(readOverviewGroupSource(x.store, "r")?.summary).toMatchObject({ groupId: "r" });
      expect(JSON.stringify(readControlOverview(x.store, "epoch"))).not.toContain("run-invalid");
      expect(requirementSummaryOf(x.store, "r")).toMatchObject({ blockedRun: { runId: x.runs()[1]!.runId }, blockedRunCharge: { tokens: GRANT.tokens, usageLowerBound: 1_234 } });
    } finally { await x.dispose(); }
  });
});

describe("settling a split call blocked on unknown usage (§9 R2: its evaluation is computed before the transaction)", () => {
  it("records the draft invalid with a failed call, drafts the next one, and the retry is answered", async () => {
    const x = await requirementHarness({ startAt: "split", answers: [{ purpose: "split", ...STALLED }, { purpose: "split", output: VALID_SPLIT }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      expect(blocked.drive.blockedReason).toBe("requirement-usage-unknown:omp-stalled");
      const command = retry(x, blocked.runId, "charge-remaining-grant");
      expect(await asOwner(command, () => x.service.recoveryRetry(command as never))).toMatchObject({ result: { resolved: true } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", calls: [{ runId: blocked.runId, outcome: "failed", reason: "omp-stalled" }] });
      // Code review S3: the grant moved from `reserved` to `used`; the retry is not claimed yet.
      expect(x.group()).toMatchObject({ used: { tokens: GRANT.tokens }, reserved: { tokens: 0 }, ledger: { usageUnknown: false } });
      await x.until(() => readDraft(x.store, "r", 2).state === "awaiting-review");
      expect(x.fake.calls.accept).toHaveLength(2);
    } finally { await x.dispose(); }
  });
});

describe("what the settlement refuses, by name (§9 R1; Rule 9: one criterion per guard)", () => {
  it("a run-scoped retry without the acknowledgement is refused and changes nothing (it would only block again)", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      const command = retry(x, blocked.runId);
      expect(await refusal(asOwner(command, () => x.service.recoveryRetry(command as never)))).toMatchObject({ code: "run-usage-not-settleable", message: "acknowledge-required" });
      expect(x.runs()[0]).toMatchObject({ state: "blocked", unknown: { work: true }, cumulative: blocked.cumulative });
      expect(x.group().used.tokens).toBe(0);
    } finally { await x.dispose(); }
  });

  it("the acknowledgement on a run that is not blocked on unknown usage is refused", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      x.deps.resolveRepository = () => { throw new ControlError("recovery-blocked", "repository-gone"); };
      await x.until(() => x.runs()[0]?.state === "blocked");
      const command = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      expect(await refusal(asOwner(command, () => x.service.recoveryRetry(command as never)))).toMatchObject({ code: "run-usage-not-settleable", message: "not-single-call-usage-unknown" });
      expect(x.runs()[0]).toMatchObject({ state: "blocked", drive: { blockedAt: "A2", blockedReason: "repository-path" } });
    } finally { await x.dispose(); }
  });

  // Ruling: human 「这一轮允许改必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- code review S1: this case pinned the dead end
  // (a call a stop closed with its usage unknown could not be settled, and the group's flag stayed set for good). It now
  // encodes that such a call is settled by the same acknowledged retry: its grant charged to `used` only (the stop already
  // gave the reservation back), the flag cleared, `complete` skipped (the round stays interrupted); the stop's own retry
  // then re-queues the round and the call is sent again. A second acknowledgement finds nothing left to settle.
  it("a call a stop closed with its usage unknown is settled by the acknowledged retry, and the stop's retry then proceeds", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      await x.until(() => x.round(1).state === "interrupted");
      const [closed] = x.runs();
      expect(closed).toMatchObject({ active: 0, unknown: { work: true }, drive: { blockedReason: "requirement-usage-unknown:omp-stalled" } });
      expect(closed.state).not.toBe("blocked");
      expect(x.group()).toMatchObject({ used: { tokens: 0 }, reserved: { tokens: 0 }, ledger: { usageUnknown: true } });
      expect(requirementSummaryOf(x.store, "r")).toMatchObject({ blockedRun: { runId: closed.runId }, blockedRunCharge: { tokens: GRANT.tokens, usageLowerBound: 1_234 } });
      const command = retry(x, closed.runId, "charge-remaining-grant");
      expect(await asOwner(command, () => x.service.recoveryRetry(command as never))).toMatchObject({ result: { resolved: true } });
      expect(x.runs()[0]).toMatchObject({ active: 0, unknown: { work: false }, cumulative: { work: GRANT }, singleCallSettlement: { disposition: "stopped", charged: GRANT } });
      expect(x.group()).toMatchObject({ used: { tokens: GRANT.tokens }, reserved: { tokens: 0 }, ledger: { usageUnknown: false } });
      expect(x.round(1)).toMatchObject({ state: "interrupted", calls: [{ runId: closed.runId, outcome: "interrupted" }] });
      expect(requirementSummaryOf(x.store, "r").blockedRun).toBeNull();
      const again = retry(x, closed.runId, "charge-remaining-grant");
      expect(await refusal(asOwner(again, () => x.service.recoveryRetry(again as never)))).toMatchObject({ code: "run-usage-not-settleable", message: "not-single-call-usage-unknown" });
      const group = x.command("recovery-retry", { scope: "group", groupId: "r" }) as { commandId: string };
      expect(await asOwner(group, () => x.service.recoveryRetry(group as never))).toMatchObject({ result: { resolved: true } });
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.fake.calls.accept).toHaveLength(2);
    } finally { await x.dispose(); }
  });

  it("a principal that is not an authenticated owner is refused", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const command = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      expect(await refusal(withCommandContext(command.commandId, { client: "cli", principal: "agent:cli" }, () => x.service.recoveryRetry(command as never)))).toMatchObject({ code: "run-usage-not-settleable", message: "owner-required" });
      // Code review m3: an owner's principal on another client than the Web is refused too (as settle-unknown-usage).
      const socket = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      expect(await refusal(withCommandContext(socket.commandId, { client: "cli", principal: "user:owner" }, () => x.service.recoveryRetry(socket as never)))).toMatchObject({ code: "run-usage-not-settleable", message: "owner-required" });
      expect(x.runs()[0]).toMatchObject({ state: "blocked", unknown: { work: true } });
    } finally { await x.dispose(); }
  });

  // Ruling: human 「这一轮允许改必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- code review S1: the old name said the stop settles the
  // call's usage, which it does not (it closes the call and leaves its usage unknown). It now encodes that a call still
  // blocked under a stop is left to the stop (stop-mode-conflict), and once the stop closed it -- here after the stop's own
  // retry re-queued the round, which then waits on the flag -- the settlement wakes the round and the call is sent again.
  it("a call still blocked under a stop is left to the stop (stop-mode-conflict); once closed, settling it wakes the waiting round", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      // No driver round yet: the call is still blocked while the stop is in place.
      expect(x.runs()[0]!.state).toBe("blocked");
      const command = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      expect(await refusal(asOwner(command, () => x.service.recoveryRetry(command as never)))).toMatchObject({ code: "stop-mode-conflict" });
      expect(x.group().used.tokens).toBe(0);
      await x.until(() => x.round(1).state === "interrupted");
      const group = x.command("recovery-retry", { scope: "group", groupId: "r" }) as { commandId: string };
      await asOwner(group, () => x.service.recoveryRetry(group as never));
      await x.until(() => x.round(1).waiting !== null);
      expect(x.round(1)).toMatchObject({ state: "drafting", waiting: "requirement-usage-unknown" });
      const settle = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      expect(await asOwner(settle, () => x.service.recoveryRetry(settle as never))).toMatchObject({ result: { resolved: true } });
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.fake.calls.accept).toHaveLength(2);
    } finally { await x.dispose(); }
  });

  it("a usage event above the run's high-water mark is refused run-usage-pending", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      x.store.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES (?,?,?,?)").run(blocked.runId, blocked.highWater + 1, "f".repeat(64), "{}");
      const command = retry(x, blocked.runId, "charge-remaining-grant");
      expect(await refusal(asOwner(command, () => x.service.recoveryRetry(command as never)))).toMatchObject({ code: "run-usage-pending" });
    } finally { await x.dispose(); }
  });

  it("a blocked call whose usage is known after all is refused run-usage-not-unknown", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      const body = JSON.parse(String(x.store.db.prepare("SELECT body FROM runs WHERE id=?").get(blocked.runId)!.body)) as Record<string, unknown>;
      x.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, unknown: { work: false, handoff: false } }), blocked.runId);
      const command = retry(x, blocked.runId, "charge-remaining-grant");
      expect(await refusal(asOwner(command, () => x.service.recoveryRetry(command as never)))).toMatchObject({ code: "run-usage-not-unknown" });
    } finally { await x.dispose(); }
  });

  it("a split settlement without the evaluation the purpose needs is refused by name (never a TypeError)", async () => {
    const x = await requirementHarness({ startAt: "split", answers: [{ purpose: "split", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const command = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      const outcome = await refusal(Promise.resolve().then(() => asOwner(command, () => applyRecoveryRetry({ store: x.store } as never, command as never, null, { settle: settleSingleCallUsageInTransaction }))));
      expect(outcome).toMatchObject({ code: "run-usage-not-settleable", message: "evaluation-missing" });
    } finally { await x.dispose(); }
  });
});

describe("recovery-retry with no settlement given (a caller other than the Web service)", () => {
  it("refuses a usage-unknown block by name rather than resuming it into the same block", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const command = retry(x, x.runs()[0]!.runId, "charge-remaining-grant");
      const outcome = await refusal(Promise.resolve().then(() => asOwner(command, () => applyRecoveryRetry({ store: x.store } as never, command as never))));
      expect(outcome).toMatchObject({ code: "run-usage-not-settleable", message: "settlement-unavailable" });
      expect(x.runs()[0]).toMatchObject({ state: "blocked", unknown: { work: true } });
    } finally { await x.dispose(); }
  });
});

describe("a call whose round moved on is settled through the interrupt path (§9 R2, review S4)", () => {
  it("charges the grant, closes the run, and leaves the round as it is", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      writeRound(x.store, "r", { ...x.round(1), state: "failed", reasonCode: "clarify-output-invalid" });
      const before = x.round(1);
      const command = retry(x, blocked.runId, "charge-remaining-grant");
      expect(await asOwner(command, () => x.service.recoveryRetry(command as never))).toMatchObject({ result: { resolved: true } });
      expect(x.runs()[0]).toMatchObject({ state: "settled-restartable", active: 0, unknown: { work: false }, singleCallSettlement: { disposition: "interrupted", charged: GRANT } });
      expect(x.round(1)).toEqual(before);
      expect(x.group()).toMatchObject({ used: { tokens: GRANT.tokens }, reserved: { tokens: 0 }, ledger: { usageUnknown: false } });
    } finally { await x.dispose(); }
  });
});

describe("which runs are settleable (§9 R1: flow calls are out of scope)", () => {
  const blocked = (fields: Record<string, unknown>) => ({ phase: "single-call", state: "blocked", drive: { blockedAt: "C", blockedReason: "requirement-usage-unknown:omp-stalled" }, ...fields });
  it("names the same reason as each purpose's driver step writes", () => {
    for (const [purpose, reason] of Object.entries(SETTLEABLE_USAGE_UNKNOWN_REASONS)) expect(singleCallHandler(purpose as never).usageUnknownReason, purpose).toBe(reason);
    expect(Object.keys(SETTLEABLE_USAGE_UNKNOWN_REASONS).sort()).toEqual(["clarify", "estimate", "split"]);
  });
  it("a requirement clarify call is; a flow clarify call and a flow purpose's call are not", () => {
    expect(settleableSingleCallBlock(blocked({ purpose: "clarify" }))).toMatchObject({ failure: "omp-stalled" });
    expect(settleableSingleCallBlock(blocked({ purpose: "clarify", flowCall: { executionId: "e" } }))).toBeNull();
    expect(settleableSingleCallBlock(blocked({ purpose: "flow-draft", drive: { blockedAt: "C", blockedReason: "flow-call-usage-unknown:omp-stalled" } }))).toBeNull();
  });
});

type EstimateHarness = Awaited<ReturnType<typeof estimateHarness>>;
const estimateCommand = (x: EstimateHarness, commandId: string) => ({ schema: "orca-raw-command-v1", commandId, actorId: "human",
  expectedRevision: Number(x.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision), verb: "recovery-retry",
  target: { kind: "run", groupId: "g", runId: x.runId }, payload: { scope: "run", runId: x.runId, acknowledge: "charge-remaining-grant" } });

describe("settling an estimate call blocked on unknown usage (§9 R1)", () => {
  it("charges the grant's remainder, clears the plan group's flag, and fails the estimate with ccloop's code", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null, recordExtra: { usageLowerBound: { tokens: 4_321 } } });
    try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown:single-call-output-invalid" });
      // Code review m1: the run view carries ccloop's lower bound, for the estimate's charge to show it.
      expect(readControlGroup(x.h.store, "epoch", "g").runs.find((run) => run.runId === x.runId)).toMatchObject({ usageLowerBound: 4_321 });
      const remaining = x.body().remaining.work;
      const { used: { tokens: usedBefore }, committedRemaining: { tokens: committedBefore } } = readControlGroup(x.h.store, "epoch", "g").ledger;
      const command = estimateCommand(x, "c-settle-estimate");
      expect(await withCommandContext(command.commandId, OWNER, () => x.service.recoveryRetry(command as never))).toMatchObject({ result: { resolved: true } });
      expect(x.body()).toMatchObject({ state: "settled-restartable", unknown: { work: false }, singleCallSettlement: { charged: remaining, disposition: "completed" } });
      expect(x.active()).toBe(0);
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-call-failed:single-call-output-invalid" });
      const ledger = readControlGroup(x.h.store, "epoch", "g").ledger;
      expect(ledger).toMatchObject({ usageUnknown: false, used: { tokens: usedBefore + remaining.tokens } });
      // Code review S3: the charge leaves the reservation; only an automatic retry's own grant may be held after it.
      const retriedAs = x.estimate().retriedAs;
      const retryGrant = retriedAs == null ? 0 : Number(JSON.parse(String(x.h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(retriedAs)!.body)).grant.tokens);
      expect(ledger.committedRemaining.tokens).toBe(committedBefore - remaining.tokens + retryGrant);
    } finally { await x.h.dispose(); }
  });

  // Code review m6: an estimate that moved on while its run was blocked is not completed again; its run is closed.
  it("closes the run of an estimate that moved on, charging the grant and leaving the estimate as it is", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null });
    try {
      await x.rounds(() => x.body().state === "blocked");
      const row = x.h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(x.h.estimateId)!;
      x.h.store.db.prepare("UPDATE estimates SET state='failed',body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), state: "failed", reasonCode: "estimate-output-invalid" }), x.h.estimateId);
      const before = x.estimate();
      const command = estimateCommand(x, "c-settle-moved");
      expect(await withCommandContext(command.commandId, OWNER, () => x.service.recoveryRetry(command as never))).toMatchObject({ result: { resolved: true } });
      expect(x.body()).toMatchObject({ state: "settled-restartable", unknown: { work: false }, singleCallSettlement: { disposition: "interrupted" } });
      expect(x.active()).toBe(0);
      expect(x.estimate()).toEqual(before);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.usageUnknown).toBe(false);
    } finally { await x.h.dispose(); }
  });

  // Code review S1, the estimate's twin: a stop closes a blocked estimate (interruptEstimate, releaseCommitment) with its
  // usage unknown; the acknowledged retry then charges its grant to `used` without releasing the reservation again.
  it("settles an estimate a stop closed with its usage unknown, without releasing its reservation twice", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null });
    try {
      await x.rounds(() => x.body().state === "blocked");
      const remaining = x.body().remaining.work;
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(JSON.stringify(stopped));
      await x.rounds(() => x.active() === 0);
      expect(x.estimate().state).toBe("interrupted");
      const closed = readControlGroup(x.h.store, "epoch", "g").ledger;
      expect(closed.usageUnknown).toBe(true);
      const command = estimateCommand(x, "c-settle-stopped");
      expect(await withCommandContext(command.commandId, OWNER, () => x.service.recoveryRetry(command as never))).toMatchObject({ result: { resolved: true } });
      expect(x.body()).toMatchObject({ unknown: { work: false }, singleCallSettlement: { disposition: "stopped", charged: remaining } });
      expect(x.estimate().state).toBe("interrupted");
      const ledger = readControlGroup(x.h.store, "epoch", "g").ledger;
      expect(ledger).toMatchObject({ usageUnknown: false, used: { tokens: closed.used.tokens + remaining.tokens }, committedRemaining: closed.committedRemaining });
    } finally { await x.h.dispose(); }
  });
});

describe("ccloop's record with the lower bound (§5 O1)", () => {
  it("still refuses a record carrying a key ccloop never writes", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED, recordExtra: { usageLowerBound: { tokens: 1_234 }, surprise: true } }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      expect(x.runs()[0]).toMatchObject({ drive: { blockedAt: "C", blockedReason: "single-call-record-invalid" } });
    } finally { await x.dispose(); }
  });
});

describe("who may acknowledge the charge (§9 R1: as settle-unknown-usage, an owner's act)", () => {
  it("the route refuses the acknowledgement to anyone but an owner, and wants a person token on the socket; a plain retry stays open", () => {
    expect(humanOnlyRefusal("recovery-retry", { scope: "run", runId: "run-1", acknowledge: "charge-remaining-grant" })?.code).toBe("control-field-human-only");
    expect(socketTier("recovery-retry", { scope: "run", runId: "run-1", acknowledge: "charge-remaining-grant" })).toBe("token");
    expect(humanOnlyRefusal("recovery-retry", { scope: "run", runId: "run-1" })).toBeNull();
    expect(socketTier("recovery-retry", { scope: "run", runId: "run-1" })).toBeNull();
  });
});
