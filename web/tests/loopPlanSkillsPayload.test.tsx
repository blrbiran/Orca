// @vitest-environment jsdom
/**
 * Syncskill integration spec §10.4 / §10.8 C14 (plan Task 5). set-task-loop's payload is the task's full desired state:
 * one without `skills` removes the task's skill set. Neither the card's form nor an estimate's suggestion edits skills,
 * so both must send the task's current set back unchanged -- else a budget edit would silently drop it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { suggestedLoopActions } from "../src/BudgetEditor.js";
import type { ControlAction } from "../src/controlApi.js";
import type { Amount, EstimateViewV1, GroupViewV1, LoopPlanViewV1, LoopSkillsV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { TaskDetail } from "../src/TaskDetail.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: 14_400_000, attempts: 3, sessions: 3 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const PLAN: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 1, chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 0,
  inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
  maxFiles: 25, hasDiscipline: true,
};
const item = (plan: LoopPlanViewV1): WorkItemViewV1 => ({
  taskId: "a", status: "ready", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: ["bug"], labelsProvenance: "plan", labelsVersion: 0,
  progress: null, objective: { goal: "fix login", successCondition: "the login test passes" }, loopPlan: plan,
});
const estimate: EstimateViewV1 = {
  estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft",
  requestHash: "c".repeat(64), outputHash: "d".repeat(64), reasonCode: null, stale: false,
  output: {
    schema: "budget-estimate-v1", planHash: "a".repeat(64), goalReviewReserve: amount(0), groupRationale: "small",
    tasks: [{ taskId: "a", complexity: "M", confidence: "high", work: amount(4_000_000), handoff: amount(0), rationale: "small", assumptions: [] }],
  },
};
const view = (plan: LoopPlanViewV1): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(6_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: provenance }],
  workItems: [item(plan)], estimates: [estimate], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

function Stateful(props: { view: GroupViewV1; onCommand: (action: ControlAction) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const onDraft = (key: string, text: string): void => setDrafts((current) => {
    const next = { ...current };
    if (text === "") delete next[key]; else next[key] = text;
    return next;
  });
  return <TaskDetail view={props.view} item={props.view.workItems[0]!} drafts={drafts} onDraft={onDraft} onCommand={props.onCommand} />;
}
/** Edits only the token budget on the card and returns the payload it sent. */
function budgetEdit(plan: LoopPlanViewV1): Record<string, unknown> {
  const onCommand = vi.fn();
  render(<Stateful view={view(plan)} onCommand={onCommand} />);
  fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Token budget" }), { target: { value: "3500000" } });
  fireEvent.click(screen.getByRole("button", { name: "Budget +500000 tokens, taken from the group reserve; 5500000 left" }));
  expect(onCommand).toHaveBeenCalledTimes(1);
  return (onCommand.mock.calls[0]![0] as { payload: Record<string, unknown> }).payload;
}

afterEach(cleanup);

describe("a budget edit keeps the task's skill set (C14)", () => {
  it.each<[string, LoopSkillsV1]>([
    ["a profile", { profile: "web" }],
    ["names", { names: ["alpha", "beta"] }],
  ])("the card's payload carries %s unchanged", (_label, skills) => {
    const payload = budgetEdit({ ...PLAN, skills });
    expect(payload.skills).toEqual(skills);
    expect(payload.work).toEqual({ tokens: 3_500_000, activeMs: 14_400_000, attempts: 3 });
  });

  it("the card's payload has no skills key for a task without skills", () => {
    expect(Object.keys(budgetEdit(PLAN))).not.toContain("skills");
  });

  it("an estimate's suggestion carries the task's skill set unchanged, and none for a task without", () => {
    const skills = { profile: "web" };
    const [withSkills] = suggestedLoopActions(view({ ...PLAN, skills }), { kind: "all" });
    expect(withSkills).toMatchObject({ verb: "set-task-loop", payload: { work: { tokens: 4_000_000 }, skills } });
    const [without] = suggestedLoopActions(view(PLAN), { kind: "all" });
    expect(Object.keys((without as { payload: object }).payload)).not.toContain("skills");
  });
});
