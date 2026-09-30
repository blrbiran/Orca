import { describe, expect, it } from "vitest";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { errorOf, workAllocation, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Final review C1 (2026-10-01): a loop task whose plan its labels chose (a plan file task with labels and no `plan`) is the
 * default kind of loop task. A set-task-loop that keeps its plan and inputs (W7's kept version) is a budget change, not a
 * plan change: it must keep the recipe's `chosenBy`. If it rewrote it to "explicit", the effective plan's bytes would
 * change, so the estimate's one-click suggestion (H6, "Apply all" H16) would be refused `estimate-stale` for every such
 * task, and a budget-only change would mark every ready estimate stale and retitle the task "chosen by hand".
 */
const SUGGESTED = { tokens: 1_500_000, activeMs: 7_000_000, attempts: 2, sessions: 1 };
const labelsLoop = { goal: "write a", successCondition: "a exists", targetPaths: ["a"], checks: ["true"] };
const fixture = () => webFixture(undefined, [{ taskId: "a", loop: labelsLoop, labels: ["bug"] }, { taskId: "c" }]);

async function readyEstimate(h: Fixture, service: WebControlService): Promise<void> {
  const run = await service.claimEstimate("g", h.estimateId);
  const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
  row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
  const task = (taskId: string) => ({ taskId, complexity: "M", confidence: "high", work: SUGGESTED, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean"] });
  service.completeEstimate("g", h.estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
    tasks: [task("a"), task("c")], goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, groupRationale: "small" });
  expect(readEstimateRecord(h.store, "g", h.estimateId).state).toBe("ready");
}
const view = (h: Fixture) => readControlGroup(h.store, "epoch", "g");
const loopPlanOf = (h: Fixture) => view(h).workItems.find((w) => w.taskId === "a")!.loopPlan!;
/** A set-task-loop on task a keeping its plan; `goal` changes its inputs, `provenance` marks tokens as the estimate's. */
function setLoop(h: Fixture, tokens: number, options: { provenance?: boolean; goal?: string } = {}) {
  const current = loopPlanOf(h), work = workAllocation(h, "a").amount;
  return h.taskCommand("set-task-loop", "a", {
    baseLoopVersion: current.loopVersion, plan: current.planId,
    inputs: options.goal === undefined ? current.inputs : { ...current.inputs, goal: options.goal },
    work: { tokens, activeMs: work.activeMs, attempts: work.attempts },
    ...(options.provenance ? { workProvenance: { tokens: { provenance: "model", estimateId: h.estimateId } } } : {}),
  });
}

describe("set-task-loop on a loop task its labels chose (final review C1)", () => {
  it("accepts the estimate's one-click suggestion and the task stays chosen by its label", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service);
      expect(loopPlanOf(h)).toMatchObject({ planId: "bugfix", chosenBy: "labels", chosenByLabel: "bug" });
      const answer = service.setTaskLoop(setLoop(h, SUGGESTED.tokens, { provenance: true }));
      expect(errorOf(answer)).toBeUndefined();
      expect(answer).toMatchObject({ result: { kind: "task-loop-set", taskId: "a", loopVersion: 1 } });
      expect(workAllocation(h, "a").amount.tokens).toBe(SUGGESTED.tokens);
      expect(loopPlanOf(h)).toMatchObject({ planId: "bugfix", chosenBy: "labels", chosenByLabel: "bug", amended: false });
      expect(view(h).estimates[0]!.stale).toBe(false);
    } finally { await h.dispose(); }
  });

  it("a budget-only change leaves ready estimates current and the title chosen by the label, not by hand", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service);
      expect(view(h).estimates[0]!.stale).toBe(false);
      expect(service.setTaskLoop(setLoop(h, workAllocation(h, "a").amount.tokens + 1))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 1 } });
      expect(view(h).estimates[0]!.stale).toBe(false);
      expect(loopPlanOf(h)).toMatchObject({ chosenBy: "labels", chosenByLabel: "bug", amended: false });
    } finally { await h.dispose(); }
  });

  it("a change of inputs is a person's choice: the recipe records it as explicit and the estimate goes stale", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service);
      expect(service.setTaskLoop(setLoop(h, workAllocation(h, "a").amount.tokens, { goal: "write a, changed" })))
        .toMatchObject({ result: { kind: "task-loop-set", loopVersion: 1 } });
      expect(loopPlanOf(h)).toMatchObject({ chosenBy: "explicit", chosenByLabel: null, amended: true });
      expect(view(h).estimates[0]!.stale).toBe(true);
    } finally { await h.dispose(); }
  });
});
