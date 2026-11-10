import { describe, expect, it } from "vitest";
import type { PartialSelection } from "../../src/control/agentSelection.js";
import { ControlError } from "../../src/control/errors.js";
import type { AgentModelsView } from "../../src/control/executionPort.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { fixtureConfigHashOf, fixtureResolveAgent } from "./fixtures/agents.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, ROUND_TWO } from "./fixtures/requirementOutputs.js";
import { profileSnapshot } from "./fixtures/web.js";

// Issue #236 (tester follow-up B, T5): ccloop resolves a codex single call by an exact catalog selector, and the tester's
// catalog renamed `mode-…` to `tokenswitch/mode-…` between rounds. The requirement's frozen selector then made every later
// round fail at accept (single-call-unsupported), the only recovery re-accepted the same frozen selection, and no verb
// could change it: the requirement was stuck with its paid rounds stranded. These criteria pin the three halves of the fix:
// a stale selector is refused at the door with the catalog's candidates, it is caught before a later round's call is sent,
// and requirement-set-agent re-freezes the slot and restarts the blocked round, keeping the rounds already answered.
const RENAMED = "tokenswitch/fixture-model";
const catalog = (...names: string[]): AgentModelsView => ({ installation: "codex", kind: "codex", source: "cache", observedAt: null,
  models: names.map((model) => ({ model, contextWindowTokens: 1_000_000, maxOutputTokens: 64_000, singleCallExecution: "v1-soft" as const })) });
const capabilities = () => profileSnapshot().profile.capabilities;
const recommendedAll = (x: Awaited<ReturnType<typeof requirementHarness>>, roundNo: number) => {
  const result = x.round(roundNo).result!;
  return { roundNo, answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: false })) };
};
/** Round 1 answered, round 2 queued: the requirement has a paid, finished round before the catalog changes. */
async function answeredRoundOne(x: Awaited<ReturnType<typeof requirementHarness>>) {
  await x.until(() => x.round(1).state === "awaiting-answers");
  expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(x, 1)))).toMatchObject({ result: { nextRoundNo: 2 } });
  return structuredClone(x.round(1));
}
const roundTwoRun = (x: Awaited<ReturnType<typeof requirementHarness>>) => x.runs().filter((run) => run.workItemId === "round-2");

describe("a frozen codex selector the catalog no longer lists (#236)", () => {
  it("requirement-open refuses a selector the read catalog does not list, naming the catalog's candidates, and creates nothing", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      // What ccloop answers for an unlisted codex selector: no catalog row, so no single call (the declared window stays).
      x.fake.setResolveAgent(async (partial: PartialSelection) => ({ ...await x.fake.baseResolveAgent(partial), singleCallExecution: null }));
      x.fake.setModels(catalog(RENAMED, "gpt-other"));
      const open = { schema: "orca-raw-command-v1", commandId: "open-n", actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId: "n" },
        payload: { groupId: "n", repoId: "repo", idea: "Let people export their notes as Markdown." } } as never;
      expect(await x.service.openRequirement(open)).toMatchObject({ error: { code: "agent-selection-invalid", message: `agent-selection-invalid:fixture-model (listed: ${RENAMED} gpt-other)` } });
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM groups").get()!.n).toBe(0);
    } finally { await x.dispose(); }
  });

  it("control: a catalog that cannot be read refuses nothing at open (as the estimator rule)", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      const open = { schema: "orca-raw-command-v1", commandId: "open-n", actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId: "n" },
        payload: { groupId: "n", repoId: "repo", idea: "Let people export their notes as Markdown." } } as never;
      expect(await x.service.openRequirement(open)).toMatchObject({ result: { kind: "requirement-opened" } });
    } finally { await x.dispose(); }
  });

  it("a later round whose frozen selector left the catalog is blocked at A2 by name, before its call is sent", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      x.fake.setModels(catalog("fixture-model"));
      await answeredRoundOne(x);
      const accepted = x.fake.calls.accept.length;
      x.fake.setModels(catalog(RENAMED));
      await x.until(() => roundTwoRun(x).some((run) => run.state === "blocked") || x.round(2).state !== "drafting");
      expect(x.round(2).state).toBe("drafting");
      expect(roundTwoRun(x).map((run) => [run.state, run.drive.blockedAt, run.drive.blockedReason])).toEqual([["blocked", "A2", `agent-selection-invalid:fixture-model (listed: ${RENAMED})`]]);
      expect(x.fake.calls.accept.length).toBe(accepted);
    } finally { await x.dispose(); }
  });

  it("requirement-set-agent re-freezes the slot and restarts a round blocked on the stale selector; round 1 survives", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      x.fake.setResolveAgent(fixtureResolveAgent(capabilities, { distinctConfigHash: true }));
      x.fake.setModels(catalog("fixture-model"));
      const roundOne = await answeredRoundOne(x);
      const before = readRequirementGroup(x.store, "r").requirement.agentSlot;
      x.fake.setModels(catalog(RENAMED));
      await x.until(() => roundTwoRun(x).some((run) => run.state === "blocked"));
      const blockedRunId = roundTwoRun(x)[0]!.runId;
      const result = await x.service.requirementSetAgent(x.command("requirement-set-agent", { agent: { agent: "codex", model: RENAMED } }));
      expect(result).toMatchObject({ result: { kind: "requirement-agent-set", restarted: { roundNo: 2 } } });
      const after = readRequirementGroup(x.store, "r");
      const selection = { agent: "codex", model: RENAMED, contextWindow: "agent-default" as const };
      expect(after.requirement.agentSlot.selection).toEqual(selection);
      expect(after.requirement.agentSlot.configHash).toBe(fixtureConfigHashOf(selection));
      expect(after.requirement.agentSlot.configHash).not.toBe(before.configHash);
      expect(after.agentOverrides).toEqual({ estimator: { agent: "codex", model: RENAMED } });
      expect(x.runs().find((run) => run.runId === blockedRunId)).toMatchObject({ active: 0 });
      await x.until(() => x.round(2).state === "awaiting-answers");
      const restarted = roundTwoRun(x).at(-1)!;
      expect(restarted.runId).not.toBe(blockedRunId);
      expect([restarted.configHash, restarted.agent.model]).toEqual([fixtureConfigHashOf(selection), RENAMED]);
      expect(x.fake.calls.accept.at(-1)!.claim.configHash).toBe(fixtureConfigHashOf(selection));
      expect(x.round(1)).toEqual(roundOne);
      // The closed call's grant went back at set-agent (the restarted call is claimed later, from its wake), and nothing
      // stays reserved once the restarted round settled.
      expect(after.reserved).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      expect(readRequirementGroup(x.store, "r").reserved).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
    } finally { await x.dispose(); }
  });

  it("requirement-set-agent restarts a round ccloop refused at accept with single-call-unsupported", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      const roundOne = await answeredRoundOne(x);
      // No catalog this time (Orca cannot see the miss), so ccloop's own refusal is what blocks the round.
      x.fake.refuseAccept(new ControlError("control-peer-exit", "2:single-call-unsupported: codex model fixture-model has no single call"));
      await x.until(() => roundTwoRun(x).some((run) => run.state === "blocked"));
      expect(roundTwoRun(x)[0]!.drive.blockedReason).toMatch(/^accept-refused:2:single-call-unsupported/);
      x.fake.refuseAccept(null);
      expect(await x.service.requirementSetAgent(x.command("requirement-set-agent", { agent: { agent: "codex", model: RENAMED } }))).toMatchObject({ result: { kind: "requirement-agent-set", restarted: { roundNo: 2 } } });
      await x.until(() => x.round(2).state === "awaiting-answers");
      expect(roundTwoRun(x).at(-1)!.agent.model).toBe(RENAMED);
      expect(x.round(1)).toEqual(roundOne);
    } finally { await x.dispose(); }
  });

  // Plan 2026-11-10 follow-up B, T10 (T5's hint): the brief and requirement show print the summary's blockedRun; a call
  // blocked on its agent names the verb that unblocks it (as T1's firstFailure.next names recovery retry), another block
  // does not -- set-agent would refuse it as a call in flight.
  const SET_AGENT_NEXT = "orca requirement set-agent r --agent <agent> --model <model>";
  it("the summary's blocked call names requirement set-agent when blocked on its agent at A2 or at accept, and not otherwise", async () => {
    const stale = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      stale.fake.setModels(catalog("fixture-model"));
      await answeredRoundOne(stale);
      stale.fake.setModels(catalog(RENAMED));
      await stale.until(() => roundTwoRun(stale).some((run) => run.state === "blocked"));
      expect(readGroupSummary(stale.store, "r").requirement!.blockedRun)
        .toEqual({ runId: roundTwoRun(stale)[0]!.runId, reason: `agent-selection-invalid:fixture-model (listed: ${RENAMED})`, next: SET_AGENT_NEXT });
    } finally { await stale.dispose(); }
    const refused = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      await answeredRoundOne(refused);
      refused.fake.refuseAccept(new ControlError("control-peer-exit", "2:single-call-unsupported: codex model fixture-model has no single call"));
      await refused.until(() => roundTwoRun(refused).some((run) => run.state === "blocked"));
      expect(readGroupSummary(refused.store, "r").requirement!.blockedRun!.next).toBe(SET_AGENT_NEXT);
    } finally { await refused.dispose(); }
    const other = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      await answeredRoundOne(other);
      other.fake.refuseAccept(new ControlError("control-peer-exit", "2:claim-invalid: not this agent's fault"));
      await other.until(() => roundTwoRun(other).some((run) => run.state === "blocked"));
      const blocked = readGroupSummary(other.store, "r").requirement!.blockedRun!;
      expect(blocked.reason).toMatch(/^accept-refused:2:claim-invalid/);
      expect(blocked).not.toHaveProperty("next");
    } finally { await other.dispose(); }
  });

  it("requirement-set-agent refuses a selector the catalog does not list, and a call that is in flight for another reason", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      x.fake.setModels(catalog("fixture-model", RENAMED));
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(await x.service.requirementSetAgent(x.command("requirement-set-agent", { agent: { agent: "codex", model: "mode-gone" } })))
        .toMatchObject({ error: { code: "agent-selection-invalid", message: `agent-selection-invalid:mode-gone (listed: fixture-model ${RENAMED})` } });
      expect(readRequirementGroup(x.store, "r").requirement.agentSlot.selection.model).toBe("fixture-model");
      // No call in flight: the slot is re-frozen and nothing is restarted.
      expect(await x.service.requirementSetAgent(x.command("requirement-set-agent", { agent: { agent: "codex", model: RENAMED } })))
        .toMatchObject({ result: { kind: "requirement-agent-set", restarted: null } });
      expect(readRequirementGroup(x.store, "r").requirement.agentSlot.selection.model).toBe(RENAMED);
      expect(x.round(1).state).toBe("awaiting-answers");
      // Round 2's call claimed (the pump ran, the driver has not): a call in flight that is not blocked on its agent is refused.
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(x, 1)))).toMatchObject({ result: { nextRoundNo: 2 } });
      await x.deliver();
      expect(roundTwoRun(x).map((run) => [run.state, run.active])).toEqual([["starting", 1]]);
      expect(await x.service.requirementSetAgent(x.command("requirement-set-agent", { agent: { agent: "codex", model: "fixture-model" } })))
        .toMatchObject({ error: { code: "group-state-invalid", message: expect.stringContaining("call-in-flight") } });
      expect(readRequirementGroup(x.store, "r").requirement.agentSlot.selection.model).toBe(RENAMED);
    } finally { await x.dispose(); }
  });
});
