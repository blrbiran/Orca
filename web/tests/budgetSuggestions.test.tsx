// @vitest-environment jsdom
/**
 * Single-call estimate spec §7 (human ruling S3): the model's suggestions are applied per field, per row or all at
 * once, each as one proposal-edit whose operations carry provenance "model" and the estimate's id. Only the newest
 * estimate (by version) advises, only when it is ready and for this plan, and only while the proposal is editable.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor, DIMENSIONS, adviceOf, budgetFieldKey, suggestedOperations } from "../src/BudgetEditor.js";
import { initialControlState, reduceControlState } from "../src/controlState.js";
import type { Amount, ControlConfigV1, EstimateViewV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const system = { provenance: "system", estimateId: null } as const;
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-26T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const PLAN = "a".repeat(64);
const suggestion = {
  schema: "budget-estimate-v1" as const, planHash: PLAN,
  // work: tokens equal (3000), activeMs and attempts differ, sessions equal; handoff all equal; review tokens differ.
  tasks: [{ taskId: "a", complexity: "M" as const, confidence: "high" as const, work: { tokens: 3_000, activeMs: 45_000, attempts: 2, sessions: 1 }, handoff: amount(300), rationale: "one module to touch", assumptions: ["tests exist", "the API is stable"] }],
  goalReviewReserve: { tokens: 1_500, activeMs: 10_000, attempts: 1, sessions: 1 }, groupRationale: "a single small change",
};
const estimate = (over: Partial<EstimateViewV1> = {}): EstimateViewV1 => ({
  estimateId: "est-2", estimateVersion: 2, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft",
  requestHash: "c".repeat(64), outputHash: "d".repeat(64), output: suggestion, reasonCode: null, ...over,
});
const view = (over: Partial<GroupViewV1> = {}): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(4_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
    { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", state: "draft-encumbered", amount: amount(1_000), fieldProvenance: provenance },
    { ownerKind: "reserve", ownerId: "g:reserve", bucket: "reserve", state: "draft-encumbered", amount: amount(6_000), fieldProvenance: { tokens: system, activeMs: system, attempts: system, sessions: system } },
  ],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [estimate()], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
  ...over,
});
const op = (target: object, value: number) => ({ target, value, provenance: "model", estimateId: "est-2" });
const ALL = [
  op({ scope: "task", taskId: "a", allocation: "work", dimension: "activeMs" }, 45_000),
  op({ scope: "task", taskId: "a", allocation: "work", dimension: "attempts" }, 2),
  op({ scope: "goal-review", dimension: "tokens" }, 1_500),
];

afterEach(cleanup);

describe("suggestedOperations (single-call estimate spec §7)", () => {
  it("offers every field whose suggestion differs, and nothing whose suggestion is the value already there", () => {
    expect(suggestedOperations(view(), { kind: "all" })).toEqual(ALL);
    expect(suggestedOperations(view(), { kind: "row", ownerKind: "task", ownerId: "a", bucket: "work" })).toEqual(ALL.slice(0, 2));
    expect(suggestedOperations(view(), { kind: "row", ownerKind: "task", ownerId: "a", bucket: "handoff" })).toEqual([]);
    expect(suggestedOperations(view(), { kind: "field", target: { scope: "goal-review", dimension: "tokens" } })).toEqual([ALL[2]]);
    expect(suggestedOperations(view(), { kind: "field", target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" } })).toEqual([]);
  });

  it("offers nothing unless the newest estimate is ready, for this plan, and the proposal is editable", () => {
    expect(suggestedOperations(view({ estimates: [estimate({ output: { ...suggestion, planHash: "f".repeat(64) } })] }), { kind: "all" })).toEqual([]);
    expect(suggestedOperations(view({ proposal: { ...view().proposal, state: "confirmed" } }), { kind: "all" })).toEqual([]);
    // Newest by version, not by list order (the view lists estimates by id): a newer running one silences an older ready one...
    expect(suggestedOperations(view({ estimates: [estimate({ estimateId: "est-1", estimateVersion: 3, state: "running", output: null, outputHash: null }), estimate()] }), { kind: "all" })).toEqual([]);
    // ...and the newest ready one advises even when it is listed first.
    expect(adviceOf(view({ estimates: [estimate(), estimate({ estimateId: "est-9", estimateVersion: 1, output: { ...suggestion, groupRationale: "older" } })] }))?.estimateId).toBe("est-2");
  });
});

describe("the budget editor's suggestion controls (single-call estimate spec §7)", () => {
  it("renders exactly today's editor when no estimate may advise", () => {
    // Baseline carries a present-but-not-ready estimate (not `estimates: []`) so the pre-existing Re-estimate
    // button -- gated only on `view.estimates.at(-1)`, unrelated to advice -- is in the same state across every
    // comparison below; otherwise this test would conflate "no advice" with "no estimate at all".
    const today = render(<BudgetEditor view={view({ estimates: [estimate({ state: "queued", output: null, outputHash: null })] })} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.innerHTML;
    cleanup();
    // Every fixture compared in this test has no advice, so an unconditional (not advice-gated) header would be
    // added identically to all of them and the toBe(today) checks below would not catch it -- pin it directly.
    expect(today).not.toContain("<th>suggestion</th>");
    for (const unusable of [view({ estimates: [estimate({ output: { ...suggestion, planHash: "f".repeat(64) } })] }), view({ estimates: [estimate({ state: "failed", output: null, outputHash: null, reasonCode: "estimate-output-invalid" })] })]) {
      expect(render(<BudgetEditor view={unusable} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.innerHTML).toBe(today);
      cleanup();
    }
  });

  // Final review O-e (2026-09-28): the comparison above cannot see a cell every no-advice render would gain alike (an
  // ungated per-row suggestion cell adds the same empty <td> to `today` and to each unusable view). So count directly:
  // with no usable advice each row has exactly its owner, bucket, state and dimension cells, and there is no rationale.
  it("adds no suggestion cell to any row and no rationale when no estimate may advise", () => {
    const plain = 3 + DIMENSIONS.length;
    const advising = render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container;
    // The count is meaningful: an advising editor does add the cell to every row.
    expect([...advising.querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td").length)).toEqual(view().allocations.map(() => plain + 1));
    cleanup();
    for (const unusable of [
      view({ estimates: [estimate({ state: "queued", output: null, outputHash: null })] }),
      view({ estimates: [estimate({ output: { ...suggestion, planHash: "f".repeat(64) } })] }),
      view({ estimates: [estimate({ state: "failed", output: null, outputHash: null, reasonCode: "estimate-output-invalid" })] }),
    ]) {
      const container = render(<BudgetEditor view={unusable} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container;
      const rows = [...container.querySelectorAll("tbody tr")];
      expect(rows).toHaveLength(unusable.allocations.length);
      expect(rows.map((row) => row.querySelectorAll("td").length)).toEqual(unusable.allocations.map(() => plain));
      expect(container.querySelectorAll("details")).toHaveLength(0);
      cleanup();
    }
  });

  it("sends one proposal-edit per control: a field, a row, and all", () => {
    const onCommand = vi.fn();
    render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    const edit = (operations: unknown[]) => ({ verb: "proposal-edit", groupId: "g", expectedRevision: 3, payload: { baseProposalVersion: 2, operations } });
    fireEvent.click(screen.getByRole("button", { name: "use 45000 for a work activeMs" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply row a work" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply all suggestions" }));
    expect(onCommand.mock.calls.map((call) => call[0])).toEqual([edit([ALL[0]]), edit(ALL.slice(0, 2)), edit(ALL)]);
    // No control for a field or a row that has nothing to change.
    expect(screen.queryByRole("button", { name: "use 3000 for a work tokens" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply row a handoff" })).toBeNull();
  });

  // Ruling 26 (Orca ledger 2026-09-27-single-call-estimate §3.21; session c85d2c4e, 2026-09-28), appended -- no test
  // above changed: an unsaved draft of an applied field kept showing its typed number over the applied one. Drafts go
  // through the real reducer, and the field is read back from the rendered input once the server's new view arrives.
  it("drops the unsaved drafts of the fields it applies, so the applied value shows, and keeps every other draft", () => {
    const work = (dimension: string) => budgetFieldKey("g", { scope: "task", taskId: "a", allocation: "work", dimension } as never);
    let state = initialControlState();
    for (const [key, text] of [[work("activeMs"), "111"], [work("tokens"), "7777"]] as const) state = reduceControlState(state, { type: "draft", key, text });
    const onDraft = (key: string, text: string) => { state = reduceControlState(state, { type: "draft", key, text }); };
    const onCommand = vi.fn();
    const { rerender } = render(<BudgetEditor view={view()} config={config} drafts={state.drafts} onDraft={onDraft} onCommand={onCommand} />);
    expect((screen.getByLabelText(/^a work activeMs/) as HTMLInputElement).value).toBe("111");
    fireEvent.click(screen.getByRole("button", { name: "use 45000 for a work activeMs" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(state.drafts).toEqual({ [work("tokens")]: "7777" });
    // The server answers with the applied value; the field now shows it, and the untouched draft still shows its text.
    const applied = view({ allocations: view().allocations.map((a) => a.ownerKind === "task" && a.bucket === "work" ? { ...a, amount: { ...a.amount, activeMs: 45_000 } } : a) });
    rerender(<BudgetEditor view={applied} config={config} drafts={state.drafts} onDraft={onDraft} onCommand={onCommand} />);
    expect((screen.getByLabelText(/^a work activeMs/) as HTMLInputElement).value).toBe("45000");
    expect((screen.getByLabelText(/^a work tokens/) as HTMLInputElement).value).toBe("7,777");
  });

  it("shows the model's reasons read-only under the table", () => {
    render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const details = screen.getByText("Estimate rationale (est-2)").closest("details")!;
    expect(details.textContent).toContain("a single small change");
    expect(details.textContent).toContain("a · M · confidence high · one module to touch");
    expect(details.textContent).toContain("the API is stable");
    expect(details.querySelectorAll("input, button")).toHaveLength(0);
  });
});
