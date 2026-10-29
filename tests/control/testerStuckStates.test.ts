import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { recoverControl } from "../../src/control/recovery.js";
import { pendingRequirementCall } from "../../src/control/requirementCalls.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { requirementSummaryOf } from "../../src/panel/controlViews.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { hasValidUsageSettlement } from "../../src/control/usageSettlement.js";
import { unknownFailure } from "./fixtures/unknownFailure.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester feedback round 2026-10-28, P0 #98-#104: the states the tester's database showed, rebuilt through the real code
// paths (never by writing rows), so each criterion says which part was a defect and which was the tester's hand edit.

const OWNER = { client: "web", principal: "user:owner" };
const STALLED = { outcome: "failed" as const, output: null, tokens: null, errorCode: "omp-stalled", recordExtra: { usageLowerBound: { tokens: 1_234 } } };
type Harness = Awaited<ReturnType<typeof requirementHarness>>;
const asOwner = <T>(command: { commandId: string }, fn: () => T): T => withCommandContext(command.commandId, OWNER, fn);

/**
 * #98 / #100: a split call stalls with its usage unknown, a handoff stop closes it (its draft interrupted, the flag still
 * set), and the group's Retry lifts the stop and drafts the next draft -- which parks on `requirement-usage-unknown`, the
 * tester's "draft 3 drafting + waiting" with no run.
 */
async function parkedDraft(x: Harness): Promise<string> {
  await x.until(() => x.runs()[0]?.state === "blocked");
  expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
  await x.until(() => readDraft(x.store, "r", 1).state === "interrupted");
  const retry = x.command("recovery-retry", { scope: "group", groupId: "r" }) as { commandId: string };
  expect(await asOwner(retry, () => x.service.recoveryRetry(retry as never))).toMatchObject({ result: { resolved: true } });
  await x.until(() => readDraft(x.store, "r", 2).waiting !== null);
  return x.runs()[0]!.runId;
}

describe("#98: Retry on a stopped requirement whose call's usage is unknown", () => {
  it("lifts the stop and drafts again; the draft waits on the unknown usage and the summary offers its charge, which sends it", async () => {
    const x = await requirementHarness({ startAt: "split", answers: [{ purpose: "split", ...STALLED }, { purpose: "split", output: VALID_SPLIT }] });
    try {
      const closedRunId = await parkedDraft(x);
      expect(readDraft(x.store, "r", 2)).toMatchObject({ state: "drafting", waiting: "requirement-usage-unknown" });
      expect(x.group()).toMatchObject({ stopped: false, ledger: { usageUnknown: true } });
      expect(x.store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id='r'").get()).toBeUndefined();
      // The exit the panel shows: the closed call and the amount its settlement charges.
      expect(requirementSummaryOf(x.store, "r")).toMatchObject({ blockedRun: { runId: closedRunId }, blockedRunCharge: { tokens: 1_000_000, usageLowerBound: 1_234 } });
      const settle = x.command("recovery-retry", { scope: "run", runId: closedRunId, acknowledge: "charge-remaining-grant" }, { kind: "run", groupId: "r", runId: closedRunId }) as { commandId: string };
      expect(await asOwner(settle, () => x.service.recoveryRetry(settle as never))).toMatchObject({ result: { resolved: true } });
      // Whatever undelivered outbox rows the stop left, they do not hold the draft: it is sent and answered.
      await x.until(() => readDraft(x.store, "r", 2).state === "awaiting-review");
      expect(x.fake.calls.accept).toHaveLength(2);
    } finally { await x.dispose(); }
  });
});

describe("#100: archiving a requirement whose next call is parked", () => {
  it("archives it, interrupting the parked draft so no call is sent afterwards", async () => {
    const x = await requirementHarness({ startAt: "split", answers: [{ purpose: "split", ...STALLED }, { purpose: "split", output: VALID_SPLIT }] });
    try {
      await parkedDraft(x);
      const archive = x.command("archive-group", {}) as { commandId: string };
      expect(await asOwner(archive, () => x.service.archiveGroup(archive as never))).toMatchObject({ result: { kind: "archived", groupId: "r" } });
      expect(readDraft(x.store, "r", 2)).toMatchObject({ state: "interrupted", waiting: null });
      // The usage stays unknown: archiving books nothing and pretends nothing was spent.
      expect(x.group().ledger.usageUnknown).toBe(true);
      // Review findings 2-3: measured directly -- the archived group has no pending call left (spec §6.3).
      expect(pendingRequirementCall(x.store, "r")).toBeNull();
    } finally { await x.dispose(); }
  });
});

describe("#100: archiving a requirement whose next call a stop holds", () => {
  it("archives it, interrupting the held round; a round that would be sent still refuses (archiveGroup.test.ts)", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: null, outcome: "failed" as const, tokens: 1, errorCode: "unused" }] });
    try {
      // Round 1 is queued and not yet claimed (no driver round has run); the stop holds its wake.
      expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      expect(x.round(1)).toMatchObject({ state: "drafting", waiting: null });
      const archive = x.command("archive-group", {}) as { commandId: string };
      expect(await asOwner(archive, () => x.service.archiveGroup(archive as never))).toMatchObject({ result: { kind: "archived", groupId: "r" } });
      expect(x.round(1)).toMatchObject({ state: "interrupted", waiting: null });
      expect(pendingRequirementCall(x.store, "r")).toBeNull();
    } finally { await x.dispose(); }
  });
});

describe("#102: a requirement call blocked on unknown usage across a restart", () => {
  it("does not keep dispatch blocked after recovery, and the summary still offers the charge", async () => {
    const x = await requirementHarness({ startAt: "split", answers: [{ purpose: "split", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const [blocked] = x.runs();
      expect(blocked.active).toBe(1);
      // What openControlStore sets when any run is active (store.ts); the panel then runs recovery with its driver.
      x.store.dispatchBlocked = true;
      await recoverControl(x.store, x.fake.port, undefined, { driverOwnsWebRuns: true });
      expect(x.store.dispatchBlocked).toBe(false);
      expect(requirementSummaryOf(x.store, "r")).toMatchObject({ blockedRun: { runId: blocked.runId }, blockedRunCharge: { tokens: 1_000_000 } });
    } finally { await x.dispose(); }
  });
});

// #103: the recovery CLI's settlement goes over the control socket. A single call's charge-and-retry was an owner's act on
// the Web only; an owner's person token now carries it, booked to that owner's account. A run Orca dispatched never has
// person authority (permissions.ts hasPersonAuthority). A task run's settle-unknown-usage too since session 2026-10-29
// (spec 2026-10-29-socket-usage-settlement-design.md; below).
const TOKEN = { client: "cli", principal: "agent:cli", personAuthority: true, personPrincipal: "user:u-owner" };
const DISPATCHED = { client: "cli", principal: "agent:cli", personAuthority: false, personPrincipal: "user:u-owner" };

describe("#103: settling over the socket with an owner's person token", () => {
  it("a single call's charge-and-retry is booked to the token's owner; without person authority it is refused", async () => {
    const x = await requirementHarness({ startAt: "split", answers: [{ purpose: "split", ...STALLED }, { purpose: "split", output: VALID_SPLIT }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const runId = x.runs()[0]!.runId;
      const send = (context: typeof TOKEN) => {
        const command = x.command("recovery-retry", { scope: "run", runId, acknowledge: "charge-remaining-grant" }, { kind: "run", groupId: "r", runId }) as { commandId: string };
        return withCommandContext(command.commandId, context, () => x.service.recoveryRetry(command as never)) as Promise<{ error?: { code: string; message?: string } }>;
      };
      expect((await send(DISPATCHED)).error).toMatchObject({ code: "run-usage-not-settleable", message: "run-usage-not-settleable:owner-required" });
      expect(x.runs()[0]).toMatchObject({ state: "blocked", unknown: { work: true } });
      expect(await send(TOKEN)).toMatchObject({ result: { resolved: true } });
      expect(x.runs()[0]).toMatchObject({ singleCallSettlement: { principal: "user:u-owner" } });
    } finally { await x.dispose(); }
  });

  // Review finding 1 (session a9f9d6de) kept this the Web owner's: the marker is checked against its ledger row, and a
  // socket row named only `agent:cli`, so every reader would have refused the marker. Ruling: human 「这次批准改写所有必要的判据」
  // (session 2026-10-29, the schema change 「同意」): the row now records the token's account, so the settlement is booked
  // to it and the readers accept it; without person authority it is still refused before any write.
  it("a task run's settle-unknown-usage over the socket: a person token settles it, booked to that owner and valid to readers; no person authority is refused", async () => {
    const { t, runId } = await unknownFailure();
    try {
      const before = t.body(runId);
      const send = (id: string, context: typeof TOKEN) => {
        const command = { ...(t.h.command as (verb: string, payload: unknown) => Record<string, unknown>)("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" }), commandId: id };
        return withCommandContext(id, context, () => (t.service as never as { settleUnknownUsage(c: unknown): Promise<unknown> }).settleUnknownUsage(command));
      };
      await expect(send("settle-dispatched", DISPATCHED)).rejects.toThrow("control-verb-human-only");
      expect(t.body(runId)).toEqual(before);
      expect(await send("settle-token", TOKEN)).not.toHaveProperty("error");
      const after = t.body(runId);
      expect(after.usageSettlement).toMatchObject({ principal: "user:u-owner", commandId: "settle-token" });
      expect(t.h.store.db.prepare("SELECT client,principal,person_principal FROM commands WHERE id='settle-token'").get()).toEqual({ client: "cli", principal: "agent:cli", person_principal: "user:u-owner" });
      expect(hasValidUsageSettlement(t.h.store, after)).toBe(true);
    } finally { await t.h.dispose(); }
  });

  it("the routes put the person token's account beside the command, and nothing for a socket call without one", () => {
    const owner = { userId: "u-owner", name: "o", roles: ["owner"] as const };
    const by = { by: "o", via: "cli" };
    expect(routedCommandContext("cli", { kind: "agent", client: "cli", person: owner }, by)).toMatchObject({ principal: "agent:cli", personAuthority: true, personPrincipal: "user:u-owner" });
    expect(routedCommandContext("cli", { kind: "agent", client: "cli" }, by)).not.toHaveProperty("personPrincipal");
    expect(routedCommandContext("cli", { kind: "agent", client: "cli", dispatchedRun: "run-1", person: owner }, by)).toMatchObject({ personAuthority: false });
    expect(routedCommandContext("web", { kind: "user", ...owner }, by)).not.toHaveProperty("personPrincipal");
  });
});
