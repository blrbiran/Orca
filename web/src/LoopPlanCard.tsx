/**
 * Loop plans spec §4.1 (D1, D9): a task's loop plan in plain words -- the title, the server's summary lines, the check
 * commands collapsed, the work budget, and the two dimensions the contract cannot express shown as fixed. A hand-written
 * task shows its contract's goal and success condition. Read-only; the edit form is added by plan Task B6.
 */
import type { JSX } from "react";
import type { GroupViewV1, LoopPlanViewV1, WorkItemViewV1 } from "./controlTypes.js";

/** "Bug fix (red first) · v1 · chosen by label `bug` · changed" (spec §4.1, plan ruling R-F5). */
export function loopPlanTitle(plan: LoopPlanViewV1): string {
  const how = plan.chosenBy === "explicit" ? "chosen by hand" : plan.chosenByLabel === null ? "no label, default" : `chosen by label \`${plan.chosenByLabel}\``;
  return `${plan.planName} · v${plan.planVersion} · ${how}${plan.amended ? " · changed" : ""}`;
}

export interface LoopPlanCardProps { view: GroupViewV1; item: WorkItemViewV1 }

export function LoopPlanCard(props: LoopPlanCardProps): JSX.Element | null {
  const { view, item } = props;
  // A view that says nothing about the plan (an older server, a literal fixture) gets no card rather than a wrong one.
  if (item.loopPlan === undefined) return null;
  if (item.loopPlan === null) {
    return (
      <section aria-label={`Plan ${item.taskId}`}>
        <h5>Hand-written contract</h5>
        {item.objective !== undefined && (
          <ul>
            <li>Goal: {item.objective.goal}</li>
            <li>Done when: {item.objective.successCondition}</li>
          </ul>
        )}
      </section>
    );
  }
  const plan = item.loopPlan;
  const work = view.allocations.find((row) => row.ownerKind === "task" && row.ownerId === item.taskId && row.bucket === "work");
  return (
    <section aria-label={`Plan ${item.taskId}`}>
      <h5>{loopPlanTitle(plan)}</h5>
      <ul aria-label={`Plan summary ${item.taskId}`}>
        {plan.summary.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <details>
        <summary>Check commands ({plan.inputs.checks.length})</summary>
        <ul>{plan.inputs.checks.map((check, index) => <li key={index}><code>{check}</code></li>)}</ul>
      </details>
      {work !== undefined && <p>Budget: {work.amount.tokens} tokens · active time {work.amount.activeMs} ms · max attempts {work.amount.attempts}</p>}
      <p>Git workspace: its own worktree, merged back into <code>orca/{view.summary.groupId}</code>; pushing is done by a person</p>
      <p>Skill set: not supported yet</p>
    </section>
  );
}
