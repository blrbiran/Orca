// @vitest-environment jsdom
/**
 * Loop plans spec §4.1 (D1, D9): the card shows the plan's title, the server's summary lines, the check commands
 * collapsed, the work budget and the two dimensions the contract cannot express as fixed; a hand-written task shows its
 * goal and success condition; the task list names the plan next to the labels. Strings are the panel's English
 * (plan ruling R-F5, rulings.md P1).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { Amount, ControlConfigV1, GroupViewV1, LoopPlanViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: 14_400_000, attempts: 3, sessions: 3 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
// Rewritten under human ruling H18 (2026-10-01) for panel i18n.
const PLAN: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 1, chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 0,
  inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
  maxFiles: 25, hasDiscipline: true,
};
const item = (over: Partial<WorkItemViewV1> = {}): WorkItemViewV1 => ({
  taskId: "a", status: "ready", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: ["bug"], labelsProvenance: "plan", labelsVersion: 0,
  progress: null, objective: { goal: "fix login", successCondition: "the login test passes" }, loopPlan: PLAN, ...over,
});
const view = (items: WorkItemViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(6_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: provenance }],
  workItems: items, estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const detail = (items: WorkItemViewV1[]) => render(<TaskDetail view={view(items)} item={items[0]!} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);

afterEach(cleanup);

describe("the loop plan card (spec §4.1)", () => {
  it("titles the card with the plan, its version and how it was chosen, and lists the server's lines", () => {
    detail([item()]);
    expect(screen.getByRole("heading", { name: "Bug fix (red first) · v1 · chosen by label `bug`" })).toBeTruthy();
    // Rewritten under human ruling H18 (2026-10-01) for panel i18n: the lines are built by the panel; the text is unchanged.
    expect(within(screen.getByRole("list", { name: "Plan summary a" })).getAllByRole("listitem").map((line) => line.textContent))
      .toEqual(["Goal: fix login", "Done when: the login test passes", "Only changes: src/auth/**", "At most 25 files changed (reported by the agent)", "Acceptance: 1 check command, all must pass", "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]);
  });

  it("keeps the check commands collapsed", () => {
    detail([item()]);
    const details = screen.getByText("npm test -- --run auth").closest("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector("summary")?.textContent).toBe("Check commands (1)");
  });

  it("shows the work budget and the two dimensions the contract cannot express (D1)", () => {
    const text = detail([item()]).container.textContent ?? "";
    expect(text).toContain("Budget: 3000000 tokens · active time 14400000 ms · max attempts 3");
    expect(text).toContain("Git workspace: its own worktree, merged back into orca/g; pushing is done by a person");
    expect(text).toContain("Skill set: none");
  });

  it("says chosen by hand and changed when they hold", () => {
    detail([item({ loopPlan: { ...PLAN, chosenBy: "explicit", chosenByLabel: null, amended: true } })]);
    expect(screen.getByRole("heading", { name: "Bug fix (red first) · v1 · chosen by hand · changed" })).toBeTruthy();
  });

  it("says a plan chosen with no label came from the default", () => {
    detail([item({ labels: [], loopPlan: { ...PLAN, planId: "standard", chosenByLabel: null } })]);
    expect(screen.getByRole("heading", { name: "Standard · v1 · no label, default" })).toBeTruthy();
  });

  it("shows a hand-written task's goal and success condition", () => {
    const text = detail([item({ loopPlan: null, objective: { goal: "ship", successCondition: "passes" } })]).container.textContent ?? "";
    expect(screen.getByRole("heading", { name: "Hand-written contract" })).toBeTruthy();
    expect(text).toContain("Goal: ship");
    expect(text).toContain("Done when: passes");
  });

  it("leaves out the budget line with no work row, and the goal lines with no objective", () => {
    const noWork = view([item()]);
    const { container } = render(<TaskDetail view={{ ...noWork, allocations: [] }} item={item()} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(container.textContent).not.toContain("Budget:");
    expect(container.textContent).toContain("Skill set: none");
    cleanup();
    const { objective: _none, ...bare } = item({ loopPlan: null });
    const text = detail([bare]).container.textContent ?? "";
    expect(screen.getByRole("heading", { name: "Hand-written contract" })).toBeTruthy();
    expect(text).not.toContain("Goal:");
  });

  it("shows no card when the view says nothing about the plan", () => {
    const { loopPlan: _unused, ...silent } = item();
    detail([silent]);
    expect(screen.queryByRole("region", { name: "Plan a" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Hand-written contract" })).toBeNull();
  });

  it("puts the plan's name next to the labels in the task list", () => {
    render(<ControlGroupView view={view([item()])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(document.querySelector("td span.plan-chip")?.textContent?.trim()).toBe("Bug fix (red first)");
  });

  it("puts no plan chip next to a hand-written task", () => {
    render(<ControlGroupView view={view([item({ loopPlan: null })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "a" })).toBeTruthy();
    expect(document.querySelector("span.plan-chip")).toBeNull();
  });
});
