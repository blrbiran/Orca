/**
 * Gaps spec §5.5, §13: the `flow-plan-step` operation -- the person answers one step of the open, running re-run plan:
 * `run` takes a pending question into the plan, `accept-unchanged` keeps the step's output for its new inputs (rerun.ts
 * `decidePlanStep` decides by code which case applies). Refused by name: `flow-plan-step-not-candidate` (no open plan,
 * or the step is not one this choice can answer) and `flow-plan-stale` (another plan's number, or a plan the person has
 * not run yet -- that one is chosen with `flow-rerun`). Recorded as a `command` message (audit) in the same write.
 * The verb row, its access and socket tiers are the commands task's (gaps plan Task 9).
 */
import { advanceRun, FlowRefusal, loadRun, stepOf, type FlowDeps } from "./kernel.js";
import { decidePlanStep, openPlan, type PlanStepChoice } from "./rerun.js";
import { appendMessage } from "./store.js";

export interface PlanStepInput { flowRunId: string; planNo: number; stepKey: string; choice: PlanStepChoice; by: string; via: string }

export async function planStep(deps: FlowDeps, input: PlanStepInput): Promise<{ result: "flow-plan-step-applied" }> {
  const run = loadRun(deps.store, input.flowRunId);
  stepOf(run, input.stepKey);
  const plan = openPlan(deps.store, input.flowRunId);
  if (plan === null) throw new FlowRefusal("flow-plan-step-not-candidate", `${input.stepKey}: no open plan`);
  if (plan.planNo !== input.planNo || plan.state !== "running") throw new FlowRefusal("flow-plan-stale", `plan ${input.planNo}`);
  const at = deps.now();
  deps.store.transaction(() => {
    decidePlanStep(deps.store, run, plan, input.stepKey, { choice: input.choice, by: input.by, via: input.via, at, source: "person" });
    appendMessage(deps.store, {
      flowRunId: input.flowRunId, requestId: `plan-step:${input.planNo}:${input.stepKey}:${input.choice}`, kind: "command", target: "step",
      body: { command: input.choice === "run" ? "include" : "accept-unchanged", planNo: input.planNo, stepKey: input.stepKey, target: { kind: "step", stepKey: input.stepKey } },
      by: input.by, via: input.via, state: "applied", reason: null, at,
    });
  });
  await advanceRun(deps, input.flowRunId);
  return { result: "flow-plan-step-applied" };
}
