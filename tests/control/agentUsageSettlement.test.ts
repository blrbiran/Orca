import { describe, expect, it } from "vitest";
import { renderHelp } from "../../src/commands/help.js";
import { REGISTRY } from "../../src/commands/registry.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { hasValidUsageSettlement } from "../../src/control/usageSettlement.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { humanOnlyRefusal, socketTier } from "../../src/panel/humanOnly.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";
import { unknownFailure } from "./fixtures/unknownFailure.js";

/**
 * Tester follow-up E §8 (#101/#104/#116; human ruling 「其他都按你的建议走」): an orchestrating agent on the control socket,
 * without a person token, may settle a run's unknown usage by charging the whole remaining grant (never under-books: the
 * grant was already reserved) or, when ccloop proved it, at known zero. Releasing an unlimited remainder unmetered stays a
 * person's act, and a run Orca dispatched is refused every form. A single call's charge-and-retry (recovery-retry
 * `acknowledge: "charge-remaining-grant"`, the same "charge the grant" form; flow calls included) follows the same rule.
 * The settlement is booked to the agent's principal (`agent:<client>`), which its ledger row backs.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const AGENT: Principal = { kind: "agent", client: "cli" };
const MCP: Principal = { kind: "agent", client: "mcp:test" };
const DISPATCHED: Principal = { kind: "agent", client: "cli", dispatchedRun: "run-dispatched" };
const MEMBER: Principal = { kind: "user", userId: "u-member", name: "bo", roles: ["member"] };
const BY = { by: "ana", via: "cli" };
const context = (p: Principal) => routedCommandContext(p.kind === "user" ? "web" : p.client, p, BY);
const payload = (acknowledge: string) => ({ taskId: "a", runId: "run-1", generation: 1, acknowledge });

const settleAs = (t: Harness, runId: string, who: Principal, acknowledge: string) => {
  const c = (t.h.command as (verb: string, payload: unknown) => { commandId: string })("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge });
  return withCommandContext(c.commandId, context(who), () => (t.service as never as { settleUnknownUsage(c: unknown): Promise<any> }).settleUnknownUsage(c))
    .then(answer => ({ answer, commandId: c.commandId }), (error: unknown) => ({ answer: { thrown: String(error) }, commandId: c.commandId }));
};

describe("who may settle unknown usage on the socket (tester follow-up E §8)", () => {
  it("the gate: an agent without a token may charge the grant or settle a proved zero; release-unmetered wants a person and says which forms an agent may use", () => {
    const answer = (p: Principal, acknowledge: string) => permissionRefusal(p, "settle-unknown-usage", payload(acknowledge))?.code ?? "accepted";
    // mutation: settle-unknown-usage's SOCKET_TIER row back to "token" -> the first two red
    expect(answer(AGENT, "charge-remaining-grant")).toBe("accepted");
    expect(answer(AGENT, "release-known-zero")).toBe("accepted");
    expect(answer(MCP, "charge-remaining-grant")).toBe("accepted");
    // mutation: the predicate answers "open" for every acknowledge -> red
    expect(answer(AGENT, "release-unmetered")).toBe("control-person-token-required");
    // A payload the predicate cannot read is the stricter tier.
    expect(socketTier("settle-unknown-usage", {})).toBe("token");
    expect(socketTier("settle-unknown-usage", { acknowledge: "something-else" })).toBe("token");
    const message = permissionRefusal(AGENT, "settle-unknown-usage", payload("release-unmetered"))!.message;
    // mutation: drop the verb's note from the refusal -> red
    expect(message).toContain("charge-remaining-grant");
    expect(message).toContain("release-known-zero");
    // Dispatched runs and Web members are unchanged.
    for (const acknowledge of ["charge-remaining-grant", "release-known-zero", "release-unmetered"]) {
      expect(answer(DISPATCHED, acknowledge), acknowledge).toBe("control-dispatched-run-refused");
      expect(answer(MEMBER, acknowledge), acknowledge).toBe("control-verb-human-only");
    }
    expect(humanOnlyRefusal("settle-unknown-usage", payload("charge-remaining-grant"))?.code).toBe("control-verb-human-only");
  });

  it("the CLI's help and its refusal hint say which forms an agent may use without a token", () => {
    const help = renderHelp(["task", "settle-usage"]);
    // mutation: restore the old flag summary -> red
    expect(help).toContain("an agent may send charge-remaining-grant, or release-known-zero");
    expect(help).toContain("release-unmetered needs a person token");
    const def = REGISTRY.find((d) => d.domain === "task" && d.action === "settle-usage")!;
    // mutation: drop the hint -> red
    expect(def.hint?.({ code: "control-person-token-required", message: "" })).toContain("charge-remaining-grant");
    expect(def.hint?.({ code: "run-usage-settled", message: "" })).toBeUndefined();
    expect(renderHelp(["recovery", "retry"])).toContain("an agent may send it without a person token");
  });

  it("the gate: a single call's charge-and-retry is open to an agent without a token, refused to a dispatched run", () => {
    const retry = { scope: "run", runId: "run-1", acknowledge: "charge-remaining-grant" };
    // mutation: recovery-retry.acknowledge back to "token" -> red
    expect(permissionRefusal(AGENT, "recovery-retry", retry)).toBeNull();
    expect(permissionRefusal(DISPATCHED, "recovery-retry", retry)?.code).toBe("control-dispatched-run-refused");
    expect(permissionRefusal(MEMBER, "recovery-retry", retry)?.code).toBe("control-field-human-only");
  });
});

describe("an agent's settlement is booked to the agent (tester follow-up E §8)", { timeout: 120_000 }, () => {
  it("charge-remaining-grant from a socket agent without a token settles, books agent:cli in the marker, the ledger row and the activity, and readers accept it", async () => {
    const { t, runId } = await unknownFailure();
    try {
      const before = t.body(runId);
      // A run Orca dispatched is refused at the service too (defence in depth behind the gate).
      // mutation: drop the dispatched-run check in settlingPrincipalFor -> red
      expect((await settleAs(t, runId, DISPATCHED, "charge-remaining-grant")).answer).toMatchObject({ thrown: expect.stringContaining("control-verb-human-only") });
      expect(t.body(runId)).toEqual(before);
      const { answer, commandId } = await settleAs(t, runId, AGENT, "charge-remaining-grant");
      // mutation: settlingPrincipalFor answers only a person -> red here
      expect(answer).not.toHaveProperty("error");
      expect(answer).not.toHaveProperty("thrown");
      const after = t.body(runId);
      expect(after.usageSettlement).toMatchObject({ method: "remaining-grant", principal: "agent:cli", commandId });
      expect(t.h.store.db.prepare("SELECT client,principal,person_principal FROM commands WHERE id=?").get(commandId)).toEqual({ client: "cli", principal: "agent:cli", person_principal: null });
      const activity = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='usage-settled'").get(runId)!.body));
      expect(activity).toMatchObject({ method: "remaining-grant", principal: "agent:cli" });
      // mutation: the validator ignores agent rows (only person_principal) -> red
      expect(hasValidUsageSettlement(t.h.store, after)).toBe(true);
      // The marker must be backed by its own row: an agent principal the row does not name is invalid.
      const forged = structuredClone(after); forged.usageSettlement.principal = "agent:other";
      expect(hasValidUsageSettlement(t.h.store, forged)).toBe(false);
      // A person's principal on an agent's row is invalid too (the row named no person).
      forged.usageSettlement.principal = "user:u-owner";
      expect(hasValidUsageSettlement(t.h.store, forged)).toBe(false);
      // An agent's marker is backed only by a row that names no person: the same row with a person on it is not the agent's.
      // mutation: drop `row.person_principal !== null` from the agent branch of the validator -> true, red
      t.h.store.db.prepare("UPDATE commands SET person_principal='user:u-owner' WHERE id=?").run(commandId);
      expect(hasValidUsageSettlement(t.h.store, after)).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("release-unmetered from a socket agent without a token is refused at the service, naming the forms an agent may use", async () => {
    const { t, runId } = await unknownFailure([{ taskId: "a", tokenBudget: null } as never], true, { tokenPolicy: "optional-v1" });
    try {
      const before = t.body(runId);
      expect(before.remaining.work.tokens).toBeNull();
      const { answer } = await settleAs(t, runId, AGENT, "release-unmetered");
      // mutation: let any acknowledge through settlingPrincipalFor for an agent -> settles, red
      expect(answer).toMatchObject({ thrown: expect.stringContaining("control-verb-human-only") });
      expect((answer as { thrown: string }).thrown).toContain("charge-remaining-grant");
      expect(t.body(runId)).toEqual(before);
    } finally { await t.h.dispose(); }
  });

  it("release-known-zero from a socket agent settles when proved, booked to the agent; refused when not proved", async () => {
    const known = { failure: () => ({ failureCause: { cause: "rate-limited" as const, phase: "plan" as const, retries: 0, detail: null, usageKnownZero: true as const } }) };
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed-usage-unknown", sealedOwnerProof: true, tokenPolicy: "optional-v1", ...known });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const { answer, commandId } = await settleAs(t, runId, AGENT, "release-known-zero");
      expect(answer).not.toHaveProperty("error");
      expect(answer).not.toHaveProperty("thrown");
      expect(t.body(runId).usageSettlement).toMatchObject({ method: "known-zero", principal: "agent:cli", commandId });
      expect(hasValidUsageSettlement(t.h.store, t.body(runId))).toBe(true);
    } finally { await t.h.dispose(); }
    const unproved = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed-usage-unknown", sealedOwnerProof: true, tokenPolicy: "optional-v1",
      failure: () => ({ failureCause: { cause: "rate-limited" as const, phase: "plan" as const, retries: 0, detail: null } }) });
    try {
      const runId = await unproved.claim(), driver = unproved.driver();
      await unproved.until(driver, () => unproved.body(runId).state === "blocked");
      const { answer } = await settleAs(unproved, runId, AGENT, "release-known-zero");
      expect((answer as { error?: { code: string; message: string } }).error).toMatchObject({ code: "run-usage-not-settleable" });
      expect((answer as { error: { message: string } }).error.message).toContain("known-zero-not-proved");
    } finally { await unproved.h.dispose(); }
  });

  it("a single call's charge-and-retry from a socket agent without a token settles, booked to the agent", async () => {
    const STALLED = { outcome: "failed" as const, output: null, tokens: null, errorCode: "omp-stalled" };
    const x = await requirementHarness({ startAt: "split", answers: [{ purpose: "split", ...STALLED }, { purpose: "split", output: VALID_SPLIT }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      const runId = x.runs()[0]!.runId;
      const send = (who: Principal) => {
        const command = x.command("recovery-retry", { scope: "run", runId, acknowledge: "charge-remaining-grant" }, { kind: "run", groupId: "r", runId }) as { commandId: string };
        return withCommandContext(command.commandId, context(who), () => x.service.recoveryRetry(command as never)) as Promise<{ error?: { code: string; message?: string } }>;
      };
      // mutation: drop the dispatched-run check in settlingPrincipalFor -> red
      expect((await send(DISPATCHED)).error).toMatchObject({ code: "run-usage-not-settleable" });
      expect(x.runs()[0]).toMatchObject({ state: "blocked", unknown: { work: true } });
      // mutation: the single-call settlement keeps settlingPersonFor -> red
      expect(await send(AGENT)).toMatchObject({ result: { resolved: true } });
      expect(x.runs()[0]).toMatchObject({ singleCallSettlement: { principal: "agent:cli" } });
    } finally { await x.dispose(); }
  });
});
