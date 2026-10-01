import { describe, expect, it } from "vitest";
import { lookupCommandResult, updateRevision } from "../../src/control/commandLedger.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { insertClarifyingGroup, newDraft, newRound, writeDraft, writeRound } from "../../src/control/requirementRecords.js";
import { recordUsage } from "../../src/control/usage.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { applyPanelShutdown } from "../../src/panel/controlLifecycle.js";
import { readControlGroup, readControlSummary, readSelectionPreview } from "../../src/panel/controlViews.js";
import { clarifyingInput } from "./fixtures/requirement.js";
import { webFixture } from "./fixtures/web.js";

// N1 spec §4.1: "every code path that reads a plan, a proposal or work items refuses or skips a clarifying group
// explicitly (requirement-not-split), each with a criterion". The table is the plan's Task 0 survey (S1-S28).
const body = (h: Awaited<ReturnType<typeof webFixture>>) => String(h.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body);
const revision = (h: Awaited<ReturnType<typeof webFixture>>) => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='r'").get()!.revision);
const raw = (h: Awaited<ReturnType<typeof webFixture>>, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "r" }, commandId = `c-${verb}`) =>
  ({ schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: revision(h), verb, target, payload }) as never;

async function fixture() {
  const h = await webFixture();
  // Controller ruling PR-B1: a clarifying group inserted directly carries what requirement-open leaves behind -- the
  // command's revision bump (applyWebCommand -> updateRevision, 0 -> 1) and its one projection change (projection_seq 0 -> 1).
  h.store.transaction(() => {
    insertClarifyingGroup(h.store, clarifyingInput("r"));
    updateRevision(h.store, "r", 1);
    h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
  });
  const service = new WebControlService({ ...h.deps, knownRepository: (id: string) => id === "repo" });
  return { h, service };
}

describe("a clarifying group under every command that needs a plan (N1 spec §4.1, DR16)", () => {
  it.each([
    ["proposal-edit", (s: WebControlService, c: never) => s.editProposal(c), { baseProposalVersion: 1, operations: [] }, undefined],
    ["proposal-set-agent", (s: WebControlService, c: never) => s.proposalSetAgent(c), { baseProposalVersion: 1, scope: { kind: "group", slot: "worker" }, partial: null }, undefined],
    ["estimate", (s: WebControlService, c: never) => s.createEstimate(c), { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, undefined],
    ["confirm", (s: WebControlService, c: never) => s.confirm(c), { planHash: "a".repeat(64), proposalVersion: 1, budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: "b".repeat(64), worker: "b".repeat(64), handoff: "b".repeat(64), goalReview: "b".repeat(64) }, contextPolicy: { handoffAtContextTokens: null }, selectionsHash: "c".repeat(64) }, undefined],
    ["start", (s: WebControlService, c: never) => s.start(c), {}, undefined],
    ["pause-dispatch", (s: WebControlService, c: never) => s.pauseDispatch(c), {}, undefined],
    ["resume-dispatch", (s: WebControlService, c: never) => s.resumeDispatch(c), {}, undefined],
    ["resume-from-handoff", (s: WebControlService, c: never) => s.resumeFromHandoff(c), { selections: [] }, undefined],
    ["continue-task", (s: WebControlService, c: never) => s.continueTask(c), { predecessorRunId: "run-x", checkpointId: "cp-x" }, { kind: "task", groupId: "r", taskId: "a" }],
    ["set-task-labels", (s: WebControlService, c: never) => s.setTaskLabels(c), { labels: null, baseLabelsVersion: 0 }, { kind: "task", groupId: "r", taskId: "a" }],
    ["set-task-loop", (s: WebControlService, c: never) => s.setTaskLoop(c), { baseLoopVersion: 0, plan: "standard", inputs: { goal: "g", successCondition: "s", targetPaths: ["a.txt"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null }, work: { tokens: 1, activeMs: 1, attempts: 1 } }, { kind: "task", groupId: "r", taskId: "a" }],
  ] as const)("refuses %s by name, durably, and changes nothing", async (verb, call, payload, target) => {
    const { h, service } = await fixture();
    try {
      const before = body(h);
      const answer = await call(service, raw(h, verb, payload, target));
      expect(answer).toMatchObject({ error: { code: "requirement-not-split" } });
      expect(lookupCommandResult(h.store, "r", `c-${verb}`)!.body).toMatchObject({ error: { code: "requirement-not-split" } });
      expect(body(h)).toBe(before);
    } finally { await h.dispose(); }
  });

  it("refuses import-plan onto an existing group id as group-already-exists, never a raw SQLite error", async () => {
    const { h, service } = await fixture();
    try {
      // The group's own revision, so the import reaches its apply step (a stale one is revision-conflict before it).
      const answer = await service.importPlan({ schema: "orca-raw-command-v1", commandId: "import-r", actorId: "human", expectedRevision: revision(h), verb: "import-plan", target: { kind: "group", groupId: "r" }, payload: { groupId: "r", repoId: "repo", planId: "plan" } } as never);
      expect(answer).toMatchObject({ error: { code: "group-already-exists" } });
    } finally { await h.dispose(); }
  });

  it("refuses the group view and the agent preview, and lists the group in the summary beside an imported one", async () => {
    const { h } = await fixture();
    try {
      expect(() => readControlGroup(h.store, "epoch", "r")).toThrow("requirement-not-split");
      await expect(readSelectionPreview(h.store, h.deps.port, "human", "r")).rejects.toThrow("requirement-not-split");
      const summary = readControlSummary(h.store, "epoch", null, true);
      expect(summary.groups.map((group) => [group.groupId, group.state])).toEqual([["g", "draft"], ["r", "clarifying"]]);
      expect(summary.groups[1]).toMatchObject({ requirement: { roundNo: null, roundState: null, openQuestions: 0, draftNo: null, waiting: null, exportState: "not-due", used: { tokens: 0 }, limit: { tokens: 10_000_000 } } });
      expect(summary.groups[1]).not.toHaveProperty("completion");
    } finally { await h.dispose(); }
  });
});

describe("what a clarifying group does allow (N1 spec §11.1)", () => {
  it("set-limit edits the reduced ledger and keeps the Web mirror consistent; below what is spent it refuses", async () => {
    const { h, service } = await fixture();
    try {
      const raised = service.setLimit(raw(h, "set-limit", { limit: { tokens: 12_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40 } }));
      expect(raised).toMatchObject({ result: { kind: "limit-set" } });
      expect(readWebGroup(h.store, "r")).toMatchObject({ limit: { tokens: 12_000_000 }, ledger: { groupLimit: { tokens: 12_000_000 }, explicitUnallocatedReserve: { tokens: 12_000_000 } } });
      const group = JSON.parse(body(h));
      group.used.tokens = 5; group.ledger.used.tokens = 5;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(group));
      const lowered = service.setLimit(raw(h, "set-limit", { limit: { tokens: 4, activeMs: 14_400_000, attempts: 40, sessions: 40 } }, undefined, "c-lower"));
      expect(lowered).toMatchObject({ error: { code: "group-budget-unavailable" } });
    } finally { await h.dispose(); }
  });

  it("a call waiting on the budget shows in the summary, and a raise re-queues it (spec §5.2, §11.2)", async () => {
    const { h, service } = await fixture();
    try {
      h.store.transaction(() => { writeRound(h.store, "r", { ...newRound(1), waiting: "requirement-budget-exhausted" }); writeDraft(h.store, "r", newDraft(1, 0)); });
      const line = readControlSummary(h.store, "epoch", null, true).groups.find((group) => group.groupId === "r")!.requirement;
      expect(line).toMatchObject({ roundNo: 1, roundState: "drafting", draftNo: 1, draftState: "drafting", waiting: "requirement-budget-exhausted", reasonCode: null });
      const wakes = () => h.store.db.prepare("SELECT kind FROM scheduler_wakes WHERE group_id='r'").all().map((row) => String(row.kind));
      expect(wakes()).toEqual([]);
      expect(service.setLimit(raw(h, "set-limit", { limit: { tokens: 12_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40 } }))).toMatchObject({ result: { kind: "limit-set" } });
      expect(wakes()).toEqual(["requirement-call"]);
    } finally { await h.dispose(); }
  });

  it("handoff-stop on an idle clarifying group completes at once", async () => {
    const { h, service } = await fixture();
    try {
      const stopped = await service.handoffStop(raw(h, "handoff-stop", {}));
      expect(stopped).toMatchObject({ result: { kind: "handoff-stopped", frozenRunIds: [] } });
      expect(String(h.store.db.prepare("SELECT body FROM stop_intents WHERE group_id='r'").get()!.body)).toContain("handoff-complete");
    } finally { await h.dispose(); }
  });

  it("books a requirement call's usage into the clarifying ledger with the mirror in sync, and a breach stops nothing (DR18)", async () => {
    const { h } = await fixture();
    try {
      const grant = { work: { tokens: 1_000_000, activeMs: 1_200_000, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } };
      const run = { runId: "run-r", groupId: "r", workItemId: "round-1", taskId: null, estimateId: null, phase: "single-call", purpose: "clarify", generation: 1, state: "accepted",
        grant, remaining: structuredClone(grant), cumulative: { work: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
        unknown: { work: false, handoff: false }, highWater: 0, breaches: [] };
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-r','r','round-1',1,1,?)").run(JSON.stringify(run));
      const group = JSON.parse(body(h)); group.reserved = grant.work; group.ledger.committedRemaining = grant.work;
      group.ledger.explicitUnallocatedReserve = { tokens: 9_000_000, activeMs: 13_200_000, attempts: 39, sessions: 39 };
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(group));
      const source = { artifactId: "usage-r", hash: "e".repeat(64) };
      recordUsage(h.store, { runId: "run-r", generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1_000_500, activeMs: 10, attempts: 1, sessions: 1 }, source });
      const after = readWebGroup(h.store, "r");
      expect(after.used.tokens).toBe(1_000_500);
      expect(after.ledger.used).toEqual(after.used);
      expect(after.reserved.tokens).toBe(0);
      expect(after).toMatchObject({ status: "clarifying", stopped: false });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id='run-r'").get()!.body)).breaches).toEqual([1]);
    } finally { await h.dispose(); }
  });

  it("shutdown leaves an idle clarifying group unstopped (driver-owned, DR17), and replenishment arms nothing for it", async () => {
    const { h } = await fixture();
    try {
      const shut = await applyPanelShutdown({ store: h.store, profileRouter: h.deps.profileRouter, epoch: "epoch-1", shutdownGraceMs: 1_000, exemptDriverRuns: true });
      expect(shut.result).toMatchObject({ kind: "shutdown" });
      const entry = (shut.result as { groups: Array<{ groupId: string; disposition: string }> }).groups.find((g) => g.groupId === "r");
      expect(entry!.disposition).toBe("skipped-driver-owned");
      expect(readWebGroup(h.store, "r").stopped).toBe(false);
      expect(replenishStartWakes({ store: h.store })).toEqual([]);
    } finally { await h.dispose(); }
  });
});

// Final review fix wave (session b5e8d368, 2026-10-02), finding 7: one money rule, one answer -- unknown usage cannot
// authorise a lower limit on a clarifying group, as it cannot on a plan group (webService.ts setLimit).
describe("set-limit on a clarifying group whose usage is unknown (final review finding 7)", () => {
  it("refuses a decrease by name and changes nothing, and still takes a raise", async () => {
    const { h, service } = await fixture();
    try {
      const group = JSON.parse(body(h)); group.ledger.usageUnknown = true;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(group));
      const before = body(h);
      // Far above anything spent or in flight: only the unknown usage stands in the way.
      const lowered = service.setLimit(raw(h, "set-limit", { limit: { tokens: 9_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40 } }, undefined, "c-lower"));
      expect(lowered).toMatchObject({ error: { code: "recovery-blocked" } });
      expect(body(h)).toBe(before);
      const raised = service.setLimit(raw(h, "set-limit", { limit: { tokens: 12_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40 } }, undefined, "c-raise"));
      expect(raised).toMatchObject({ result: { kind: "limit-set" } });
      expect(readWebGroup(h.store, "r")).toMatchObject({ limit: { tokens: 12_000_000 }, ledger: { usageUnknown: true } });
    } finally { await h.dispose(); }
  });
});
