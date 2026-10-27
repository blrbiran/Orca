// @vitest-environment jsdom
/**
 * Tester round 2 spec §6.2.3-5 (ruling H3, C18; tester #6): a task inherits the group worker unless it says otherwise, so
 * its own agent fields fold into a closed <details>, open only for a task with its own override or a slot that failed;
 * one line above the table counts the tasks that inherit and names the worker; a worker no layer names says where to
 * choose one. §7.4 item 3: a task slot resolved only through the person's own default agent is named on the checklist.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSelectionEditor } from "../src/AgentSelectionEditor.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type {
  AgentSelectionPreviewV1, AgentSelectionV1, AgentsViewV1, Amount, ControlConfigV1, FrozenSlotV1, GroupViewV1, SelectionProvenanceV1,
} from "../src/controlTypes.js";
import { view as boardView, workItem } from "./fixtures/board.js";

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
  // Ruling review R7: the plan's layers ride along with the preview; this fixture's plan names none.
  planLayers: { group: {}, tasks: { a: null, b: null } },
  slots: [
    { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "resolved", frozen: frozen(claude, { agent: "operator", model: "descriptor", contextWindow: "descriptor" }) } },
    { key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen: frozen(claude, { agent: "operator", model: "operator-agent", contextWindow: "descriptor" }) } },
    { key: "task:b", slot: "worker", taskId: "b", outcome: { kind: "resolved", frozen: frozen({ agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" }, { agent: "task", model: "descriptor", contextWindow: "descriptor" }) } },
  ],
  selectionsHash: HASH, ...over,
});
const withRole = (preview: AgentSelectionPreviewV1, worker: AgentSelectionPreviewV1["slots"][number]["outcome"]): AgentSelectionPreviewV1 => ({ ...preview, rolePreviews: { worker, estimator: worker } });
const group = (): GroupViewV1 => {
  const base = boardView([workItem({ taskId: "a", status: "draft" }), workItem({ taskId: "b", status: "draft" }), workItem({ taskId: "c", status: "draft" })]);
  return { ...base, summary: { ...base.summary, state: "draft" }, proposal: { ...base.proposal, state: "editable", proposalVersion: 3, profiles: null, budgetMode: null, executionSnapshotHash: null } };
};
const three = (): AgentSelectionPreviewV1 => {
  const base = resolvedPreview({ taskOverrides: { a: null, b: { agent: "codex" }, c: null } });
  return withRole({ ...base, slots: [...base.slots,
    { key: "task:c", slot: "worker", taskId: "c", outcome: { kind: "rejected", code: "agent-context-unsupported" } },
    { key: "task:d", slot: "worker", taskId: "d", outcome: { kind: "resolved", frozen: frozen(claude, { agent: "task-plan", model: "descriptor", contextWindow: "descriptor" }) } },
    { key: "task:e", slot: "worker", taskId: "e", outcome: { kind: "resolved", frozen: frozen(claude, { agent: "group", model: "descriptor", contextWindow: "descriptor" }) } },
  ] }, { kind: "resolved", frozen: frozen(claude, { agent: "group", model: "descriptor", contextWindow: "descriptor" }) });
};
const show = (preview: AgentSelectionPreviewV1) => render(<AgentSelectionEditor view={group()} agents={agents} preview={preview} drafts={{}} onDraft={() => {}} onCommand={() => {}} />);
const fold = (taskId: string): HTMLDetailsElement => document.querySelector(`details[data-task-override="${taskId}"]`) as HTMLDetailsElement;

describe("per-task agent fields fold away (C18)", () => {
  it("are closed for an inheriting task, open for a task with its own override or a failed slot", () => {
    show(three());
    expect(fold("a").open).toBe(false);
    expect(fold("a").querySelector("summary")!.textContent).toBe("Override task a");
    expect(fold("a").querySelector("button")?.textContent).toBe("Set agent for task a");
    expect(fold("b").open).toBe(true);
    expect(fold("c").open).toBe(true);
  });

  it("one line counts only the tasks that inherit, and names the worker's agent and model", () => {
    show(three());
    // a (operator) and e (group) inherit; b (task), d (task-plan) carry their own; c did not resolve.
    expect(screen.getByTestId("agents-inherit-line").textContent).toBe("2 tasks use the group worker: claude · claude-opus-5-5");
  });

  it("says one task in the singular, and shows no line when no task inherits (review minor 8)", () => {
    const worker = { kind: "resolved", frozen: frozen(claude, { agent: "group", model: "descriptor", contextWindow: "descriptor" }) } as const;
    show(withRole(resolvedPreview(), worker));
    expect(screen.getByTestId("agents-inherit-line").textContent).toBe("1 task uses the group worker: claude · claude-opus-5-5");
    cleanup();
    const own = resolvedPreview();
    own.slots = own.slots.map((slot) => slot.taskId !== null && slot.outcome.kind === "resolved" ? { ...slot, outcome: { kind: "resolved", frozen: frozen(claude, { agent: "task", model: "descriptor", contextWindow: "descriptor" }) } } : slot);
    show(withRole(own, worker));
    expect(screen.queryByTestId("agents-inherit-line")).toBeNull();
  });

  it("a worker no layer names says so, with a link to Global settings", () => {
    show(withRole(resolvedPreview(), { kind: "rejected", code: "agent-unselected" }));
    const note = screen.getByTestId("agents-no-worker");
    expect(note.textContent).toBe("No agent is chosen for the group worker. Choose one here, or set a default agent in Global settings");
    // H6(b): the link opens the Agents category of the one Settings page. Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
    expect(note.querySelector("a")!.getAttribute("href")).toBe("#settings/agents");
    expect(screen.queryByTestId("agents-inherit-line")).toBeNull();
    cleanup();
    show(three());
    expect(screen.queryByTestId("agents-no-worker")).toBeNull();
  });
});

describe("own default agent on the checklist (§7.4 item 3)", () => {
  const unlimited = (): GroupViewV1 => {
    const base = group();
    return { ...base, ledger: { ...base.ledger, groupLimit: { ...base.ledger.groupLimit, tokens: null } }, autoConfirm: { eligible: true, refusedCode: null } };
  };
  it("is named when a task slot resolved through the operator layer, and not otherwise", () => {
    render(<ControlGroupView view={unlimited()} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} agents={agents} preview={resolvedPreview()} />);
    expect(screen.getByTestId("auto-own-agent")).toBeTruthy();
    cleanup();
    const groupOnly = resolvedPreview();
    groupOnly.slots = groupOnly.slots.map((slot) => slot.taskId === "a" && slot.outcome.kind === "resolved" ? { ...slot, outcome: { kind: "resolved", frozen: frozen(claude, { agent: "group", model: "descriptor", contextWindow: "descriptor" }) } } : slot);
    render(<ControlGroupView view={unlimited()} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} agents={agents} preview={groupOnly} />);
    expect(screen.queryByTestId("auto-own-agent")).toBeNull();
  });
});

describe("preparation order (tester #7, #13, #14)", () => {
  // The agents are what a person most often changes before confirming, so they come before the long budget table, and
  // the confirm buttons (at the budget's end) are the last control: everything confirm depends on is above it.
  it("puts Agent selection above the budget, and confirm after both", () => {
    render(<ControlGroupView view={group()} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} agents={agents} preview={three()} />);
    const agentsRegion = document.querySelector('section[aria-label="Agent selection"]')!;
    const budgetRegion = document.querySelector('section[aria-label="Budget proposal"]')!;
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm task plan")!;
    expect(agentsRegion.compareDocumentPosition(budgetRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agentsRegion.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agentsRegion.contains(confirm)).toBe(false);
  });
});

describe("preparation headings (tester #26)", () => {
  // "Proposal v3 · editable" told a person nothing about what the section is for; the heading names the section, and the
  // proposal version stays only as small secondary text.
  it("name the section first and keep the proposal version as small text", () => {
    render(<ControlGroupView view={group()} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} agents={agents} preview={three()} />);
    const heading = (region: string): HTMLHeadingElement => document.querySelector(`section[aria-label="${region}"] > h3`)!;
    expect(heading("Agent selection").firstChild!.textContent).toBe("Agent selection");
    expect(heading("Agent selection").querySelector("small")!.textContent).toBe("proposal v3");
    expect(heading("Budget proposal").firstChild!.textContent).toBe("Budget");
    expect(heading("Budget proposal").querySelector("small")!.textContent).toBe("Proposal v3 · editable");
  });
});
