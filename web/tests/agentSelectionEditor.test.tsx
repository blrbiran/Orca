// @vitest-environment jsdom
/**
 * Agent selection spec §6.4/§6.8 (T15): the proposal view's agent editing. Every resolved field says which
 * layer it came from; a slot ccloop refused (or could not answer for now) is red with ccloop's code; the
 * confirm carries the hash of the resolution on screen, and only for the proposal version that resolution
 * was made for.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath } from "../src/controlApi.js";
import type {
  AgentSelectionPreviewV1, AgentSelectionV1, AgentsViewV1, Amount, ControlConfigV1, FrozenSlotV1, GroupViewV1, OperatorPreferencesV1, SelectionProvenanceV1,
} from "../src/controlTypes.js";

afterEach(() => cleanup());

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-26T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [
    { id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "2.1.282" },
    { id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" },
  ],
};
const claude: AgentSelectionV1 = { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" };
const frozen = (selection: AgentSelectionV1, provenance: SelectionProvenanceV1): FrozenSlotV1 => ({
  selection, configHash: "e".repeat(64), timeoutMs: 120_000, killGraceMs: 5_000, capabilities: capability, partial: { agent: selection.agent }, provenance,
});
const HASH = "f".repeat(64);
const resolvedPreview = (over: Partial<AgentSelectionPreviewV1> = {}): AgentSelectionPreviewV1 => ({
  schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 3, groupOverrides: {}, taskOverrides: { a: null, b: { agent: "codex" } },
  slots: [
    { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "resolved", frozen: frozen(claude, { agent: "operator", model: "descriptor", contextWindow: "descriptor" }) } },
    { key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen: frozen(claude, { agent: "operator", model: "operator-agent", contextWindow: "descriptor" }) } },
    { key: "task:b", slot: "worker", taskId: "b", outcome: { kind: "resolved", frozen: frozen({ agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" }, { agent: "task", model: "descriptor", contextWindow: "descriptor" }) } },
  ],
  selectionsHash: HASH, ...over,
});
const rejectedPreview = (): AgentSelectionPreviewV1 => {
  const base = resolvedPreview({ taskOverrides: { a: null, b: { agent: "codex", contextWindow: 1_000_000 } } });
  return { ...base, slots: [base.slots[0]!, base.slots[1]!, { key: "task:b", slot: "worker", taskId: "b", outcome: { kind: "rejected", code: "agent-context-unsupported" } }], selectionsHash: null };
};
const unavailablePreview = (): AgentSelectionPreviewV1 => {
  const base = resolvedPreview();
  return { ...base, slots: [base.slots[0]!, base.slots[1]!, { key: "task:b", slot: "worker", taskId: "b", outcome: { kind: "unavailable", code: "control-peer-exit" } }], selectionsHash: null };
};
const workItem = (taskId: string, over: Partial<GroupViewV1["workItems"][number]> = {}): GroupViewV1["workItems"][number] => ({
  taskId, status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null,
  currentRunId: null, pendingRunId: null, lineageRunIds: [], ...over,
});
const view = (over: Partial<GroupViewV1> = {}): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "draft", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 3, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(0), explicitUnallocatedReserve: amount(9_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [workItem("a"), workItem("b")], estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
  ...over,
});
const renderView = (props: { view?: GroupViewV1; preview?: AgentSelectionPreviewV1 | null; drafts?: Record<string, string>; onCommand?: ReturnType<typeof vi.fn>; preferences?: OperatorPreferencesV1 }) =>
  render(<ControlGroupView view={props.view ?? view()} config={config} uncertain={[]} drafts={props.drafts ?? {}} onDraft={vi.fn()} onCommand={props.onCommand ?? vi.fn()} agents={agents} preview={props.preview === undefined ? resolvedPreview() : props.preview} agentPreferences={props.preferences} />);
const row = (container: HTMLElement, key: string): HTMLElement => container.querySelector(`tr[data-slot="${key}"]`) as HTMLElement;
const options = (container: HTMLElement, name: string): string[] =>
  [...container.querySelectorAll(`select[name="${name}"] option`)].map((option) => (option as HTMLOptionElement).value);

describe("agent selection in the proposal view (agent selection spec §6.8)", () => {
  it("shows each task's resolved agent, model and context with the layer each came from", () => {
    const { container } = renderView({});
    const a = row(container, "task:a").textContent!;
    expect(a).toContain("claude from operator");
    expect(a).toContain("claude-opus-5-5 from operator-agent");
    expect(a).toContain("agent default from descriptor");
    expect(row(container, "task:b").textContent).toContain("codex from task");
    expect(row(container, "reconcile").textContent).toContain("claude from operator");
  });

  it("shows a slot ccloop refused in red with ccloop's code, and offers no confirm", () => {
    const { container } = renderView({ preview: rejectedPreview() });
    const cell = row(container, "task:b").querySelector('[role="alert"]') as HTMLElement;
    expect(cell.textContent).toContain("agent-context-unsupported");
    expect(cell.textContent).toContain("rejected");
    expect(cell.style.color).toBe("red");
    expect((screen.getByRole("button", { name: "Confirm budget" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a slot ccloop could not answer for now in red with the code, worded as unavailable rather than refused, and offers no confirm", () => {
    const { container } = renderView({ preview: unavailablePreview() });
    const cell = row(container, "task:b").querySelector('[role="alert"]') as HTMLElement;
    expect(cell.textContent).toContain("control-peer-exit");
    expect(cell.textContent).toContain("unavailable for now");
    expect(cell.textContent).not.toContain("rejected");
    expect(cell.style.color).toBe("red");
    expect((screen.getByRole("button", { name: "Confirm budget" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends proposal-set-agent for a task and for a group slot, bound to the revision and proposal version on screen", () => {
    const onCommand = vi.fn();
    renderView({ onCommand, drafts: {
      "g:agent:task:a:agent": "codex",
      "g:agent:group:reconcile:agent": "codex", "g:agent:group:reconcile:model": "gpt-6-sol",
    } });
    fireEvent.click(screen.getByRole("button", { name: "Set agent for task a" }));
    fireEvent.click(screen.getByRole("button", { name: "Set group reconcile agent" }));
    expect(onCommand.mock.calls.map(([action]) => action)).toEqual([
      { verb: "proposal-set-agent", groupId: "g", expectedRevision: 6, payload: { baseProposalVersion: 3, scope: { kind: "task", taskId: "a" }, partial: { agent: "codex" } } },
      { verb: "proposal-set-agent", groupId: "g", expectedRevision: 6, payload: { baseProposalVersion: 3, scope: { kind: "group", slot: "reconcile" }, partial: { agent: "codex", model: "gpt-6-sol" } } },
    ]);
  });

  it("clears a task's own layer with a null partial, not an empty one", () => {
    const onCommand = vi.fn();
    renderView({ onCommand });
    fireEvent.click(screen.getByRole("button", { name: "Clear agent for task b" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "proposal-set-agent", groupId: "g", expectedRevision: 6, payload: { baseProposalVersion: 3, scope: { kind: "task", taskId: "b" }, partial: null } });
    expect((screen.getByRole("button", { name: "Clear agent for task a" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Wave 3 review, T15 item 3: a layer that names no agent inherits the one the layers BELOW it resolve to
  // (spec §6.3 slotLayers), so its context dropdown offers that agent's options -- not whatever some other
  // slot happened to resolve to.
  it("offers each layer's context over the agent that layer inherits from the layers below it", () => {
    const { container } = renderView({ preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude" } } });
    // worker: operator default (codex); estimator: operator-estimator (claude), never the group worker layer;
    // reconcile: operator default (codex) with no operator-reconcile or group worker agent; task a: group worker, else codex.
    expect(options(container, "g:agent:group:worker:context")).toEqual(["", "agent-default"]);
    expect(options(container, "g:agent:group:estimator:context")).toEqual(["", "agent-default", "1000000"]);
    expect(options(container, "g:agent:group:reconcile:context")).toEqual(["", "agent-default"]);
    expect(options(container, "g:agent:task:a:context")).toEqual(["", "agent-default"]);
    cleanup();
    // A group worker agent sits below the reconcile and task layers, and not below the estimator's.
    const second = renderView({
      preferences: { defaultAgent: "codex", perAgent: {} },
      preview: resolvedPreview({ groupOverrides: { worker: { agent: "claude" } } }),
    }).container;
    expect(options(second, "g:agent:group:reconcile:context")).toEqual(["", "agent-default", "1000000"]);
    expect(options(second, "g:agent:task:a:context")).toEqual(["", "agent-default", "1000000"]);
    expect(options(second, "g:agent:group:estimator:context")).toEqual(["", "agent-default"]);
    cleanup();
    // An operator reconcile agent sits below the group layers of the reconcile slot only.
    const third = renderView({ preferences: { defaultAgent: "codex", perAgent: {}, reconcile: { agent: "claude" } } }).container;
    expect(options(third, "g:agent:group:reconcile:context")).toEqual(["", "agent-default", "1000000"]);
    expect(options(third, "g:agent:task:a:context")).toEqual(["", "agent-default"]);
  });

  it("confirms with the selectionsHash of the resolution on screen", () => {
    const onCommand = vi.fn();
    renderView({ onCommand });
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ verb: "confirm", groupId: "g", payload: { proposalVersion: 3, selectionsHash: HASH } });
  });

  it("does not confirm on a resolution made for another proposal version, and says it is re-reading", () => {
    const onCommand = vi.fn();
    const { container } = renderView({ onCommand, preview: resolvedPreview({ proposalVersion: 2 }) });
    const button = screen.getByRole("button", { name: "Confirm budget" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onCommand).not.toHaveBeenCalled();
    expect(container.textContent).toContain("for proposal v2");
  });

  it("shows a confirmed group's frozen selection from its work items and its reconcile slot, and no editing", () => {
    const { container } = renderView({
      preview: resolvedPreview({ proposalVersion: 2 }),
      view: view({
        summary: { groupId: "g", state: "ready", commandRevision: 7, projectionSeq: 5, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
        proposal: { state: "confirmed", proposalVersion: 3, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
          estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
          handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
        workItems: [
          workItem("a", { status: "ready", configHash: "d".repeat(64), agent: { agent: "codex", model: "gpt-6-luna", contextWindow: "agent-default" }, agentProvenance: { agent: "task", model: "task", contextWindow: "descriptor" } }),
          workItem("b", { status: "ready", configHash: "d".repeat(64), agent: claude, agentProvenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" } }),
        ],
        agents: { reconcile: frozen({ agent: "claude", model: "claude-fable-5", contextWindow: 1_000_000 }, { agent: "operator-reconcile", model: "operator-reconcile", contextWindow: "group-reconcile" }) },
      }),
    });
    // Review P23 m2: the budget editor says "frozen at confirmation" too, so the text is looked for in this section only.
    expect(container.querySelector('section[aria-label="Agent selection"]')!.textContent).toContain("frozen at confirmation");
    expect(row(container, "task:a").textContent).toContain("gpt-6-luna from task");
    expect(row(container, "reconcile").textContent).toContain("claude-fable-5 from operator-reconcile");
    expect(row(container, "reconcile").textContent).toContain("1000000 tokens from group-reconcile");
    expect(screen.queryByRole("button", { name: /Set agent for task/ })).toBeNull();
  });

  it("routes proposal-set-agent to the group's proposal/agent path", () => {
    expect(controlCommandPath({ verb: "proposal-set-agent", groupId: "g", expectedRevision: 1, payload: { baseProposalVersion: 1, scope: { kind: "task", taskId: "a" }, partial: null } }))
      .toBe("/api/control/groups/g/proposal/agent");
  });
});
