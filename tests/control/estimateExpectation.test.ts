// Budget defaults spec 2026-11-11 §7 "Option A, made precise" (tester #224/#234/#238/#241/#162): in a group whose token
// limit is null an applied estimate is an expectation, not a per-task ceiling. These criteria run the server path an
// estimate takes from "Apply all" to a claim -- the shared transform's commands through the service, confirm's freeze,
// the claim's funded grant and the policy the driver dispatches -- for both group kinds.
import { describe, expect, it } from "vitest";
import { suggestionActions, type SuggestionAction } from "../../src/control/budgetSuggestions.js";
import { readRun } from "../../src/control/budget.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { dispatchedPolicy } from "../../src/control/executionDriver.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { loop, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture, type WebFixtureTask } from "./fixtures/web.js";

const SUGGESTED = { tokens: 1_500_000, activeMs: 7_000_000, attempts: 2, sessions: 1 };
const HANDOFF = { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 };

/** A loop task (set-task-loop owns its work) and a hand-written contract (proposal-edit): one group each, one claim each. */
const LOOP: WebFixtureTask = { taskId: "a", loop: loop("a") };
const HAND: WebFixtureTask = { taskId: "c" };

/** Claims the estimate and completes it with SUGGESTED for the group's one task; answers its id. */
async function readyEstimate(h: Fixture, service: WebControlService, estimateId: string, taskId: string): Promise<string> {
  const run = await service.claimEstimate("g", estimateId);
  const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
  row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
  service.completeEstimate("g", estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
    tasks: [{ taskId, complexity: "M", confidence: "high", work: SUGGESTED, handoff: HANDOFF, rationale: "small", assumptions: ["clean"] }],
    goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, groupRationale: "small" });
  expect(readEstimateRecord(h.store, "g", estimateId).state).toBe("ready");
  return estimateId;
}

/** What the panel's "Apply all" (and `orca group apply-estimate`) sends, sent through the service in order. */
async function applyAll(h: Fixture, service: WebControlService): Promise<SuggestionAction[]> {
  const actions = suggestionActions(readControlGroup(h.store, "epoch", "g"), { kind: "all" });
  for (const action of actions) {
    const answer = action.verb === "proposal-edit"
      ? service.editProposal(h.command("proposal-edit", action.payload as never))
      : await service.setTaskLoop(h.taskCommand("set-task-loop", action.taskId, action.payload as never));
    expect("error" in answer ? answer.error : "ok", action.verb).toBe("ok");
  }
  return actions;
}

/** Confirm, start, claim the one task: the frozen contract policy, the policy the driver dispatches, the run's grant and token policy. */
async function confirmAndClaim(h: Fixture, service: WebControlService, budgetMode: "strict" | "soft") {
  expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode }))).toMatchObject({ result: { kind: "confirmed" } });
  expect(await service.start(h.command("start", {}))).not.toHaveProperty("error");
  const claim = await deliverScheduledStart(h.deps, "g");
  if (claim.kind !== "claimed") throw new Error(`claim: ${JSON.stringify(claim)}`);
  const run = readRun(h.store, claim.runId);
  const derived = readConfirmedTaskExecution(h.store, "g", run.taskId!).contract.executionPolicy;
  return { taskId: run.taskId, derived, dispatched: dispatchedPolicy(h.store, run, derived, run.grant.work), grant: run.grant.work,
    tokenPolicy: (run as { tokenPolicy?: unknown }).tokenPolicy ?? null };
}

describe("a finite group after apply + confirm is unchanged (§7 Q4, criterion 3)", () => {
  // Goldens captured on the base commit 395e5f8d (before any change of this round) with
  //   TMPDIR=/tmp npx vitest run tests/control/estimateExpectation.test.ts
  // against the unchanged src/ (log golden-server-base.log): the canonical JSON that run printed.
  // mutation: apply the null-limit guard to every group -> no task-work suggestion is applied, the frozen
  // tokenBudget/maxAttempts/totalRuntimeBudgetMs are the import's, red
  const GOLDEN_LOOP = '{"derived":{"autonomyLevel":"L2","maxAttempts":2,"partialOutcomeRecoveryWindowMs":1,"perAttemptTimeoutMs":7000000,"tokenBudget":1500000,"totalRuntimeBudgetMs":7000000,"worktreeRequired":true},"dispatched":{"autonomyLevel":"L2","maxAttempts":2,"partialOutcomeRecoveryWindowMs":1,"perAttemptTimeoutMs":7000000,"tokenBudget":1500000,"totalRuntimeBudgetMs":7000000,"worktreeRequired":true},"grant":{"activeMs":7000000,"attempts":2,"sessions":3,"tokens":1500000},"taskId":"a","tokenPolicy":null}';
  const GOLDEN_HAND = '{"derived":{"autonomyLevel":"L2","maxAttempts":2,"partialOutcomeRecoveryWindowMs":1,"perAttemptTimeoutMs":60000,"tokenBudget":1500000,"totalRuntimeBudgetMs":7000000,"worktreeRequired":true},"dispatched":{"autonomyLevel":"L2","maxAttempts":2,"partialOutcomeRecoveryWindowMs":1,"perAttemptTimeoutMs":60000,"tokenBudget":1500000,"totalRuntimeBudgetMs":7000000,"worktreeRequired":true},"grant":{"activeMs":7000000,"attempts":2,"sessions":1,"tokens":1500000},"taskId":"c","tokenPolicy":null}';
  for (const [task, verb, golden] of [[LOOP, "set-task-loop", GOLDEN_LOOP], [HAND, "proposal-edit", GOLDEN_HAND]] as const) {
    it(`${verb} (task ${task.taskId}): the frozen contract policy and the dispatched policy equal the golden`, async () => {
      const h = await webFixture(undefined, [task]);
      try {
        const service = new WebControlService(h.deps);
        await readyEstimate(h, service, h.estimateId, task.taskId);
        const actions = await applyAll(h, service);
        expect(actions.some((action) => action.verb === verb)).toBe(true);
        expect(canonicalBytes(await confirmAndClaim(h, service, "strict")).toString("utf8")).toBe(golden);
      } finally { await h.dispose(); }
    });
  }
});

/** A group with no token limit (the default for a group a person creates today); a hand-written task authors no ceiling. */
const UNLIMITED = { tokenPolicy: "optional-v1" } as const;
const unlimitedFixture = (task: WebFixtureTask) => webFixture(undefined, [task.loop === undefined ? { ...task, tokenBudget: null } : task], UNLIMITED);
const errorOf = (answer: unknown) => (answer as { error?: { code: string } }).error;
const model = (estimateId: string) => ({ provenance: "model" as const, estimateId });
const workTarget = (taskId: string, dimension: "tokens" | "activeMs" | "attempts") => ({ scope: "task" as const, taskId, allocation: "work" as const, dimension });
const setLoop = (h: Fixture, work: { tokens: number | null; activeMs: number; attempts: number }, workProvenance?: Record<string, unknown>) =>
  h.taskCommand("set-task-loop", "a", { baseLoopVersion: 0, plan: "standard",
    inputs: { goal: "write a", successCondition: "a exists", targetPaths: ["a"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
    work, ...(workProvenance === undefined ? {} : { workProvenance }) } as never);
const workAmount = (h: Fixture, taskId: string) => readControlGroup(h.store, "epoch", "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!.amount;

describe("an unlimited group after apply + confirm: no per-task ceiling (§7 items 1, 3; criterion 4)", () => {
  for (const [task, name] of [[LOOP, "a loop task"], [HAND, "a hand-written task"]] as const) {
    it(`${name}: tokenBudget null, the default 3 attempts and active time, and no task binder at the claim`, async () => {
      const h = await unlimitedFixture(task);
      try {
        const service = new WebControlService(h.deps);
        await readyEstimate(h, service, await h.requestEstimate(service), task.taskId);
        const actions = await applyAll(h, service);
        // Handoff and goal-review suggestions are still applied (§7 item 1); the task's work is not.
        expect(actions.map((action) => action.verb)).toEqual(["proposal-edit"]);
        const claimed = await confirmAndClaim(h, service, "soft");
        // mutation: drop the null-limit guard in the transform AND the server -> the estimate's 1,500,000 / 2 / 7,000,000 are frozen, red
        expect(claimed.derived).toMatchObject({ tokenBudget: null, maxAttempts: 3, totalRuntimeBudgetMs: 14_400_000 });
        expect(claimed.dispatched).toMatchObject({ tokenBudget: null, maxAttempts: 3, totalRuntimeBudgetMs: 14_400_000 });
        expect(claimed.grant).toMatchObject({ tokens: null, attempts: 3, activeMs: 14_400_000 });
        // No spend cap and no group limit: the run's token policy names no ceiling and no binder (ccloop never stops mid-call).
        expect(claimed.tokenPolicy).toMatchObject({ authoredTokenCeiling: null, bindingCauses: [] });
      } finally { await h.dispose(); }
    });
  }
});

describe("a claim in an unlimited group: spend caps are the bound (§7 item 6; criterion 5, existing behaviour pinned)", () => {
  it("with no cap the work grant's tokens are null; with a cap the binder is spend-cap and the tokens are the cap's share", async () => {
    for (const cap of [null, 10_000_000] as const) {
      const h = await unlimitedFixture(HAND);
      try {
        const service = new WebControlService(h.deps);
        await readyEstimate(h, service, await h.requestEstimate(service), "c");
        await applyAll(h, service);
        if (cap !== null) h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',?,0,'human')").run(cap);
        const claimed = await confirmAndClaim(h, service, "soft");
        if (cap === null) {
          expect(claimed.grant).toMatchObject({ tokens: null });
          expect(claimed.tokenPolicy).toMatchObject({ bindingCauses: [] });
        } else {
          // One candidate under the cap: its headroom less the task's handoff tokens (the estimate's 1, applied above).
          const used = Number(h.store.db.prepare("SELECT COALESCE(SUM(tokens),0) AS n FROM usage_ledger").get()!.n);
          expect(claimed.grant).toMatchObject({ tokens: cap - used - HANDOFF.tokens });
          expect(claimed.tokenPolicy).toMatchObject({ authoredTokenCeiling: null, bindingCauses: ["spend-cap"] });
          // The frozen contract has no ceiling; the dispatched one carries the cap's share (withinGrant), and the token policy
          // names the binder as spend-cap, for which ccloop parks at a phase boundary instead of stopping mid-call (§2.5-§2.6).
          expect(claimed.derived).toMatchObject({ tokenBudget: null });
          expect(claimed.dispatched).toMatchObject({ tokenBudget: cap - used - HANDOFF.tokens });
        }
      } finally { await h.dispose(); }
    }
  });
});

describe("the server refuses an estimate's task work as a ceiling in an unlimited group (§7 item 3; criterion 8)", () => {
  it("proposal-edit: model tokens, attempts or activeMs on a task's work are refused by name, and nothing is written", async () => {
    const h = await unlimitedFixture(HAND);
    try {
      const service = new WebControlService(h.deps);
      const estimateId = await readyEstimate(h, service, await h.requestEstimate(service), "c");
      const version = readBudgetProposal(h.store, "g").proposalVersion;
      for (const [dimension, value] of [["tokens", SUGGESTED.tokens], ["activeMs", SUGGESTED.activeMs], ["attempts", SUGGESTED.attempts]] as const) {
        const answer = service.editProposal(h.command("proposal-edit", { baseProposalVersion: version, operations: [{ target: workTarget("c", dimension), value, ...model(estimateId) }] } as never));
        // mutation: drop refuseAdvisoryTaskWork from editProposal -> accepted, red
        expect(errorOf(answer), dimension).toMatchObject({ code: "estimate-advisory-in-unlimited-group" });
      }
      expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(version);
      // The same number as the person's own is an ordinary edit (criterion 10 below follows it to the frozen contract).
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: version, operations: [{ target: workTarget("c", "tokens"), value: SUGGESTED.tokens, provenance: "human" }] } as never))).not.toHaveProperty("error");
    } finally { await h.dispose(); }
  });

  it("set-task-loop: workProvenance model on a loop task's work is refused by name, and nothing is written", async () => {
    const h = await unlimitedFixture(LOOP);
    try {
      const service = new WebControlService(h.deps);
      const estimateId = await readyEstimate(h, service, await h.requestEstimate(service), "a");
      const before = workAmount(h, "a");
      for (const dimension of ["tokens", "activeMs", "attempts"] as const) {
        const work = { tokens: before.tokens, activeMs: before.activeMs, attempts: before.attempts, [dimension]: SUGGESTED[dimension] };
        // mutation: drop refuseAdvisoryTaskWork from setTaskLoop -> accepted, red
        expect(errorOf(await service.setTaskLoop(setLoop(h, work, { [dimension]: model(estimateId) }))), dimension).toMatchObject({ code: "estimate-advisory-in-unlimited-group" });
      }
      expect(workAmount(h, "a")).toEqual(before);
    } finally { await h.dispose(); }
  });

  for (const task of [LOOP, HAND]) it(`a finite group accepts the same model values, as before (${task === LOOP ? "set-task-loop" : "proposal-edit"})`, async () => {
    {
      const h = await webFixture(undefined, [task]);
      try {
        const service = new WebControlService(h.deps);
        await readyEstimate(h, service, h.estimateId, task.taskId);
        const answer = task === LOOP
          ? await service.setTaskLoop(setLoop(h, { tokens: SUGGESTED.tokens, activeMs: SUGGESTED.activeMs, attempts: SUGGESTED.attempts }, { tokens: model(h.estimateId), activeMs: model(h.estimateId), attempts: model(h.estimateId) }))
          : service.editProposal(h.command("proposal-edit", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion, operations: [{ target: workTarget("c", "tokens"), value: SUGGESTED.tokens, ...model(h.estimateId) }] } as never));
        // mutation: refuse in every group -> refused, red
        expect(errorOf(answer), task.taskId).toBeUndefined();
        expect(workAmount(h, task.taskId).tokens).toBe(SUGGESTED.tokens);
      } finally { await h.dispose(); }
    }
  });
});

describe("a person's own finite tokens in an unlimited group keep the ceiling (§7 item 3; criterion 10)", () => {
  for (const task of [LOOP, HAND]) it(`human tokens freeze as tokenBudget: N (${task === LOOP ? "set-task-loop" : "proposal-edit"})`, async () => {
    {
      const h = await unlimitedFixture(task);
      try {
        const service = new WebControlService(h.deps);
        const answer = task === LOOP
          ? await service.setTaskLoop(setLoop(h, { tokens: 500_000, activeMs: workAmount(h, "a").activeMs, attempts: workAmount(h, "a").attempts }))
          : service.editProposal(h.command("proposal-edit", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion, operations: [{ target: workTarget("c", "tokens"), value: 500_000, provenance: "human" }] } as never));
        // mutation: refuse human provenance too -> refused, red
        expect(errorOf(answer), task.taskId).toBeUndefined();
        const claimed = await confirmAndClaim(h, service, "soft");
        expect(claimed.derived, task.taskId).toMatchObject({ tokenBudget: 500_000 });
      } finally { await h.dispose(); }
    }
  });
});

describe("no retroactive change (§7 item 8; criterion 11)", () => {
  it("an editable proposal that already carries finite model tokens in an unlimited group confirms unchanged", async () => {
    const h = await unlimitedFixture(HAND);
    try {
      const service = new WebControlService(h.deps);
      const estimateId = await readyEstimate(h, service, await h.requestEstimate(service), "c");
      // The state an apply left before this round: the model's finite tokens on the task, in a group with no token limit.
      // Written as the historical row it is (the service now refuses to write it), as seedHistoricalFiniteBudget writes old rows.
      const proposal = readBudgetProposal(h.store, "g");
      const work = proposal.allocations.find((a) => a.ownerKind === "task" && a.ownerId === "c" && a.bucket === "work")!;
      work.amount.tokens = SUGGESTED.tokens;
      work.fieldProvenance.tokens = model(estimateId);
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(canonicalBytes(proposal).toString());
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='c'").get()!.body));
      body.grant.work.tokens = SUGGESTED.tokens;
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='c'").run(JSON.stringify(body));
      // mutation: re-judge model fields at confirm (refuseAdvisoryTaskWork in confirm's model loop) -> refused, red
      const claimed = await confirmAndClaim(h, service, "soft");
      expect(claimed.derived).toMatchObject({ tokenBudget: SUGGESTED.tokens });
    } finally { await h.dispose(); }
  });
});
