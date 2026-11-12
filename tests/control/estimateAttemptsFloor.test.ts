// Tester follow-up F §4 (#162): an estimate's `attempts: 1` became a finite group's hard stop -- the first exhausted
// attempt ended the task. Applying an estimate (the shared transform behind the panel's "Apply" and `orca group
// apply-estimate`) now sets a task's work attempts to at least 2, and the server re-checks the applied value against the
// same floor. A value an earlier apply wrote (the estimate's own 1) is still accepted at confirmation.
import { describe, expect, it } from "vitest";
import { suggestionActions } from "../../src/control/budgetSuggestions.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { loop, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture, type WebFixtureTask } from "./fixtures/web.js";

const ONE_ATTEMPT = { tokens: 1_500_000, activeMs: 7_000_000, attempts: 1, sessions: 1 };

async function readyEstimate(h: Fixture, service: WebControlService, taskId: string): Promise<void> {
  const run = await service.claimEstimate("g", h.estimateId);
  const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
  row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
  service.completeEstimate("g", h.estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
    tasks: [{ taskId, complexity: "M", confidence: "high", work: ONE_ATTEMPT, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 }, rationale: "r", assumptions: ["clean"] }],
    goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, groupRationale: "r" });
  expect(readEstimateRecord(h.store, "g", h.estimateId).reasonCode ?? "ready").toBe("ready");
}

const workAttempts = (h: Fixture, taskId: string) => readBudgetProposal(h.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!.amount.attempts;
const attemptsOp = (taskId: string, value: number, estimateId: string) => ({ target: { scope: "task", taskId, allocation: "work", dimension: "attempts" }, value, provenance: "model", estimateId });

// Ruling (2026-11-12, tester follow-up H): 「这次批准改写所有必要的判据。」 -- an estimate is applied to a task's work only in a
// group created before the follow-up G release (spec G §12.1: an expectation-model group never applies it there); new
// groups default to the expectation model, so these criteria name the pre-release model (`modelVersion: null`).
describe("an applied estimate sets a task's work attempts to at least 2 (#162)", () => {
  for (const [task, verb] of [[{ taskId: "a", loop: loop("a") } as WebFixtureTask, "set-task-loop"], [{ taskId: "c" } as WebFixtureTask, "proposal-edit"]] as const) {
    it(`${verb}: the estimate's 1 is applied as 2, and the server accepts it`, async () => {
      const h = await webFixture(undefined, [task], { modelVersion: null });
      try {
        const service = new WebControlService(h.deps);
        await readyEstimate(h, service, task.taskId);
        const actions = suggestionActions(readControlGroup(h.store, "epoch", "g"), { kind: "all" });
        for (const action of actions) {
          const answer = action.verb === "proposal-edit" ? service.editProposal(h.command("proposal-edit", action.payload as never))
            : await service.setTaskLoop(h.taskCommand("set-task-loop", action.taskId, action.payload as never));
          expect("error" in answer ? answer.error : "ok", action.verb).toBe("ok");
        }
        expect(actions.some((action) => action.verb === verb)).toBe(true);
        // mutation: drop the floor in suggestedAmount -> 1, red
        expect(workAttempts(h, task.taskId)).toBe(2);
      } finally { await h.dispose(); }
    });
  }

  it("the server refuses the estimate's own 1 as a model value now, and accepts 2", async () => {
    const h = await webFixture(undefined, [{ taskId: "c" }], { modelVersion: null });
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service, "c");
      const edit = (value: number) => service.editProposal(h.command("proposal-edit", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion, operations: [attemptsOp("c", value, h.estimateId)] } as never));
      // mutation: verifyModelField compares to the estimate's own number -> 1 accepted (and 2 refused), red
      expect(edit(1)).toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(edit(2)).not.toHaveProperty("error");
      expect(workAttempts(h, "c")).toBe(2);
    } finally { await h.dispose(); }
  });

  it("confirmation still accepts attempts 1 an apply before this rule wrote", async () => {
    const h = await webFixture(undefined, [{ taskId: "c" }], { modelVersion: null });
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service, "c");
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion, operations: [attemptsOp("c", 2, h.estimateId)] } as never))).not.toHaveProperty("error");
      // What an earlier apply left: the estimate's 1, as the model's value (the freed attempt kept in the task).
      const row = h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!;
      const body = JSON.parse(String(row.body)) as { allocations: Array<{ ownerKind: string; ownerId: string; bucket: string; amount: { attempts: number } }> };
      body.allocations.find((a) => a.ownerKind === "task" && a.ownerId === "c" && a.bucket === "work")!.amount.attempts = 1;
      // The ledger's commitments stay as they are: the freed attempt moves to the task's handoff row.
      body.allocations.find((a) => a.ownerKind === "task" && a.ownerId === "c" && a.bucket === "handoff")!.amount.attempts += 1;
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(canonicalBytes(body).toString("utf8"));
      expect(workAttempts(h, "c")).toBe(1);
      // mutation: confirm's re-check without `appliedBefore` -> proposal-version-conflict, red
      expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode: "strict" }))).toMatchObject({ result: { kind: "confirmed" } });
    } finally { await h.dispose(); }
  });
});
