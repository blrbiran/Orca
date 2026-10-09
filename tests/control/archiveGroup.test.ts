import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupArchived } from "../../src/control/archivedMark.js";
import { lookupCommandResult, updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { insertClarifyingGroup, newRound, writeRound } from "../../src/control/requirementRecords.js";
import { groupStopState, settleHandoffRequest } from "../../src/control/stopIntent.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { createWebWakeHandlers, deliverScheduledStart, nextClaimableTask } from "../../src/control/webDispatch.js";
import { commandVerbSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
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
const NOT_GROUP = ["shutdown", "set-workspace-mode", "set-integration-scheme", "set-agent-preferences", "set-spend-cap", "clear-spend-cap", "set-usage-calendar"];
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
  "recovery-retry": { call: (s, c) => s.recoveryRetry(c), target: "group", payload: { scope: "group", groupId: "g" } },
  "set-group-integration": { call: (s, c) => s.setGroupIntegration(c), target: "group", payload: { integration: { delivery: "keep" } } },
  "retry-integration": { call: (s, c) => s.retryIntegration(c), target: "group", payload: {} },
  "resolve-integration-conflict": { call: (s, c) => s.resolveIntegrationConflict(c), target: "group", payload: {} },
  "set-task-labels": { call: (s, c) => s.setTaskLabels(c), target: "task", payload: { labels: null, baseLabelsVersion: 0 } },
  "set-task-loop": { call: (s, c) => s.setTaskLoop(c), target: "task", payload: LOOP_PAYLOAD },
  "requirement-open": { call: (s, c) => s.openRequirement(c), target: "group", payload: { groupId: "g", repoId: "repo", idea: "an idea" } },
  "requirement-answer": { call: (s, c) => s.answerRequirement(c), target: "group", payload: { roundNo: 1, answers: [], glossaryDecisions: [], adrDecisions: [] } },
  "requirement-consensus": { call: (s, c) => s.requirementConsensus(c), target: "group", payload: { roundNo: 1 } },
  "requirement-draft-feedback": { call: (s, c) => s.requirementDraftFeedback(c), target: "group", payload: { draftNo: 1, feedback: "more" } },
  "requirement-draft-accept": { call: (s, c) => s.acceptRequirementDraft(c), target: "group", payload: { draftNo: 1, draftHash: "a".repeat(64) } },
  "retry-task": { call: (s, c) => s.retryTask(c), target: "group", payload: { taskId: "a" } },
  "archive-group": { call: (s, c) => s.archiveGroup(c), target: "group", payload: {} },
};

describe("an archived group refuses every group-targeted command but unarchive-group (spec §6.3)", () => {
  it("covers every group-targeted verb the protocol knows, so a new verb cannot slip past", () => {
    const expected = commandVerbSchema.options.filter((verb) => !NOT_GROUP.includes(verb) && verb !== "unarchive-group").sort();
    expect(Object.keys(CALLS).sort()).toEqual(expected);
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

  it("still takes unarchive-group, and after it start is accepted again", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived" } });
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
    } finally { await h.dispose(); }
  });
});

describe("no claim and no wake for an archived group (spec §6.3)", () => {
  const pending = (h: H) => h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' AND delivered=0").all().map((row) => String(row.id));
  const activeRuns = (h: H) => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n);

  it("leaves a pending start wake pending and claims nothing", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      const wakes = pending(h);
      expect(wakes).toHaveLength(1);
      service.archiveGroup(h.command("archive-group", {}));
      expect(await deliverScheduledStart(dispatch(h), "g")).toEqual({ kind: "blocked", reason: "group-archived" });
      expect(pending(h)).toEqual(wakes);
      expect(activeRuns(h)).toBe(0);
      service.unarchiveGroup(h.command("unarchive-group", {}));
      expect((await deliverScheduledStart(dispatch(h), "g")).kind).toBe("claimed");
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
      expect(replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate })).toEqual(["drive:g:1"]);
    } finally { await h.dispose(); }
  });

  it("leaves a queued estimate queued and its wake pending: no estimate run is claimed until it is unarchived", async () => {
    const { h, service } = await confirmed();
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
