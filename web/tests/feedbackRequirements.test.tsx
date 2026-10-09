// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { AgentsViewV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
afterEach(cleanup);
const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
  { id: "my-coder", kind: "codex", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
  { id: "my-claude", kind: "claude", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
] };
function mount(view = requirementView("failed"), table: AgentsViewV1 | null = agents) {
  const onCommand = vi.fn();
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={table} language="en" onSelect={vi.fn()} onCommand={onCommand} />);
  return onCommand;
}
describe("feedback requirement affordances", () => {
  it("blocks an explicitly selected codex installation before creating an unsupported requirement", () => {
    const send = mount(); const form = screen.getByRole("form", { name: "New requirement" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Idea" }), { target: { value: "Investigate" } });
    fireEvent.change(within(form).getByRole("combobox", { name: "Agent" }), { target: { value: "my-coder" } });
    expect((within(form).getByRole("button", { name: "Start clarifying" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(form).getAllByRole("note").map((node) => node.textContent).join(" ")).toMatch(/Codex.*single-call.*Task control/);
    fireEvent.submit(form); expect(send).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByRole("combobox", { name: "Agent" }), { target: { value: "my-claude" } });
    fireEvent.submit(form); expect(send.mock.calls[0]![0]).toMatchObject({ verb: "requirement-open", payload: { agent: { agent: "my-claude" } } });
  });
  it("leaves a default selection to the server even when the table is unavailable", () => {
    const send = mount(requirementView("failed"), null); const form = screen.getByRole("form", { name: "New requirement" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Idea" }), { target: { value: "Investigate" } });
    fireEvent.submit(form); expect(send.mock.calls[0]![0].verb).toBe("requirement-open");
  });
  it("archives an idle failed requirement with the displayed revision", () => {
    const send = mount(); fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    expect(send).toHaveBeenCalledWith({ verb: "archive-group", groupId: "r", expectedRevision: 3, payload: {} });
  });
  it.each(["round", "draft", "stop", "blocked-run"])("does not offer archive while %s is pending", (pending) => {
    const view = requirementView("failed");
    if (pending === "round") view.rounds[0]!.state = "drafting";
    if (pending === "draft") { const split = requirementView("awaiting-review"); view.requirement.consensus = split.requirement.consensus; view.drafts = split.drafts; view.drafts[0]!.state = "drafting"; }
    if (pending === "stop") { view.summary.stopMode = "handoff"; view.summary.stopState = "handoff-pending"; }
    if (pending === "blocked-run") view.summary.requirement!.blockedRun = { runId: "blocked", reason: "failure" };
    mount(view); expect(screen.queryByRole("button", { name: "Archive group" })).toBeNull();
  });
  it("hides archived requirements from the list until explicitly included", () => {
    const view = requirementView("failed"); view.summary.archived = true; mount(view);
    const list = screen.getByRole("navigation", { name: "Requirement list" });
    expect(within(list).queryByRole("button", { name: "r · clarifying" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived requirements" }));
    expect(within(list).getByRole("button", { name: "r · clarifying" })).toBeTruthy();
  });
  it("keeps an archived requirement readable without offering edits and allows unarchive", () => {
    const view = requirementView("awaiting-answers"); view.summary.archived = true;
    const send = mount(view);
    expect(screen.getByText("People can export a note as Markdown.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
    expect(screen.queryByRole("button", { name: "We agree" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(send).toHaveBeenCalledWith({ verb: "unarchive-group", groupId: "r", expectedRevision: 3, payload: {} });
  });
});

it.each(["awaiting-review", "failed"] as const)("does not offer mutation controls for archived %s requirements", (state) => {
  const view = requirementView(state); view.summary.archived = true;
  if (state === "failed") view.summary.requirement!.waiting = "requirement-budget-exhausted";
  mount(view); const detail = screen.getByRole("article");
  expect(within(detail).getAllByRole("button").map(button => button.textContent)).toEqual(["Unarchive"]);
});
