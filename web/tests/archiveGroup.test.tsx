// @vitest-environment jsdom
/** Issue-fixes spec §6.3, §6.5: the archived banner and its Unarchive, the Archive action, and the detail's order. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCommandPath } from "../src/controlApi.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import { budgetFieldKey } from "../src/BudgetEditor.js";
import type { AgentSelectionPreviewV1, AgentsViewV1, GroupViewV1 } from "../src/controlTypes.js";
import { PLAN, amount, config, run, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

/** Every enabled button that is not navigation (a graph node, a work-item row toggle) nor a read (the evidence list). */
const actionButtons = (): HTMLElement[] =>
  screen.queryAllByRole("button").filter((button) => !(button as HTMLButtonElement).disabled && button.closest("figure") === null
    && !button.hasAttribute("aria-expanded") && !/evidence/i.test(button.textContent ?? ""));

const archived = (base: GroupViewV1): GroupViewV1 => ({ ...base, summary: { ...base.summary, state: "ready", archived: true } });

describe("archiving from the group view (spec §6.3)", () => {
  it("shows an archived group's banner with Unarchive, and offers no dispatch action", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={archived(view([workItem({ taskId: "a" })]))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByRole("status", { name: "Archived" }).textContent).toContain("This group is archived");
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "unarchive-group", groupId: "g", expectedRevision: 6, payload: {} });
    expect(actionButtons().map((button) => button.textContent)).toEqual(["Unarchive"]);
  });

  it("offers no retry on an archived group, because the server refuses every command but Unarchive (group-archived)", () => {
    const failed = run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: x" });
    const held = run({ runId: "run-c", taskId: "c", state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded", stopReason: null });
    // D9/M3: a task Retry is offered only for its current failure.
    const base = view([workItem({ taskId: "a", currentRunId: failed.runId, lineageRunIds: [failed.runId] })], [failed, held]);
    const open = render(<ControlGroupView view={base} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Retry (task|run)/ })).toHaveLength(2);
    open.unmount();
    render(<ControlGroupView view={archived(base)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryAllByRole("button", { name: /^Retry/ })).toHaveLength(0);
  });

  it("offers no editor or action anywhere on an archived group, task detail included, only Unarchive", () => {
    const failed = run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: x" });
    const item = workItem({ taskId: "a", labels: ["x"], currentRunId: "run-a", lineageRunIds: ["run-a"] });
    const onCommand = vi.fn();
    const props = { config, uncertain: [], drafts: {}, onDraft: vi.fn(), onCommand, agents: null, integrationFor: () => null };
    const open = render(<ControlGroupView view={view([item], [failed])} {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "a" })[0]!);
    const before = actionButtons().length;
    // Final review M1: the failed run is still active, so Archive group is not among them (archive-run-active).
    expect(before).toBeGreaterThanOrEqual(10);
    open.unmount();
    render(<ControlGroupView view={archived(view([item], [failed]))} {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "a" })[0]!);
    expect(screen.getByRole("region", { name: /^Task a/ })).toBeTruthy();
    expect(actionButtons().map((button) => button.textContent)).toEqual(["Unarchive"]);
    // Fields may be shown, but none can be typed into: a draft of an edit the server will refuse is never started.
    expect(screen.queryAllByRole("textbox").filter((field) => !(field as HTMLInputElement).readOnly)).toHaveLength(0);
  });

  it("shows TaskDetail of an archived group without Retry task or the label and loop editors", () => {
    const failed = run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: x" });
    const item = workItem({ taskId: "a", labels: ["x"], currentRunId: "run-a", lineageRunIds: ["run-a"] });
    const base = view([item], [failed]);
    const open = render(<TaskDetail view={base} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Retry task/ })).toHaveLength(1);
    open.unmount();
    const a = archived(base);
    render(<TaskDetail view={a} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} archived />);
    expect(screen.queryAllByRole("button", { name: /^Retry task/ })).toHaveLength(0);
    expect(actionButtons()).toHaveLength(0);
  });

  it("offers Archive group on a group that is not archived, and sends it under the view's revision", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([workItem({ taskId: "a" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("status", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "archive-group", groupId: "g", expectedRevision: 6, payload: {} });
  });

  it("serves both verbs on the group's own routes", () => {
    expect(controlCommandPath({ verb: "archive-group", groupId: "g 1", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g%201/archive");
    expect(controlCommandPath({ verb: "unarchive-group", groupId: "g", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g/unarchive");
  });
});

// Final review M1: archive-group refuses (archiveGroup.ts refuseArchive) while an estimate call runs, while a stop other
// than a pause has not settled into handoff-complete or handoff-partial, while an integration conflict is being resolved,
// and while any run is active. Each case below is one of those guards; the button is offered only where none applies.
describe("Archive group is offered only where the server accepts archive-group (final review M1)", () => {
  const offered = (shown: GroupViewV1): boolean => {
    const mounted = render(<ControlGroupView view={shown} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const found = screen.queryByRole("button", { name: "Archive group" }) !== null;
    mounted.unmount();
    return found;
  };
  const stopped = (mode: "pause" | "shutdown" | "handoff", state: NonNullable<GroupViewV1["stop"]>["state"]): GroupViewV1 => {
    const base = view([]);
    return { ...base, stop: { mode, state, frozenRunIds: [], acceptedAt: null, deadlineAt: null }, summary: { ...base.summary, stopMode: mode, stopState: state } };
  };
  const estimate = (state: GroupViewV1["estimates"][number]["state"]): GroupViewV1["estimates"][number] =>
    ({ estimateId: "est-1", estimateVersion: 1, state, profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft", requestHash: null, outputHash: null, output: null, reasonCode: null });
  const integration = (state: NonNullable<GroupViewV1["integration"]>["state"]): NonNullable<GroupViewV1["integration"]> =>
    ({ scheme: { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" }, schemeHash: "h", frozen: true, state, reason: null, lastIntegrated: null, integratedCommit: null, pr: null });

  it("hides it while a run is active, a terminally failed blocked run included, and offers it once every run has settled", () => {
    expect(offered(view([], [run({ state: "running" })]))).toBe(false);
    expect(offered(view([], [run({ state: "landed" })]))).toBe(false);
    expect(offered(view([], [run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: x" })]))).toBe(false);
    expect(offered(view([], [run({ state: "settled-unrecoverable" }), run({ runId: "run-b", state: "settled-failed" }), run({ runId: "run-c", state: "failed-before-provider" })]))).toBe(true);
  });

  it("hides it while an estimate call is running or its start is unknown", () => {
    expect(offered({ ...view([]), estimates: [estimate("running")] })).toBe(false);
    expect(offered({ ...view([]), estimates: [estimate("start-unknown")] })).toBe(false);
    expect(offered({ ...view([]), estimates: [estimate("ready")] })).toBe(true);
  });

  it("hides it while a handoff or shutdown stop is still settling or unresolved, and offers it once it settled completely or partially", () => {
    expect(offered(stopped("handoff", "handoff-pending"))).toBe(false);
    expect(offered(stopped("shutdown", "handoff-unresolved"))).toBe(false);
    expect(offered(stopped("handoff", "handoff-complete"))).toBe(true);
    expect(offered(stopped("shutdown", "handoff-partial"))).toBe(true);
  });

  it("offers it under a pause with no active run, because a pause intent does not refuse archive", () => {
    expect(offered(stopped("pause", "paused"))).toBe(true);
  });

  it("hides it while an agent resolves the group's integration conflict", () => {
    expect(offered({ ...view([]), integration: integration("resolving") })).toBe(false);
    expect(offered({ ...view([]), integration: integration("conflict") })).toBe(true);
  });
});

describe("the group detail's order (spec §6.5)", () => {
  it("puts the archived banner before the graph, the graph before the work-items table, the table before runs, and runs before the budget editor", () => {
    render(<ControlGroupView view={archived(view([workItem({ taskId: "a" })]))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const banner = screen.getByRole("status", { name: "Archived" });
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    const items = screen.getByRole("heading", { name: "Work items" });
    const runs = screen.getByRole("heading", { name: "Runs" });
    const budget = screen.getByRole("region", { name: "Budget proposal" });
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(banner, graph)).toBe(true);
    expect(follows(graph, items)).toBe(true);
    expect(follows(items, runs)).toBe(true);
    expect(follows(runs, budget)).toBe(true);
  });
});

// A group that is still being set up carries every editor the page has: the budget (with a model's suggestions and an edit
// in hand), the agent selection, the loop plan, labels, and an integration in conflict. Archived, none of them acts.
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const SUGGESTION = {
  schema: "budget-estimate-v1" as const, planHash: "a".repeat(64), goalReviewReserve: amount(15), groupRationale: "small",
  tasks: [{ taskId: "a", complexity: "M" as const, confidence: "high" as const, work: { tokens: 3_000, activeMs: 45_000, attempts: 2, sessions: 1 }, handoff: amount(30), rationale: "r", assumptions: [] }],
};
const AGENTS: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [{ id: "claude", kind: "claude", defaults: { model: "m", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" }] };
const claude = { agent: "claude", model: "m", contextWindow: "agent-default" } as const;
const PREVIEW: AgentSelectionPreviewV1 = {
  schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 2, groupOverrides: { worker: { agent: "claude" } }, taskOverrides: { a: { agent: "claude" } },
  planLayers: { group: {}, tasks: { a: null } },
  slots: [{ key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen: { selection: claude, configHash: "e".repeat(64), timeoutMs: 1, killGraceMs: 1,
    capabilities: config.profiles[0]!.declared, partial: { agent: "claude" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" } } } }],
  selectionsHash: "f".repeat(64),
};
const setup = (): GroupViewV1 => {
  const base = view([workItem({ taskId: "a", status: "ready", labels: ["x"], loopPlan: PLAN, objective: { goal: "g", successCondition: "s" } })]);
  return {
    ...base,
    summary: { ...base.summary, state: "ready" },
    proposal: { ...base.proposal, state: "editable", executionSnapshotHash: null, profiles: null },
    allocations: [
      { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(2_000), fieldProvenance: provenance },
      { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(20), fieldProvenance: provenance },
    ],
    estimates: [{ estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft", requestHash: "c".repeat(64), outputHash: "d".repeat(64), output: SUGGESTION, reasonCode: null }],
    integration: { scheme: { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" }, schemeHash: "h", frozen: true, state: "conflict", reason: null, lastIntegrated: null, integratedCommit: null, pr: null },
  };
};
const editDraft = { [budgetFieldKey("g", { scope: "task", taskId: "a", allocation: "handoff", dimension: "tokens" })]: "25" };
const showSetup = (groupView: GroupViewV1, onCommand = vi.fn()) => render(
  <ControlGroupView view={groupView} config={config} uncertain={[]} drafts={editDraft} onDraft={vi.fn()} onCommand={onCommand}
    agents={AGENTS} preview={PREVIEW} onRereadPreview={vi.fn()} integrationFor={() => null} />,
);

describe("an archived group takes no edit anywhere on the page (spec §6.3)", () => {
  it("offers every editor while the group is not archived, so the next test is not an empty page", () => {
    showSetup(setup());
    fireEvent.click(screen.getAllByRole("button", { name: "a" })[0]!);
    const names = actionButtons().map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
    for (const expected of [
      /^use \d+ for/, /^Apply row/, /^Apply all/, /^Set limit/, /^Save proposal/, /^Re-estimate/, /^Confirm budget/, /^Save integration/, /^Retry integration/, /^Resolve with an agent/,
      /^Re-read agent/, /^Set group worker agent/, /^Set agent for task a/, /^Change plan/, /^Remove x/, /^Add system label/, /^Restore plan labels/,
    ]) {
      expect(names.some((name) => expected.test(name)), String(expected)).toBe(true);
    }
  });

  it("leaves only Unarchive when archived, with the task detail open", () => {
    const onCommand = vi.fn();
    showSetup(archived(setup()), onCommand);
    fireEvent.click(screen.getAllByRole("button", { name: "a" })[0]!);
    expect(screen.getByRole("region", { name: /^Task a/ })).toBeTruthy();
    expect(actionButtons().map((button) => button.textContent)).toEqual(["Unarchive"]);
    expect(screen.queryAllByRole("textbox").filter((field) => !(field as HTMLInputElement).readOnly)).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});
