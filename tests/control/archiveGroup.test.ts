import { withCommandContext } from "../../src/control/commandClient.js";
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupArchived } from "../../src/control/archivedMark.js";
import { lookupCommandResult, preflightWebCommand, updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { insertClarifyingGroup, newRound, writeRound } from "../../src/control/requirementRecords.js";
import { groupStopState, settleHandoffRequest } from "../../src/control/stopIntent.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { createWebWakeHandlers, deliverScheduledStart, nextClaimableTask } from "../../src/control/webDispatch.js";
import { commandVerbSchema, rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { applySettleApproximateUsage } from "../../src/control/softLoopSettlement.js";
import { readControlRecovery, readGroupSummary } from "../../src/panel/controlViews.js";
import { clarifyingInput } from "./fixtures/requirement.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { WebFixtureTask } from "./fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const body = (h: H, id = "g") => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const writeBody = (h: H, value: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(value));
const revisionOf = (h: H, id = "g") => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);
const dispatch = (h: H) => ({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate });
const lastSeq = (h: H) => Number(h.store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM activity").get()!.n);

/** A confirmed group "g": ready, no run, its import estimate still queued (queued is not in flight). */
async function confirmed(tasks: readonly WebFixtureTask[] = [{ taskId: "a" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}

async function claimed(h: H, service: WebControlService): Promise<string> {
  await service.start(h.command("start", {}));
  const outcome = await deliverScheduledStart(dispatch(h), "g");
  if (outcome.kind !== "claimed") throw new Error(JSON.stringify(outcome));
  return outcome.runId;
}

describe("archive-group and unarchive-group (issue-fixes spec §6.3)", () => {
  it("archives an idle group: the body says when and by whom, the summary says archived, and an archived row is written", async () => {
    const { h, service } = await confirmed();
    try {
      const before = Date.now(), seq = lastSeq(h);
      const result = service.archiveGroup(h.command("archive-group", {}));
      if ("error" in result || result.result.kind !== "archived") throw new Error(JSON.stringify(result));
      expect(result.result.groupId).toBe("g");
      expect(body(h).archived).toEqual({ at: result.result.at, actor: "human" });
      expect(result.result.at).toBeGreaterThanOrEqual(before);
      expect(result.result.at).toBeLessThanOrEqual(Date.now());
      expect(readGroupSummary(h.store, "g").archived).toBe(true);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("archived");
    } finally { await h.dispose(); }
  });

  it("a never-estimated draft archives", async () => {
    const h = await webFixture();
    try {
      h.importDeferred("d");
      const service = new WebControlService(h.deps);
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM estimates WHERE group_id='d'").get()!.n).toBe(0);
      const result = service.archiveGroup(h.rawCommand("archive-d", 1, "archive-group", { kind: "group", groupId: "d" }, {}) as never);
      if ("error" in result || result.result.kind !== "archived") throw new Error(JSON.stringify(result));
      expect(result.result.groupId).toBe("d");
      expect(body(h, "d").archived).toEqual({ at: result.result.at, actor: "human" });
      expect(readGroupSummary(h.store, "d").archived).toBe(true);
    } finally { await h.dispose(); }
  });

  it("unarchive removes the mark and writes an unarchived row; unarchiving a group that is not archived is a no-op refusal", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const seq = lastSeq(h);
      const result = service.unarchiveGroup(h.command("unarchive-group", {}));
      if ("error" in result || result.result.kind !== "unarchived") throw new Error(JSON.stringify(result));
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
      expect(readGroupSummary(h.store, "g").archived).toBe(false);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("unarchived");
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ error: { code: "no-op-command" } });
    } finally { await h.dispose(); }
  });

  it("archives under a pause with no active run, and under a handoff stop that is complete", async () => {
    const paused = await confirmed();
    try {
      await paused.service.pauseDispatch(paused.h.command("pause-dispatch", {}));
      expect(paused.service.archiveGroup(paused.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await paused.h.dispose(); }
    const handedOff = await confirmed();
    try {
      await handedOff.service.handoffStop(handedOff.h.command("handoff-stop", {}));
      expect(groupStopState(handedOff.h.store, "g")).toBe("handoff-complete");
      expect(handedOff.service.archiveGroup(handedOff.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await handedOff.h.dispose(); }
  });

  it("archives under a handoff stop that settled partially: the frozen run was not recoverable, nothing is in motion", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      await service.handoffStop(h.command("handoff-stop", {}));
      const request = h.store.db.prepare("SELECT id FROM handoff_requests WHERE group_id='g'").get()!;
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter }, { requestId: String(request.id), outcome: "settled-unrecoverable", reasonCode: "profile-changed" });
      expect(groupStopState(h.store, "g")).toBe("handoff-partial");
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await h.dispose(); }
  });

  it("refuses while a run is active: archive-run-active", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-run-active" } });
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
    } finally { await h.dispose(); }
  });

  // Tester #292 (follow-up J): the refusal names every active run, its state and block point, and the command that moves
  // it -- close-run for a terminal failure, settle-usage when its usage is unknown, recovery retry for a resumable block,
  // none for a run still working. It is still a refusal: nothing is archived and no run is closed.
  it("archive-run-active names each active run with its state, block point and next", async () => {
    const { h, service } = await confirmed();
    try {
      const runId = await claimed(h, service);
      const original = String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body);
      const taskId = String((JSON.parse(original) as { taskId: string }).taskId);
      const as = (fields: Record<string, unknown>, drive: Record<string, unknown>) => {
        const run = JSON.parse(original) as Record<string, unknown>;
        h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, ...fields, drive: { ...(run.drive as object ?? {}), ...drive } }), runId);
        return service.archiveGroup(h.command("archive-group", {})) as { error: { code: string; message: string; activeRuns?: unknown } };
      };
      // mutation (archive-run-active without activeRuns) -> red on each.
      const working = as({}, {});
      expect(working.error).toMatchObject({ code: "archive-run-active", activeRuns: [{ runId, state: "starting", blockedAt: null }] });
      expect(as({ state: "blocked" }, { blockedAt: "C", outcome: "failed" }).error.activeRuns)
        .toEqual([{ runId, state: "blocked", blockedAt: "C", next: `orca group close-run g --run ${runId}` }]);
      expect(as({ state: "blocked", unknown: { work: true, handoff: false } }, { blockedAt: "C", outcome: "exhausted" }).error.activeRuns)
        .toEqual([{ runId, state: "blocked", blockedAt: "C", next: `orca task settle-usage g ${taskId} --acknowledge charge-remaining-grant` }]);
      const resumable = as({ state: "blocked" }, { blockedAt: "B'", outcome: null });
      expect(resumable.error.activeRuns).toEqual([{ runId, state: "blocked", blockedAt: "B'", next: `orca recovery retry --run ${runId}` }]);
      expect(resumable.error.message).toBe(`archive-run-active:${runId} blocked at B' (orca recovery retry --run ${runId})`);
      // Tester follow-up K (#272 rest): a run still active in a settled-* state named nothing; it is read with run show,
      // and its unknown usage, when it has any, is settled first.
      expect(as({ state: "settled-recoverable" }, {}).error.activeRuns).toEqual([{ runId, state: "settled-recoverable", blockedAt: null, next: `orca run show ${runId}` }]);
      expect(as({ state: "settled-unrecoverable", unknown: { work: true, handoff: false } }, {}).error.activeRuns)
        .toEqual([{ runId, state: "settled-unrecoverable", blockedAt: null, next: `orca task settle-usage g ${taskId} --acknowledge charge-remaining-grant` }]);
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("refuses while a handoff stop is still settling: archive-stop-pending (ahead of the run it waits for)", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(groupStopState(h.store, "g")).not.toBe("handoff-complete");
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-stop-pending" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an agent resolves the integration: archive-integration-resolving", async () => {
    const { h, service } = await confirmed();
    try {
      const scheme = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
      writeBody(h, { ...body(h), integration: { ...newGroupIntegration(scheme)!, frozen: true, state: "resolving" } });
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-integration-resolving" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an estimate is in flight: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.db.prepare("UPDATE estimates SET state='running' WHERE group_id='g'").run();
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:estimate" } });
    } finally { await h.dispose(); }
  });

  it("refuses while a requirement call is waiting: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
        writeRound(h.store, "r", newRound(1));
      });
      const command = h.rawCommand("archive-r", revisionOf(h, "r"), "archive-group", { kind: "group", groupId: "r" }, {}) as never;
      expect(service.archiveGroup(command)).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:requirement" } });
      expect(lookupCommandResult(h.store, "r", "archive-r")!.body).toMatchObject({ error: { code: "archive-call-in-flight" } });
    } finally { await h.dispose(); }
  });

  it("blocks by name on an archive mark that does not parse", async () => {
    const { h } = await confirmed();
    try {
      writeBody(h, { ...body(h), archived: "yes" });
      expect(() => isGroupArchived(h.store, "g")).toThrow(ControlError);
      expect(() => isGroupArchived(h.store, "g")).toThrow(/group-archived-invalid/);
    } finally { await h.dispose(); }
  });
});

/** The verbs whose ledger scope is not a group (no group to be archived); everything else targets a group. */
// Ruling: 这次批准改写所有必要的判据 (b37f7ce9): the integration-check setter is removed; the five check verbs are
// repository or @orchestration scoped (checks spec 2026-10-22 §4.4).
const NOT_GROUP = ["shutdown", "set-workspace-mode", "set-integration-scheme", "set-criteria-review", "set-agent-preferences", "apply-agent-update", "set-spend-cap", "clear-spend-cap", "set-usage-calendar", "correction-record", "correction-close", "correction-withdraw", "set-orchestration-settings",
  "set-check-settings", "set-scheduled-check", "set-check-locks", "run-check-now", "resume-check",
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): flow engine spec §11.2's settings verbs target a settings layer, never a group.
  "set-flow-settings", "set-flow-locks",
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): flow engine spec §14.2's run verbs target the `@flows` scope, never a group.
  "flow-start", "flow-message", "flow-plan", "flow-rerun", "flow-answer", "flow-effect", "flow-pool",
  // Ruling: 这次批准改写所有必要的判据 (0e13a9b7): gaps spec §13's plan-step verb targets the `@flows` scope too.
  "flow-plan-step",
  // Scheduled flows and groups spec §5.6, §11.1: the plan library's writes target the library, not a group.
  "plan-library-save", "plan-library-import", "plan-library-archive",
  // Scheduled flows and groups spec §6: the schedule's own verbs target the `@schedule:<id>` scope.
  "schedule-set", "schedule-enable", "schedule-remove", "schedule-resume"];
const LOOP_PAYLOAD = { baseLoopVersion: 0, plan: "standard", inputs: { goal: "g", successCondition: "s", targetPaths: ["a.txt"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null }, work: { tokens: 1, activeMs: 1, attempts: 1 } };
const CONFIRM_PAYLOAD = { planHash: "a".repeat(64), proposalVersion: 1, budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: "b".repeat(64), worker: "b".repeat(64), handoff: "b".repeat(64), goalReview: "b".repeat(64) }, contextPolicy: { handoffAtContextTokens: null }, selectionsHash: "c".repeat(64) };
type Call = (s: WebControlService, command: never) => unknown;
/** Every group-targeted verb but unarchive-group: how it is sent, its target kind and a payload its raw schema accepts. */
const CALLS: Record<string, { call: Call; target: "group" | "task"; payload: unknown }> = {
  "import-plan": { call: (s, c) => s.importPlan(c), target: "group", payload: { groupId: "g", repoId: "repo", planId: "plan" } },
  "proposal-edit": { call: (s, c) => s.editProposal(c), target: "group", payload: { baseProposalVersion: 1, operations: [] } },
  "proposal-set-agent": { call: (s, c) => s.proposalSetAgent(c), target: "group", payload: { baseProposalVersion: 1, scope: { kind: "group", slot: "worker" }, partial: null } },
  estimate: { call: (s, c) => s.createEstimate(c), target: "group", payload: { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" } },
  confirm: { call: (s, c) => s.confirm(c), target: "group", payload: CONFIRM_PAYLOAD },
  start: { call: (s, c) => s.start(c), target: "group", payload: {} },
  "pause-dispatch": { call: (s, c) => s.pauseDispatch(c), target: "group", payload: {} },
  "handoff-stop": { call: (s, c) => s.handoffStop(c), target: "group", payload: {} },
  "resume-dispatch": { call: (s, c) => s.resumeDispatch(c), target: "group", payload: {} },
  "resume-from-handoff": { call: (s, c) => s.resumeFromHandoff(c), target: "group", payload: { selections: [] } },
  "set-limit": { call: (s, c) => s.setLimit(c), target: "group", payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } },
  "continue-task": { call: (s, c) => s.continueTask(c), target: "task", payload: { predecessorRunId: "run-x", checkpointId: "cp-x" } },
  // Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — add-live-note (spec Part 5) is task-targeted too.
  "add-live-note": { call: (s, c) => s.addLiveNote(c), target: "task", payload: { text: "a note" } },
  // Tester follow-up G spec §2.5: a pause decision is task-targeted, so an archived group refuses it too.
  "usage-pause-decide": { call: (s, c) => s.usagePauseDecide(c), target: "task", payload: { decision: "stop" } },
  "recovery-retry": { call: (s, c) => s.recoveryRetry(c), target: "group", payload: { scope: "group", groupId: "g" } },
  "set-group-integration": { call: (s, c) => s.setGroupIntegration(c), target: "group", payload: { integration: { delivery: "keep" } } },
  "retry-integration": { call: (s, c) => s.retryIntegration(c), target: "group", payload: {} },
  "integrate-now": { call: (s, c) => s.integrateNow(c), target: "group", payload: {} },
  "resolve-integration-conflict": { call: (s, c) => s.resolveIntegrationConflict(c), target: "group", payload: {} },
  // Tester follow-up E §5 (#241): the group acceptance's recheck (any) and waiver (a person) are group-targeted too.
  "recheck-acceptance": { call: (s, c) => s.recheckAcceptance(c), target: "group", payload: {} },
  // Tester follow-up G spec §3.5: the requirement review's exits are group-targeted, so an archived group refuses them too.
  "review-accept": { call: (s, c) => s.reviewAccept(c), target: "group", payload: { note: "n" } },
  "review-rerun": { call: (s, c) => s.reviewRerun(c), target: "group", payload: { note: "n" } },
  "review-fix": { call: (s, c) => s.reviewFix(c), target: "group", payload: { goal: "g" } },
  "waive-acceptance": { call: (s, c) => withCommandContext((c as { commandId: string }).commandId, { client: "web", principal: "user:owner" }, () => s.waiveAcceptance(c)), target: "group", payload: { note: "the red test is a known flake" } },
  // Pre-existing failures spec L2 (#341): a person's answer to a problem row is group-targeted, so an archived group refuses it too.
  "answer-preexisting-failure": { call: (s, c) => withCommandContext((c as { commandId: string }).commandId, { client: "web", principal: "user:owner" }, () => s.answerPreexistingFailure(c)), target: "group", payload: { command: "npm test", answer: "relative" } },
  "resolve-folder-change": { call: (s, c) => s.resolveFolderChange(c), target: "group", payload: { action: "recheck" } },
  "multi-dir-landing": { call: (s, c) => s.multiDirLanding(c), target: "group", payload: { action: "retry-rest" } },
  "set-task-labels": { call: (s, c) => s.setTaskLabels(c), target: "task", payload: { labels: null, baseLabelsVersion: 0 } },
  "set-task-loop": { call: (s, c) => s.setTaskLoop(c), target: "task", payload: LOOP_PAYLOAD },
  "requirement-open": { call: (s, c) => s.openRequirement(c), target: "group", payload: { groupId: "g", repoId: "repo", idea: "an idea" } },
  "requirement-answer": { call: (s, c) => s.answerRequirement(c), target: "group", payload: { roundNo: 1, answers: [], glossaryDecisions: [], adrDecisions: [] } },
  "requirement-consensus": { call: (s, c) => s.requirementConsensus(c), target: "group", payload: { roundNo: 1 } },
  "requirement-draft-feedback": { call: (s, c) => s.requirementDraftFeedback(c), target: "group", payload: { draftNo: 1, feedback: "more" } },
  // Ruling (session 3ba26002, human: 「这次批准改写所有必要的判据」): #379 adds requirement-resplit, refused on an archived group like every other group verb.
  "requirement-resplit": { call: (s, c) => s.requirementResplit(c), target: "group", payload: { newGroupId: "g2", feedback: "the split was wrong" } },
  "requirement-draft-accept": { call: (s, c) => s.acceptRequirementDraft(c), target: "group", payload: { draftNo: 1, draftHash: "a".repeat(64) } },
  // Ruling (2026-11-14, tester follow-up K): 「这次批准改写所有必要的判据。」 — the new draft-edit verb is refused on an archived group too.
  "requirement-draft-edit": { call: (s, c) => s.editRequirementDraft(c), target: "group", payload: { draftNo: 1, draftHash: "a".repeat(64), edit: { kind: "apply-parallel-candidates" } } },
  "requirement-clarify-more": { call: (s, c) => s.requirementClarifyMore(c), target: "group", payload: { roundNo: 1 } },
  "requirement-classify": { call: (s, c) => s.requirementClassify(c), target: "group", payload: { scope: "small", clarity: "clear" } },
  "requirement-revise": { call: (s, c) => s.requirementRevise(c), target: "group", payload: { roundNo: 1, answers: [], glossaryDecisions: [], adrDecisions: [] } },
  "requirement-set-agent": { call: (s, c) => s.requirementSetAgent(c), target: "group", payload: { agent: { model: "fixture-model" } } },
  // Ruling: 「这次批准改写所有必要的判据。」 (session 86352010) -- spec 2026-11-06 (d): Orca's own verb, applied in-process.
  "settle-approximate-usage": { call: (s, c) => applySettleApproximateUsage({ store: s.store }, c), target: "group", payload: { taskId: "a", runId: "run-a", generation: 1 } },
  "settle-unknown-usage": { call: (s, c) => withCommandContext((c as { commandId: string }).commandId, { client: "web", principal: "user:owner" }, () => s.settleUnknownUsage(c)), target: "group", payload: { taskId: "a", runId: "run-a", generation: 1, acknowledge: "charge-remaining-grant" } },
  "retry-task": { call: (s, c) => s.retryTask(c), target: "group", payload: { taskId: "a" } },
  "close-run": { call: (s, c) => s.closeRun(c), target: "group", payload: { runId: "run-a" } },
  // Budget defaults spec 2026-11-11 §7 (#227): reviewed acceptance is group-targeted, so an archived group refuses it too.
  // Stuck-runs spec 2026-11-17 S2: abandon-run is group-targeted and person-only; an archived group refuses it too.
  "abandon-run": { call: (s, c) => withCommandContext((c as { commandId: string }).commandId, { client: "web", principal: "user:owner" }, () => s.abandonRun(c)), target: "group", payload: { runId: "run-a", note: "cannot succeed" } },
  "accept-attempt": { call: (s, c) => withCommandContext((c as { commandId: string }).commandId, { client: "web", principal: "user:owner" }, () => s.acceptAttempt(c)), target: "group", payload: { taskId: "a", runId: "run-a", note: "reviewed by hand" } },
  // Tester follow-up G spec §1.4: reopening a no-change task is group-targeted, so an archived group refuses it too.
  "reopen-task": { call: (s, c) => s.reopenTask(c), target: "group", payload: { taskId: "a", runId: "run-a", note: "n" } },
  "accept-no-change": { call: (s, c) => s.acceptNoChange(c), target: "group", payload: { taskId: "a", runId: "run-a", note: "n" } },
  "verify-saved-result": { call: (s, c) => s.verifySavedResult(c), target: "task", payload: { sourceRunId: "run-a", sourceAttempt: 1, capsuleHash: "a".repeat(64) } },
  "archive-group": { call: (s, c) => s.archiveGroup(c), target: "group", payload: {} },
  // Ruling (2026-11-19 #355/#357): 「这次批准改写所有必要的判据」 -- unclose-group undoes only a closed mark, so an archived group refuses it.
  "unclose-group": { call: (s, c) => s.uncloseGroup(c), target: "group", payload: {} },
  "approve-pending-decision": { call: (s, c) => s.approvePendingDecision(c), target: "group", payload: { pendingId: "pending-run-a-0", undoHow: `git revert --no-edit ${"e".repeat(40)}` } },
  "reject-pending-decision": { call: (s, c) => s.rejectPendingDecision(c), target: "group", payload: { pendingId: "pending-run-a-0" } },
  "ratify-flagged-decision": { call: (s, c) => s.ratifyFlaggedDecision(c), target: "group", payload: { decisionId: "run-a/agent-0" } },
  // Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — tester follow-up G §6.3 (#189): the two allowance verbs are group-targeted.
  "allow-request": { call: (s, c) => s.allowRequest(c), target: "group", payload: { request: { kind: "pending-decision", pendingId: "pending-run-a-0" }, scope: "group" } },
  "revoke-allowance": { call: (s, c) => s.revokeAllowance(c), target: "group", payload: { allowanceId: "allow-1" } },
  "add-group-dependency": { call: (s, c) => s.addGroupDependency(c), target: "group", payload: { dependsOn: "other" } },
  "remove-group-dependency": { call: (s, c) => s.removeGroupDependency(c), target: "group", payload: { dependsOn: "other" } },
  "correction-debug-open": { call: (s, c) => s.openCorrectionDebugGroup(c), target: "group", payload: { correctionId: "c_0123456789abcdef" } },
  "system-debug-open": { call: (s, c) => s.openSystemDebugGroup(c), target: "group", payload: { source: { kind: "ladder", groupId: "g", taskId: "a", runId: "run-a" }, stackOn: "g", repoId: "repo", facts: ["failed"], checks: ["true"] } },
  "schedule-from-group": { call: (s, c) => s.scheduleCommand(c), target: "group", payload: { scheduleId: "sch-1", name: "Nightly", cron: "0 3 * * *", enabled: true } },
};

describe("an archived group refuses every group-targeted command but unarchive-group (spec §6.3)", () => {
  it("covers every group-targeted verb the protocol knows, so a new verb cannot slip past", () => {
    // Ruling (2026-11-19 #355/#357): 「这次批准改写所有必要的判据」 -- the gate admits close-group on an archived group (a done
    // one converts to closed, human ruling 「同意允许互转」), so it is exempt beside unarchive-group; archiveGroupClosed.test.ts pins it.
    const expected = commandVerbSchema.options.filter((verb) => !NOT_GROUP.includes(verb) && verb !== "unarchive-group" && verb !== "close-group").sort();
    expect(Object.keys(CALLS).sort()).toEqual(expected);
  });

  it("keeps only verbs in NOT_GROUP whose target is neither a group, task nor run (all three are group-scoped), so a group verb cannot hide there", () => {
    // The walk below is only as good as NOT_GROUP. A verb that accepts a group or task target would be skipped by the
    // walk yet gated by applyWebCommand, so the exemption would be a silent hole: its raw schema must reject both kinds.
    for (const verb of NOT_GROUP) {
      expect(commandVerbSchema.options, verb).toContain(verb);
      for (const target of [{ kind: "group", groupId: "g" }, { kind: "task", groupId: "g", taskId: "a" }, { kind: "run", groupId: "g", runId: "r" }]) {
        const parsed = rawAuthorityCommandSchema.safeParse({ schema: "orca-raw-command-v1", commandId: "c", expectedRevision: 0, actorId: "human", verb, target, payload: {} });
        expect(parsed.success, `${verb} must not take a ${target.kind} target`).toBe(false);
        expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]), `${verb} ${target.kind}`).toContain("target");
      }
    }
  });

  it.each(Object.keys(CALLS))("refuses %s with group-archived, durably, and changes nothing", async (verb) => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const before = JSON.stringify(body(h));
      const entry = CALLS[verb]!;
      const target = entry.target === "task" ? { kind: "task", groupId: "g", taskId: "a" } : { kind: "group", groupId: "g" };
      const command = h.rawCommand(`c-${verb}`, revisionOf(h), verb as never, target as never, entry.payload) as never;
      expect(await entry.call(service, command)).toMatchObject({ error: { code: "group-archived" } });
      expect(lookupCommandResult(h.store, "g", `c-${verb}`)!.body).toMatchObject({ error: { code: "group-archived" } });
      expect(JSON.stringify(body(h))).toBe(before);
    } finally { await h.dispose(); }
  });

  // Ruling (2026-11-18 tester batch D review 2): this group is confirmed to run and never started, so the auto-start pass
  // would start it; the unarchive pauses it (#370 review 2, K1) and a person's resume -- not `start`, which a pause refuses
  // with stop-mode-conflict -- is what lets it run again.
  it("still takes unarchive-group, and after it the group can be let run again (by resume, the unarchive having paused it)", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived", paused: true } });
      expect(await service.resumeDispatch(h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "scheduled", operation: "resume-dispatch" } });
    } finally { await h.dispose(); }
  });
});

// Tester #355: a closed group is frozen as an archived one, by its own code; it takes unclose-group and archive-group (which
// converts it), and close-group again is the gate's refusal too.
describe("a closed group refuses every group-targeted command but unclose-group and archive-group (tester #355)", () => {
  const closedVerbs = [...Object.keys(CALLS).filter((verb) => verb !== "archive-group" && verb !== "unclose-group"), "close-group"];
  const CLOSE: { call: Call; target: "group"; payload: unknown } = { call: (s, c) => s.closeGroup(c), target: "group", payload: {} };
  it.each(closedVerbs)("refuses %s with group-closed, durably, and changes nothing", async (verb) => {
    const { h, service } = await confirmed();
    try {
      writeBody(h, { ...body(h), status: "done" });
      expect(service.closeGroup(h.command("close-group", {}))).toMatchObject({ result: { kind: "closed" } });
      const before = JSON.stringify(body(h));
      const entry = verb === "close-group" ? CLOSE : CALLS[verb]!;
      const target = entry.target === "task" ? { kind: "task", groupId: "g", taskId: "a" } : { kind: "group", groupId: "g" };
      const command = h.rawCommand(`c-${verb}`, revisionOf(h), verb as never, target as never, entry.payload) as never;
      // mutation: terminalGateRefusal answers group-archived for a closed mark too -> red here
      expect(await entry.call(service, command)).toMatchObject({ error: { code: "group-closed" } });
      expect(lookupCommandResult(h.store, "g", `c-${verb}`)!.body).toMatchObject({ error: { code: "group-closed" } });
      expect(JSON.stringify(body(h))).toBe(before);
    } finally { await h.dispose(); }
  });

  it("refuses unarchive-group on a closed group with group-closed, and books it before preparation", async () => {
    const { h, service } = await confirmed();
    try {
      writeBody(h, { ...body(h), status: "done" });
      service.closeGroup(h.command("close-group", {}));
      expect(service.unarchiveGroup(h.rawCommand("c-unarchive", revisionOf(h), "unarchive-group", { kind: "group", groupId: "g" }, {}) as never))
        .toMatchObject({ error: { code: "group-closed" } });
      // mutation: preflight keeps `rawCommand.verb !== "unarchive-group" && isGroupArchived` -> start is booked group-archived, red here
      expect(preflightWebCommand(h.store, h.rawCommand("c-start", revisionOf(h), "start", { kind: "group", groupId: "g" }, {}) as never))
        .toMatchObject({ status: 409, body: { error: { code: "group-closed" } } });
      expect(preflightWebCommand(h.store, h.command("unclose-group", {}) as never)).toBeNull();
      expect(preflightWebCommand(h.store, h.command("archive-group", {}) as never)).toBeNull();
    } finally { await h.dispose(); }
  });
});

describe("no claim and no wake for an archived group (spec §6.3)", () => {
  const pending = (h: H) => h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' AND delivered=0").all().map((row) => String(row.id));
  const activeRuns = (h: H) => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n);

  // Ruling (2026-11-20, #370): the human approved the read-side plus clear-wakes scope -- archiving marks the group's
  // pending start-family wakes delivered (the rows stay for audit), so `recovery list` no longer reports `group-archived`
  // for a group archived from now on, and the unarchive does not resurrect them. This replaces the old criterion that kept
  // the queued start pending through the archive and let the unarchive's pause keep it for a later resume.
  it("clears a pending start wake when the group is archived, keeps the row for audit, and touches no run or workspace state (#370)", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      const queued = pending(h);
      expect(queued).toHaveLength(1);
      const runRows = h.store.db.prepare("SELECT id,body FROM runs WHERE group_id='g' ORDER BY rowid").all();
      const workRows = h.store.db.prepare("SELECT id,body FROM work_items WHERE group_id='g' ORDER BY rowid").all();
      const status = body(h).status;
      service.archiveGroup(h.command("archive-group", {}));
      // mutation: drop the wake-clearing write from applyArchiveGroup -> the row is delivered=0 again, red here
      expect(h.store.db.prepare("SELECT id,delivered FROM scheduler_wakes WHERE id=?").get(queued[0]))
        .toEqual({ id: queued[0], delivered: 1 });
      expect(readControlRecovery(h.store, "e").deferredWakes).toBeUndefined();
      // Nothing else moved: no run was claimed or closed, no work item changed, and the stored status is kept as-is
      // (DB status convergence is out of scope for this round).
      expect(h.store.db.prepare("SELECT id,body FROM runs WHERE group_id='g' ORDER BY rowid").all()).toEqual(runRows);
      expect(h.store.db.prepare("SELECT id,body FROM work_items WHERE group_id='g' ORDER BY rowid").all()).toEqual(workRows);
      expect(body(h).status).toBe(status);
      expect(activeRuns(h)).toBe(0);
      // The unarchive does not resurrect it: the row stays delivered, and nothing is queued to run on its own.
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived" } });
      expect(h.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id=?").get(queued[0])).toEqual({ delivered: 1 });
      expect(readControlRecovery(h.store, "e").deferredWakes).toBeUndefined();
      expect(activeRuns(h)).toBe(0);
    } finally { await h.dispose(); }
  });

  // Ruling (2026-11-20, #370): the human approved the read-side plus clear-wakes scope, which replaces the old criterion
  // that kept the queued start pending through the archive (the unarchive's pause held it for a later resume). The
  // archive now marks it delivered; the unarchive still pauses a group that would run (its earlier start row and a
  // claimable task remain), and a person's resume arms the fresh start.
  it("clears a pending start wake at archive and claims nothing; a person's resume is what starts it", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      const wakes = pending(h);
      expect(wakes).toHaveLength(1);
      service.archiveGroup(h.command("archive-group", {}));
      // mutation: drop the wake-clearing write from applyArchiveGroup -> pending(h) is the queued wake, red here
      expect(pending(h)).toEqual([]);
      expect(await deliverScheduledStart(dispatch(h), "g")).toEqual({ kind: "idle" });
      expect(activeRuns(h)).toBe(0);
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived", paused: true } });
      // The unarchive does not resurrect it (#370, 2026-11-20): nothing is queued, and nothing runs on its own.
      expect(pending(h)).toEqual([]);
      expect(await deliverScheduledStart(dispatch(h), "g")).toEqual({ kind: "idle" });
      await service.resumeDispatch(h.command("resume-dispatch", {}));
      expect((await deliverScheduledStart(dispatch(h), "g")).kind).toBe("claimed");
    } finally { await h.dispose(); }
  });

  // Ruling (2026-11-20, #370 scope plus its review): the historical `continuation` wake kind is part of the start family
  // the read side reports for an archived group, so the archive clears it with the others (the row stays for audit).
  it("clears a legacy continuation wake at archive (#370 review)", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('legacy:continuation','g','continuation','{}',0)").run();
      service.archiveGroup(h.command("archive-group", {}));
      // mutation: drop `continuation` from the cleared kinds -> delivered is 0 and recovery reports it, red here
      expect(h.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id='legacy:continuation'").get()).toEqual({ delivered: 1 });
      expect(readControlRecovery(h.store, "e").deferredWakes).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("offers no claimable task, so the driver arms no new start wake, until it is unarchived", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      h.store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE group_id='g' AND kind='start'").run();
      service.archiveGroup(h.command("archive-group", {}));
      expect(nextClaimableTask(h.store, "g")).toBeNull();
      expect(replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate })).toEqual([]);
      service.unarchiveGroup(h.command("unarchive-group", {}));
      expect(nextClaimableTask(h.store, "g")).toEqual({ workItemId: "a" });
      // Ruling (2026-11-18 tester batch D review): #370 -- the unarchive pauses a started group with a claimable task, so the
      // driver arms nothing until a person's resume, which arms the start itself.
      expect(replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate })).toEqual([]);
      expect(await service.resumeDispatch(h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "scheduled" } });
    } finally { await h.dispose(); }
  });

  it("leaves a queued estimate queued and its wake pending: no estimate run is claimed until it is unarchived", async () => {
    // Spec correction 2026-10-20: an unconfirmed group (a confirmed one's queued estimate is withdrawn, not claimed).
    const h = await webFixture(profileSnapshot()), service = new WebControlService(h.deps);
    try {
      const wakeId = `scheduler-wake:g:estimate:${h.estimateId}`;
      const wake = () => h.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id=?").get(wakeId);
      const estimateState = () => String(h.store.db.prepare("SELECT state FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!.state);
      const estimateRun = () => h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=?").get(h.estimateId);
      service.archiveGroup(h.command("archive-group", {}));
      const handlers = createWebWakeHandlers({ ...h.deps, service });
      expect((await deliverSchedulerWakes(h.store, handlers)).delivered).not.toContain(wakeId);
      expect(wake()).toEqual({ delivered: 0 });
      expect(estimateState()).toBe("queued");
      expect(estimateRun()).toBeUndefined();
      service.unarchiveGroup(h.command("unarchive-group", {}));
      expect((await deliverSchedulerWakes(h.store, handlers)).delivered).toContain(wakeId);
      expect(estimateState()).toBe("running");
      expect(estimateRun()).toBeDefined();
    } finally { await h.dispose(); }
  });
});

describe("the archive gate also sits ahead of command preparation (spec §6.3, E4 review minors 1 and 3)", () => {
  const countProbes = (h: H) => {
    const router = h.deps.profileRouter;
    let calls = 0;
    const probe: typeof router.probe = async (profile, selection) => { calls += 1; return router.probe(profile, selection); };
    return { router: { ...router, probe }, calls: () => calls };
  };
  const startOf = (h: H, id: string) => h.rawCommand(id, revisionOf(h), "start", { kind: "group", groupId: "g" }, {}) as never;

  it("books group-archived for a start before the frozen profiles are probed, and probes nothing", async () => {
    const live = await confirmed();
    try {
      const control = countProbes(live.h);
      await new WebControlService({ ...live.h.deps, profileRouter: control.router }).start(startOf(live.h, "start-control"));
      expect(control.calls(), "the start path probes when the group is not archived").toBeGreaterThan(0);
    } finally { await live.h.dispose(); }
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const counted = countProbes(h);
      expect(await new WebControlService({ ...h.deps, profileRouter: counted.router }).start(startOf(h, "start-archived"))).toMatchObject({ error: { code: "group-archived" } });
      expect(lookupCommandResult(h.store, "g", "start-archived")!.body).toMatchObject({ error: { code: "group-archived" } });
      expect(counted.calls()).toBe(0);
    } finally { await h.dispose(); }
  });

  it("replays a start accepted before the archive through preflight, probing nothing and booking nothing new", async () => {
    // start goes through preflightWebCommand, so this is the case that pins replay ahead of the archive gate there.
    const { h, service } = await confirmed();
    try {
      const command = startOf(h, "start-before");
      const first = await service.start(command);
      expect(first).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
      service.archiveGroup(h.command("archive-group", {}));
      const commandRows = () => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id='g'").get()!.n);
      const rows = commandRows(), seq = lastSeq(h);
      const counted = countProbes(h);
      expect(await new WebControlService({ ...h.deps, profileRouter: counted.router }).start(command)).toEqual(first);
      expect(commandRows()).toBe(rows);
      expect(lastSeq(h)).toBe(seq);
      expect(counted.calls()).toBe(0);
    } finally { await h.dispose(); }
  });

  it("lets unarchive-group and a stale command through preflight: a stale command books revision-conflict, not group-archived", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const unarchive = h.command("unarchive-group", {}) as never;
      expect(preflightWebCommand(h.store, unarchive)).toBeNull();
      const stale = h.rawCommand("stale", revisionOf(h) + 5, "pause-dispatch", { kind: "group", groupId: "g" }, {}) as never;
      expect(preflightWebCommand(h.store, stale)).toMatchObject({ status: 409, body: { error: { code: "revision-conflict" } } });
    } finally { await h.dispose(); }
  });

  it("replays a command accepted before the archive with its stored result, and books nothing new", async () => {
    const { h, service } = await confirmed();
    try {
      const command = h.command("pause-dispatch", {}) as never;
      const first = await service.pauseDispatch(command);
      expect(first).toMatchObject({ result: { kind: "paused" } });
      service.archiveGroup(h.command("archive-group", {}));
      const commandRows = () => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id='g'").get()!.n);
      const rows = commandRows(), seq = lastSeq(h), revision = revisionOf(h);
      expect(await service.pauseDispatch(command)).toEqual(first);
      expect(commandRows()).toBe(rows);
      expect(lastSeq(h)).toBe(seq);
      expect(revisionOf(h)).toBe(revision);
    } finally { await h.dispose(); }
  });
});

describe("an archived group costs no agent probe per pump pass (spec §6.3, E5 review fix round 1)", () => {
  const pendingStart = (h: H) => h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' AND delivered=0").all().map((row) => String(row.id));
  const estimateState = (h: H) => String(h.store.db.prepare("SELECT state FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!.state);
  /** The fixture's router with probe counted; `during` runs inside the first probe (a group archived while it ran). */
  const countingRouter = (h: H, during?: () => void) => {
    const router = h.deps.profileRouter;
    let calls = 0;
    const probe: typeof router.probe = async (profile, selection) => { calls += 1; if (calls === 1) during?.(); return router.probe(profile, selection); };
    return { router: { ...router, probe }, calls: () => calls };
  };

  // Ruling (2026-11-20, #370, read-side plus clear-wakes): the archive clears the queued start, so a delivery after it
  // finds no wake -- nothing is claimed, and the agent is still probed nothing.
  it("archive clears the start wake, so a delivery after it claims nothing and probes the agent nothing", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      service.archiveGroup(h.command("archive-group", {}));
      const counted = countingRouter(h);
      // mutation: drop the wake-clearing write -> the archived wake is found and the delivery is blocked, red here
      expect(await deliverScheduledStart({ ...dispatch(h), profileRouter: counted.router }, "g")).toEqual({ kind: "idle" });
      expect(counted.calls()).toBe(0);
    } finally { await h.dispose(); }
  });

  // Ruling (2026-11-20, #370, read-side plus clear-wakes): the archive lands while the probe is out and clears the wake;
  // the claim still finds nothing to take, so no run is created and the agent is not probed twice.
  it("claims nothing when the group is archived while its start probe ran, and the archive clears the wake", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      expect(pendingStart(h)).toHaveLength(1);
      const counted = countingRouter(h, () => service.archiveGroup(h.command("archive-group", {})));
      // mutation: drop the wake-clearing write -> the claim sees the archived wake and answers group-archived, red here
      expect(await deliverScheduledStart({ ...dispatch(h), profileRouter: counted.router }, "g")).toEqual({ kind: "idle" });
      expect(counted.calls()).toBeGreaterThan(0);
      expect(pendingStart(h)).toEqual([]);
      expect(Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n)).toBe(0);
    } finally { await h.dispose(); }
  });

  it("delivers a queued estimate's wake of an archived group without probing the estimator", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const counted = countingRouter(h);
      const deps = { ...h.deps, profileRouter: counted.router };
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...deps, service: new WebControlService(deps) }));
      expect(counted.calls()).toBe(0);
      expect(estimateState(h)).toBe("queued");
    } finally { await h.dispose(); }
  });

  it("leaves a queued estimate queued when its group is archived while the estimator probe ran", async () => {
    const { h, service } = await confirmed();
    try {
      const counted = countingRouter(h, () => service.archiveGroup(h.command("archive-group", {})));
      expect(await new WebControlService({ ...h.deps, profileRouter: counted.router }).claimEstimate("g", h.estimateId)).toBeNull();
      expect(counted.calls()).toBe(1);
      expect(estimateState(h)).toBe("queued");
      expect(h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=?").get(h.estimateId)).toBeUndefined();
    } finally { await h.dispose(); }
  });
});
