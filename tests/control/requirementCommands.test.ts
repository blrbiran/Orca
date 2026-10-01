import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { latestRound, readDraft, readRequirementGroup, readRound, saveRequirementGroup, writeRound } from "../../src/control/requirementRecords.js";
import { WebControlService } from "../../src/control/webService.js";
import { rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { INVALID_SPLIT, ROUND_ONE, ROUND_TWO, VALID_SPLIT } from "./fixtures/requirementOutputs.js";
import { profileSnapshot } from "./fixtures/web.js";

// N1 spec §11.1: every requirement command goes through applyWebCommand (id, expected revision, actor, replay); code
// decides every transition (Rule 5); illegal ones answer group-state-invalid (DR27).
const open = (groupId: string, payload: Record<string, unknown> = {}, commandId = `open-${groupId}`) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId },
  payload: { groupId, repoId: "repo", idea: "Let people export their notes as Markdown.", contentLanguage: "zh", ...payload },
}) as never;
const recommendedAll = (roundNo: number, x: Awaited<ReturnType<typeof requirementHarness>>) => {
  const result = x.round(roundNo).result!;
  return { roundNo, answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: false })) };
};
/** A round-1 output whose frontier is already empty: no questions, one open branch (spec §7.2). */
const SETTLED_ROUND_ONE = { ...ROUND_TWO, slug: "markdown-export" };
const bad = { ...ROUND_ONE, questions: [], frontierEmpty: false };

describe("requirement-open (N1 spec §11.1 item 1)", () => {
  it("creates a clarifying group with round 1 queued, its agent frozen, its id derived from the command", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      const answer = await x.service.openRequirement(open("n"));
      expect(answer).toMatchObject({ result: { kind: "requirement-opened", groupId: "n", roundNo: 1, requirementId: sha256Canonical({ groupId: "n", commandId: "open-n" }).slice(0, 32) } });
      const group = readRequirementGroup(x.store, "n");
      expect(group).toMatchObject({ status: "clarifying", limit: { tokens: 10_000_000, attempts: 40 } });
      expect(group.requirement).toMatchObject({ repoId: "repo", contentLanguage: "zh", createdOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), maxOutputTokens: 64_000, agentSlot: { selection: { agent: "codex" } } });
      expect(readRound(x.store, "n", 1).state).toBe("drafting");
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='n' AND kind='requirement-call' AND delivered=0").get()!.n).toBe(1);
      expect(await x.service.openRequirement(open("n"))).toEqual(answer);
    } finally { await x.dispose(); }
  });

  it("keeps a given limit and agent, and writes English when no content language is given", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      const limit = { tokens: 2_000_000, activeMs: 3_600_000, attempts: 4, sessions: 4 };
      const payload = { groupId: "e", repoId: "repo", idea: "Let people export their notes as Markdown.", limit, agent: { agent: "codex" } };
      expect(await x.service.openRequirement({ ...(open("e") as object), payload } as never)).toMatchObject({ result: { kind: "requirement-opened" } });
      const group = readRequirementGroup(x.store, "e");
      expect(group.limit).toEqual(limit);
      expect(group.agentOverrides).toEqual({ estimator: { agent: "codex" } });
      expect(group.requirement.contentLanguage).toBe("en");
    } finally { await x.dispose(); }
  });

  it("refuses an unknown repository, an existing group id, and an idea over 32 KB", async () => {
    const x = await requirementHarness({ answers: [] });
    try {
      expect(await x.service.openRequirement(open("m", { repoId: "elsewhere" }))).toMatchObject({ error: { code: "group-project-binding-required" } });
      // A command that names an existing group at its current revision reaches apply, which refuses it by name.
      expect(await x.service.openRequirement({ ...(open("r") as object), expectedRevision: 1 } as never)).toMatchObject({ error: { code: "group-already-exists" } });
      expect(readRequirementGroup(x.store, "r").requirement.requirementId).toBe("0123456789abcdef0123456789abcdef");
      expect(rawAuthorityCommandSchema.safeParse(open("big", { idea: "x".repeat(32 * 1024 + 1) })).success).toBe(false);
      expect(rawAuthorityCommandSchema.safeParse(open("big", { idea: "x".repeat(32 * 1024) })).success).toBe(true);
      // The target names the group the payload opens (as import-plan's does).
      expect(rawAuthorityCommandSchema.safeParse({ ...(open("m") as object), target: { kind: "group", groupId: "other" } }).success).toBe(false);
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM groups WHERE id IN ('m','big')").get()!.n).toBe(0);
    } finally { await x.dispose(); }
  });

  it("refuses an agent that does not resolve, and a profile with no estimator preflight, creating no group", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      expect(await x.service.openRequirement(open("g", { agent: { agent: "ghost" } }))).toMatchObject({ error: { code: "agent-selection-rejected" } });
      const snapshot = profileSnapshot();
      const bare = resolveProfile({ ...snapshot, profile: { ...snapshot.profile, estimatorPreflight: null } }, x.fake.port);
      const service = new WebControlService({ ...x.service.deps, profileRouter: createExecutionProfileRouter([bare]),
        defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: bare.profileHash, estimateMode: "soft" as const }) });
      expect(await service.openRequirement(open("u"))).toMatchObject({ error: { code: "control-estimator-unconfigured" } });
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM groups").get()!.n).toBe(0);
    } finally { await x.dispose(); }
  });
});

describe("requirement-answer and requirement-consensus (N1 spec §11.1 items 2-3, DR10)", () => {
  it("answers every question, resolves 'use recommended' to its text, records the decisions, and queues the next round", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const payload = { ...recommendedAll(1, x), answers: [{ id: "R1.Q1", kind: "recommended" }, { id: "R1.Q2", kind: "text", text: "As links, relative to the note" }] };
      expect(x.service.answerRequirement(x.command("requirement-answer", payload))).toMatchObject({ result: { kind: "requirement-answered", roundNo: 1, nextRoundNo: 2 } });
      expect(x.round(1)).toMatchObject({ state: "answered", answers: [{ id: "R1.Q1", kind: "recommended", text: "CommonMark" }, { id: "R1.Q2", kind: "text", text: "As links, relative to the note" }], glossaryDecisions: [{ id: "R1.G1", accept: true }], adrDecisions: [{ id: "R1.ADR1", accept: false }] });
      expect(x.round(2).state).toBe("drafting");
    } finally { await x.dispose(); }
  });

  it("refuses a partial answer, a stale round number and an unknown decision id, changing nothing", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const full = recommendedAll(1, x);
      for (const payload of [
        { ...full, answers: full.answers.slice(1) }, { ...full, roundNo: 2 }, { ...full, adrDecisions: [{ id: "R1.ADR9", accept: true }] },
        { ...full, glossaryDecisions: [] },
      ]) {
        expect(x.service.answerRequirement(x.command("requirement-answer", payload))).toMatchObject({ error: { code: "group-state-invalid" } });
      }
      expect(x.round(1).state).toBe("awaiting-answers");
    } finally { await x.dispose(); }
  });

  it("queues no round after a round whose frontier is empty, and then takes consensus with the open branches, once", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      x.service.answerRequirement(x.command("requirement-answer", recommendedAll(1, x)));
      await x.until(() => x.round(2).state === "awaiting-answers");
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(2, x)))).toMatchObject({ result: { nextRoundNo: null, wakeId: null } });
      expect(latestRound(x.store, "r")!.roundNo).toBe(2);
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 2 }))).toMatchObject({ result: { kind: "requirement-consensus", roundNo: 2, draftNo: 1 } });
      expect(readRequirementGroup(x.store, "r").requirement.consensus).toMatchObject({ roundNo: 2, openBranches: ["sync to a cloud drive"], openQuestions: [] });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "drafting", autoRetry: 0 });
      // A second consensus would queue draft 1 again over the first.
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 2 }))).toMatchObject({ error: { code: "group-state-invalid" } });
    } finally { await x.dispose(); }
  });

  it("closes a round still awaiting answers by consensus, listing its questions as open, and refuses consensus while the round is drafting", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 1 }))).toMatchObject({ error: { code: "group-state-invalid" } });
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 1 }))).toMatchObject({ result: { kind: "requirement-consensus" } });
      expect(x.round(1)).toMatchObject({ state: "answered", closedByConsensus: true, answers: [] });
      expect(readRequirementGroup(x.store, "r").requirement.consensus).toMatchObject({ openQuestions: ["R1.Q1", "R1.Q2"] });
    } finally { await x.dispose(); }
  });

  // Controller ruling PR-I1: the latest round is answered, so the only refusal left is the call in flight.
  it("refuses consensus while a call is in flight", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: SETTLED_ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(1, x)))).toMatchObject({ result: { nextRoundNo: null } });
      expect(x.round(1).state).toBe("answered");
      x.store.db.prepare("UPDATE runs SET active=1 WHERE group_id='r'").run();
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 1 }))).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(readRequirementGroup(x.store, "r").requirement.consensus).toBeNull();
      x.store.db.prepare("UPDATE runs SET active=0 WHERE group_id='r'").run();
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 1 }))).toMatchObject({ result: { kind: "requirement-consensus", roundNo: 1 } });
    } finally { await x.dispose(); }
  });

  it("takes consensus over a failed later round, from the last round that has an understanding (DR10)", async () => {
    const x = await requirementHarness({ answers: [ROUND_ONE, bad, bad, bad].map((output) => ({ purpose: "clarify" as const, output })) });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      x.service.answerRequirement(x.command("requirement-answer", recommendedAll(1, x)));
      await x.until(() => x.round(2).state === "failed");
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 2 }))).toMatchObject({ result: { kind: "requirement-consensus", roundNo: 2, draftNo: 1 } });
      expect(readRequirementGroup(x.store, "r").requirement.consensus).toMatchObject({ roundNo: 2, openBranches: ["sync to a cloud drive"], openQuestions: [] });
    } finally { await x.dispose(); }
  });

  it("takes consensus over an interrupted later round (DR10)", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      x.service.answerRequirement(x.command("requirement-answer", recommendedAll(1, x)));
      writeRound(x.store, "r", { ...x.round(2), state: "interrupted" });
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 2 }))).toMatchObject({ result: { kind: "requirement-consensus", roundNo: 2 } });
    } finally { await x.dispose(); }
  });

  it("refuses a command under a stale revision, and replays a repeated one", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const command = x.command("requirement-answer", recommendedAll(1, x));
      const first = x.service.answerRequirement(command);
      expect(x.service.answerRequirement(command)).toEqual(first);
      const stale = { ...(command as object), commandId: "stale" } as never;
      expect(x.service.answerRequirement(stale)).toMatchObject({ error: { code: "revision-conflict" } });
    } finally { await x.dispose(); }
  });
});

describe("requirement commands on a group that is no longer clarifying (N1 spec §11.1, DR27)", () => {
  it("refuses answer and consensus once the group has left clarifying", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      x.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','draft') WHERE id='r'").run();
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(1, x)))).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 1 }))).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(x.round(1).state).toBe("awaiting-answers");
    } finally { await x.dispose(); }
  });

  it("refuses draft feedback once the group has left clarifying", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      x.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','draft') WHERE id='r'").run();
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: "Merge them." }))).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(readDraft(x.store, "r", 1).state).toBe("awaiting-review");
    } finally { await x.dispose(); }
  });
});

describe("requirement-draft-feedback and recovery-retry (N1 spec §11.1 item 4, DR15)", () => {
  it("rejects a draft under review with the person's words and drafts the next with them in its prompt", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }, { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: "Merge the two tasks into one." }))).toMatchObject({ result: { kind: "requirement-draft-rejected", draftNo: 1, nextDraftNo: 2 } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "rejected", feedback: "Merge the two tasks into one." });
      await x.until(() => readDraft(x.store, "r", 2).state === "awaiting-review");
      const second = x.fake.calls.accept[1]!;
      expect(second.work.kind === "single-call" && second.work.prompt).toContain("Merge the two tasks into one.");
      expect(readDraft(x.store, "r", 2).autoRetry).toBe(0);
    } finally { await x.dispose(); }
  });

  it("starts the draft after feedback at a fresh retry count, even when the rejected one was itself a retry (DR9)", async () => {
    const x = await requirementHarness({ answers: [INVALID_SPLIT, VALID_SPLIT, VALID_SPLIT].map((output) => ({ purpose: "split" as const, output })), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 2).state === "awaiting-review");
      expect(readDraft(x.store, "r", 2).autoRetry).toBe(1);
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 2, feedback: "One task is enough." }))).toMatchObject({ result: { nextDraftNo: 3 } });
      expect(readDraft(x.store, "r", 3)).toMatchObject({ state: "drafting", autoRetry: 0 });
    } finally { await x.dispose(); }
  });

  it("refuses feedback on a draft that is not under review, or not the latest", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: "Too early." }))).toMatchObject({ error: { code: "group-state-invalid" } });
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 2, feedback: "No such draft." }))).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", feedback: null });
    } finally { await x.dispose(); }
  });

  it("re-queues a failed round with a fresh retry count", async () => {
    const x = await requirementHarness({ answers: [bad, bad, bad, ROUND_ONE].map((output) => ({ purpose: "clarify" as const, output })) });
    try {
      await x.until(() => x.round(1).state === "failed");
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(x.round(1)).toMatchObject({ state: "drafting", retries: 0, reasonCode: null });
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.round(1).calls.map((call) => call.outcome)).toEqual(["invalid", "invalid", "invalid", "valid"]);
    } finally { await x.dispose(); }
  });

  it("re-queues a failed draft as the next draft with a fresh retry count (Task 8 carry)", async () => {
    const x = await requirementHarness({ answers: [INVALID_SPLIT, INVALID_SPLIT, INVALID_SPLIT, VALID_SPLIT].map((output) => ({ purpose: "split" as const, output })), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 3).state === "failed");
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(readDraft(x.store, "r", 3).state).toBe("failed");
      expect(readDraft(x.store, "r", 4)).toMatchObject({ state: "drafting", autoRetry: 0 });
      await x.until(() => readDraft(x.store, "r", 4).state === "awaiting-review");
    } finally { await x.dispose(); }
  });

  it("clears a completed stop and re-queues the interrupted round", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_ONE }], stoppable: true });
    try {
      await x.until(() => x.runs()[0]?.state === "accepted");
      await x.service.handoffStop(x.command("handoff-stop", {}));
      // A stop still waiting for its call is not lifted.
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { resolved: false } });
      expect(x.group().stopped).toBe(true);
      await x.until(() => x.round(1).state === "interrupted");
      await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }));
      expect(x.group().stopped).toBe(false);
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM stop_intents WHERE group_id='r'").get()!.n).toBe(0);
      expect(x.round(1).state).toBe("drafting");
    } finally { await x.dispose(); }
  });

  it("clears a completed stop and re-queues the interrupted draft as the next draft", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], stoppable: true, startAt: "split" });
    try {
      await x.until(() => x.runs()[0]?.state === "accepted");
      await x.service.handoffStop(x.command("handoff-stop", {}));
      await x.until(() => readDraft(x.store, "r", 1).state === "interrupted");
      await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }));
      expect(x.group().stopped).toBe(false);
      expect(readDraft(x.store, "r", 2)).toMatchObject({ state: "drafting", autoRetry: 0 });
    } finally { await x.dispose(); }
  });

  it("retries a conflicted export: pending again and its wake undelivered, a drafting round left alone", async () => {
    const x = await requirementHarness({ answers: [] });
    try {
      const group = readRequirementGroup(x.store, "r");
      group.requirement.export = { state: "conflict", path: null, commit: null, parent: null, detail: "requirement-export-conflict:orca/r" };
      saveRequirementGroup(x.store, group);
      x.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('scheduler-wake:r:requirement-export','r','requirement-export','{\"groupId\":\"r\"}',1)").run();
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { resolved: true, wakeIds: ["scheduler-wake:r:requirement-export"] } });
      expect(readRequirementGroup(x.store, "r").requirement.export).toEqual({ state: "pending", path: null, commit: null, parent: null, detail: null });
      expect(x.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id='scheduler-wake:r:requirement-export'").get()!.delivered).toBe(0);
      expect(x.round(1)).toMatchObject({ state: "drafting", calls: [] });
    } finally { await x.dispose(); }
  });
});

// Final review fix wave (session b5e8d368, 2026-10-02), finding 5: a stop holds every call, so nothing that queues one
// is taken while the group is stopped (group-stopped, as accept refuses it); recovery-retry lifts the stop.
describe("requirement commands on a stopped group (final review finding 5)", () => {
  it("refuses answer and consensus while the stop stands, changing nothing, and takes them once recovery-retry lifts it", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped", frozenRunIds: [] } });
      const before = x.round(1);
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(1, x)))).toMatchObject({ error: { code: "group-stopped" } });
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 1 }))).toMatchObject({ error: { code: "group-stopped" } });
      expect(x.round(1)).toEqual(before);
      expect(readRequirementGroup(x.store, "r").requirement.consensus).toBeNull();
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { resolved: true } });
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(1, x)))).toMatchObject({ result: { kind: "requirement-answered", nextRoundNo: 2 } });
    } finally { await x.dispose(); }
  });

  it("refuses draft feedback while the stop stands, changing nothing", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: "Fold the two into one." }))).toMatchObject({ error: { code: "group-stopped" } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", feedback: null });
    } finally { await x.dispose(); }
  });

  it("a stop before any call leaves the round drafting, and recovery-retry lets its held wake be claimed", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped", frozenRunIds: [] } });
      for (let i = 0; i < 3; i += 1) { await x.deliver(); await x.driver.round(); }
      expect(x.runs()).toEqual([]);
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { resolved: true } });
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.fake.calls.accept).toHaveLength(1);
    } finally { await x.dispose(); }
  });
});
