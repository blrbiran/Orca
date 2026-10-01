// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/ControlPanel.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlConfigV1, ControlSummaryV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

// N1 spec §11.2: the round form (each question preset to "use recommended", switchable to free text, "accept all
// recommended"), consensus with a second confirmation when open branches remain, and the draft's computed layers.
afterEach(cleanup);
const mount = (view: RequirementViewV1, onCommand = vi.fn()) => {
  render(<RequirementsPanel config={config as ControlConfigV1} summary={summaryWith(view) as ControlSummaryV1} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={onCommand} />);
  return onCommand;
};

describe("the Requirements section (N1 spec §11.2)", () => {
  it("presets every question to the recommended answer and sends them all with one click", () => {
    const onCommand = mount(requirementView("awaiting-answers"));
    expect(screen.getAllByRole("radio", { name: "Use recommended", checked: true })).toHaveLength(2);
    // "Accept all recommended" overrides an answer the person had started typing (spec §11.2: one click).
    const second = screen.getByRole("group", { name: /R1\.Q2/ });
    fireEvent.click(within(second).getByRole("radio", { name: "Own answer" }));
    fireEvent.change(within(second).getByRole("textbox"), { target: { value: "half-typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept all recommended" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "requirement-answer", groupId: "r", expectedRevision: 3, payload: {
      roundNo: 1, answers: [{ id: "R1.Q1", kind: "recommended" }, { id: "R1.Q2", kind: "recommended" }],
      glossaryDecisions: [{ id: "R1.G1", accept: true }], adrDecisions: [{ id: "R1.ADR1", accept: true }] } });
  });

  it("sends a free-text answer and a rejected proposal as the person set them", () => {
    const onCommand = mount(requirementView("awaiting-answers"));
    const second = screen.getByRole("group", { name: /R1\.Q2/ });
    fireEvent.click(within(second).getByRole("radio", { name: "Own answer" }));
    fireEvent.change(within(second).getByRole("textbox"), { target: { value: "As links, relative to the note" } });
    fireEvent.click(within(screen.getByRole("group", { name: /R1\.ADR1/ })).getByRole("radio", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    expect(onCommand.mock.calls[0]![0].payload).toMatchObject({ answers: [{ id: "R1.Q1", kind: "recommended" }, { id: "R1.Q2", kind: "text", text: "As links, relative to the note" }], adrDecisions: [{ id: "R1.ADR1", accept: false }] });
  });

  it("asks a second time before consensus while the model still lists open branches, and names them", () => {
    const onCommand = mount(requirementView("answered"));
    fireEvent.click(screen.getByRole("button", { name: "We agree" }));
    expect(onCommand).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "The model still lists open branches" });
    expect(within(dialog).getByText("sync to a cloud drive")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Agree anyway" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "requirement-consensus", groupId: "r", expectedRevision: 3, payload: { roundNo: 1 } });
  });

  it("shows the layers code computed and the conflict behind each implicit edge, and accepts with the draft hash", () => {
    const onCommand = mount(requirementView("awaiting-review"));
    expect(screen.getByText("Layer 1: exporter")).toBeTruthy();
    expect(screen.getByText("Layer 2: images")).toBeTruthy();
    expect(screen.getByText("exporter before images: src/** ∩ src/**")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept this split" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "requirement-draft-accept", groupId: "r", expectedRevision: 3, payload: { draftNo: 1, draftHash: "d".repeat(64) } });
  });

  it("explains a reason code in one line and retries the requirement", () => {
    const onCommand = mount(requirementView("failed"));
    expect(screen.getByText(/were invalid three times/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "r", expectedRevision: 3, payload: { scope: "group", groupId: "r" } });
  });
});

// Task 13 implementer additions (session b5e8d368, 2026-10-02): the branches the plan's five criteria do not reach.
const withSummary = (view: RequirementViewV1, requirement: Partial<NonNullable<RequirementViewV1["summary"]["requirement"]>>): RequirementViewV1 =>
  ({ ...view, summary: { ...view.summary, requirement: { ...view.summary.requirement!, ...requirement } } });

describe("the Requirements section, the rest of its branches (N1 spec §11.2)", () => {
  it("defaults the new requirement's content language to the UI language and opens it on a registered repository", () => {
    const onCommand = vi.fn();
    const view = requirementView("answered");
    // The panel speaks Chinese here (language prop); the criterion still reads the English catalogue, set up in tests/setup.ts.
    render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{}} selected={null} agents={null} language="zh" onSelect={() => {}} onCommand={onCommand} />);
    const form = screen.getByRole("form", { name: "New requirement" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Idea" }), { target: { value: "Let people print a page." } });
    fireEvent.click(within(form).getByRole("button", { name: "Start clarifying" }));
    const action = onCommand.mock.calls[0]![0];
    expect(action).toEqual({ verb: "requirement-open", groupId: action.payload.groupId, expectedRevision: 0, payload: {
      groupId: action.payload.groupId, repoId: "repo", idea: "Let people print a page.", contentLanguage: "zh",
      limit: { tokens: 10_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40 } } });
    expect(action.payload.groupId).toMatch(/^requirement-/);
  });

  it("offers no new-requirement form when no repository is registered", () => {
    const view = requirementView("answered");
    render(<RequirementsPanel config={{ ...config, repositories: [] }} summary={summaryWith(view)} views={{}} selected={null} agents={null} language="en" onSelect={() => {}} onCommand={vi.fn()} />);
    expect(screen.getByRole("note").textContent).toBe("No repository is registered with this panel.");
    expect(screen.queryByRole("form", { name: "New requirement" })).toBeNull();
  });

  it("lists every group that carries a requirement and opens the one clicked", () => {
    const onSelect = vi.fn();
    const view = requirementView("answered");
    render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{}} selected={null} agents={null} language="en" onSelect={onSelect} onCommand={vi.fn()} />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Requirement list" })).getByRole("button", { name: /^r · clarifying/ }));
    expect(onSelect).toHaveBeenCalledWith("r");
  });

  it("explains an exhausted budget without a retry, and raises the limit instead", () => {
    const onCommand = mount(withSummary(requirementView("answered"), { waiting: "requirement-budget-exhausted" }));
    expect(screen.getByText(/does not fit the limit/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    const form = screen.getByRole("form", { name: "Raise the limit" });
    fireEvent.change(within(form).getByRole("spinbutton", { name: "Token limit" }), { target: { value: "12000000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Raise the limit" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "set-limit", groupId: "r", expectedRevision: 3, payload: { limit: { tokens: 12_000_000, activeMs: 0, attempts: 0, sessions: 0 } } });
  });

  it("retries a round the person stopped, which carries no reason code", () => {
    const view = requirementView("answered");
    const onCommand = mount({ ...view, rounds: [...view.rounds, { ...view.rounds[0]!, roundNo: 2, state: "interrupted", result: null, answers: null }] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "r", expectedRevision: 3, payload: { scope: "group", groupId: "r" } });
  });

  it("shows drafting with a stop button that stops the call in flight", () => {
    const view = requirementView("answered");
    const onCommand = mount({ ...view, rounds: [...view.rounds, { ...view.rounds[0]!, roundNo: 2, state: "drafting", result: null, answers: null }] });
    expect(screen.getByText(/The model is drafting\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "handoff-stop", groupId: "r", expectedRevision: 3, payload: {} });
  });

  it("sends a draft back with the person's feedback", () => {
    const onCommand = mount(requirementView("awaiting-review"));
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Fold the two into one." } });
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "requirement-draft-feedback", groupId: "r", expectedRevision: 3, payload: { draftNo: 1, feedback: "Fold the two into one." } });
  });

  it("explains a path-blocked export, a conflict told apart by its reason code, and retries it", () => {
    const view = withSummary(requirementView("awaiting-review"), { reasonCode: "requirement-export-path-blocked", exportState: "conflict" });
    const onCommand = mount({ ...view, requirement: { ...view.requirement, export: { ...view.requirement.export, state: "conflict", detail: "path:.orca" } } });
    expect(screen.getByRole("alert").textContent).toMatch(/^requirement-export-path-blocked · .*\.orca/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "r", expectedRevision: 3, payload: { scope: "group", groupId: "r" } });
  });

  it("explains a pending export, and names the export commit once it is done", () => {
    const view = requirementView("awaiting-review");
    const at = (state: "pending" | "done", commit: string | null): RequirementViewV1 => ({ ...view, requirement: { ...view.requirement, export: { ...view.requirement.export, state, commit } } });
    mount(at("pending", null));
    expect(screen.getByRole("status").textContent).toMatch(/^requirement-export-pending · /);
    cleanup();
    mount(at("done", "c0ffee1"));
    expect(screen.getByText("Export: done · Commit c0ffee1")).toBeTruthy();
  });

  it("names a refused requirement command's reason code in one line", () => {
    const view = requirementView("answered");
    render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={vi.fn()}
      refusal={{ status: 422, code: "requirement-not-split", message: "requirement-not-split", commandRevision: 3 }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/^requirement-not-split · .*not been split/);
  });
});

describe("a clarifying group in Task control (N1 spec §11.2)", () => {
  it("links to Requirements with a badge instead of opening the group there", () => {
    const view = requirementView("answered");
    const onSelect = vi.fn();
    render(<ControlPanel config={config} summary={summaryWith(view)} recovery={{ schema: "orca-control-recovery-v1", epoch: "e-1", dispatchBlocked: false, blockers: [] }}
      groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={onSelect} onDraft={() => {}} onCommand={() => {}} />);
    const groups = screen.getByRole("navigation", { name: "Control groups" });
    expect(within(groups).queryAllByRole("button")).toHaveLength(0);
    const link = within(groups).getByRole("link");
    expect(link.getAttribute("href")).toBe("#requirements");
    expect(link.textContent).toBe("r · clarifying · requirement — open in Requirements");
  });
});
