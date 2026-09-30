// @vitest-environment jsdom
/**
 * Loop plans spec §4.2 (D4, D5): until a loop task starts, its card changes the plan, the inputs and the work budget as a
 * draft that sends the loopVersion it started from; the submit states its consequence for the group's reserve and is
 * disabled, naming the shortfall, when the reserve cannot cover a raise. Strings are the panel's English (plan ruling
 * R-F5, rulings.md P1).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCommandPath, type ControlAction } from "../src/controlApi.js";
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
  summary: { groupId: "g", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(6_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: provenance }],
  workItems: items, estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

/** TaskDetail over the page's own draft store, so a criterion sees drafts the way App keeps them. */
function Stateful(props: { view: GroupViewV1; onCommand: (action: ControlAction) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const onDraft = (key: string, text: string): void => setDrafts((current) => {
    const next = { ...current };
    if (text === "") delete next[key]; else next[key] = text;
    return next;
  });
  return <TaskDetail view={props.view} item={props.view.workItems[0]!} drafts={drafts} onDraft={onDraft} onCommand={props.onCommand} />;
}

afterEach(cleanup);

describe("changing a loop task's plan on its card (spec §4.2)", () => {
  it("sends the plan, the inputs and the work budget with the loopVersion the draft started from", () => {
    const onCommand = vi.fn();
    const { rerender } = render(<Stateful view={view([item()])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), { target: { value: "fix login, changed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Token budget" }), { target: { value: "3500000" } });
    // Someone else changed the plan meanwhile: the draft keeps the version it started from, and says so.
    rerender(<Stateful view={view([item({ loopPlan: { ...PLAN, loopVersion: 1 } })])} onCommand={onCommand} />);
    expect(screen.getByRole("status").textContent).toContain("v0 → v1");
    fireEvent.click(screen.getByRole("button", { name: "Budget +500000 tokens, taken from the group reserve; 5500000 left" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "set-task-loop", groupId: "g", taskId: "a", expectedRevision: 6, payload: {
      baseLoopVersion: 0, plan: "bugfix", inputs: { ...PLAN.inputs, goal: "fix login, changed" }, work: { tokens: 3_500_000, activeMs: 14_400_000, attempts: 3 },
    } });
  });

  it("disables the submit and names the shortfall when the reserve cannot cover a raise", () => {
    const onCommand = vi.fn();
    render(<Stateful view={view([item()])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Token budget" }), { target: { value: String(3_000_000 + 6_000_000 + 1) } });
    expect(screen.getByRole("alert").textContent).toBe("Group reserve too small: tokens short by 1");
    const submit = screen.getByRole("button", { name: /^Budget / }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("names what blocks a send: a budget or a file cap that is not a positive integer (rulings P9)", () => {
    const onCommand = vi.fn();
    render(<Stateful view={view([item()])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Max attempts" }), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toBe("Budgets must be positive integers");
    fireEvent.change(screen.getByRole("textbox", { name: "Max attempts" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Max files changed (blank for default)" }), { target: { value: "2.5" } });
    expect(screen.getByRole("alert").textContent).toBe("Max files changed must be a positive integer");
    const submit = screen.getByRole("button", { name: "Max files changed must be a positive integer" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("names only the first dimension the reserve cannot cover", () => {
    render(<Stateful view={view([item()])} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Token budget" }), { target: { value: String(3_000_000 + 6_000_000 + 1) } });
    fireEvent.change(screen.getByRole("textbox", { name: "Active time (ms)" }), { target: { value: String(14_400_000 + 14_400_000 + 2) } });
    expect(screen.getByRole("alert").textContent).toBe("Group reserve too small: tokens short by 1");
  });

  it("sends the goal and the done-when trimmed, and one entry per non-blank line, trimmed", () => {
    const onCommand = vi.fn();
    render(<Stateful view={view([item()])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), { target: { value: "  fix login  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Done when" }), { target: { value: " the login test passes " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Only changes (one path per line)" }), { target: { value: " src/auth/** \n\n  \n src/login/** " } });
    fireEvent.click(screen.getByRole("button", { name: "Budget unchanged" }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({
      inputs: { ...PLAN.inputs, goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "src/login/**"] },
    }) }));
  });

  it("says a lowered budget goes back to the reserve, an unchanged one is unchanged, and Discard plan draft drops the draft", () => {
    const onCommand = vi.fn();
    render(<Stateful view={view([item()])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    expect(screen.getByRole("button", { name: "Budget unchanged" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Max attempts" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Budget -1 attempts, returned to the group reserve; 4 left" }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ work: { tokens: 3_000_000, activeMs: 14_400_000, attempts: 2 } }) }));
    // The label editor keeps its own "Discard draft"; the plan form's has a name of its own (final review, B6).
    expect(screen.getAllByRole("button", { name: "Discard draft" })).toHaveLength(1);
    expect(within(screen.getByRole("form", { name: "Change plan a" })).queryByRole("button", { name: "Discard draft" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard plan draft" }));
    expect(screen.queryByRole("textbox", { name: "Goal" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
  });

  it("freezes a task that has started, and offers no edit for a hand-written task", () => {
    render(<Stateful view={view([item({ status: "active", currentRunId: "run-a", lineageRunIds: ["run-a"] })])} onCommand={vi.fn()} />);
    expect(screen.getByText("Started; the plan is frozen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
    cleanup();
    render(<Stateful view={view([item({ loopPlan: null, objective: { goal: "ship", successCondition: "passes" } })])} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
  });

  it("offers no change while the group is past ready or stopped, where the server always refuses (group-state-invalid)", () => {
    const at = (summary: Partial<GroupViewV1["summary"]>): GroupViewV1 => { const base = view([item()]); return { ...base, summary: { ...base.summary, ...summary } }; };
    for (const shown of [at({ state: "running" }), at({ state: "review" }), at({ stopMode: "pause", stopState: "paused" })]) {
      render(<Stateful view={shown} onCommand={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
      expect(screen.getByText("The group is not open for changes; the plan is frozen")).toBeTruthy();
      cleanup();
    }
    render(<Stateful view={at({ state: "draft" })} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
  });

  it("counts a task as started by its status alone, or by a run in its lineage alone (spec §5.2 step 2)", () => {
    render(<Stateful view={view([item({ status: "active" })])} onCommand={vi.fn()} />);
    expect(screen.getByText("Started; the plan is frozen")).toBeTruthy();
    cleanup();
    render(<Stateful view={view([item({ lineageRunIds: ["run-a"] })])} onCommand={vi.fn()} />);
    expect(screen.getByText("Started; the plan is frozen")).toBeTruthy();
  });

  it("reads a stored draft it cannot trust as no draft, and offers a fresh one", () => {
    const good = { base: 0, plan: "bugfix", text: { goal: "g", successCondition: "s", targetPaths: "src/a", checks: "c", nonGoals: "", relevantDocs: "", protectedPaths: "", maxFilesTouched: "", tokens: "1", activeMs: "1", attempts: "1" } };
    const { text: { goal: _goal, ...missingGoal } } = good;
    for (const stored of ["not json", JSON.stringify({ ...good, base: "0" }), JSON.stringify({ ...good, plan: "nope" }), JSON.stringify({ ...good, text: missingGoal }), JSON.stringify({ ...good, text: null })]) {
      render(<TaskDetail view={view([item()])} item={item()} drafts={{ "loop:g:a": stored }} onDraft={vi.fn()} onCommand={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
      cleanup();
    }
    render(<TaskDetail view={view([item()])} item={item()} drafts={{ "loop:g:a": JSON.stringify(good) }} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: "Goal" }) as HTMLInputElement).value).toBe("g");
  });

  it("sends set-task-loop to the task's loop route", () => {
    expect(controlCommandPath({ verb: "set-task-loop", groupId: "g", taskId: "a", expectedRevision: 1,
      payload: { baseLoopVersion: 0, plan: "bugfix", inputs: PLAN.inputs, work: { tokens: 1, activeMs: 1, attempts: 1 } } })).toBe("/api/control/groups/g/tasks/a/loop");
  });
});
