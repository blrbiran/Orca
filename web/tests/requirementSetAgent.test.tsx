// @vitest-environment jsdom
/**
 * Issue #236 (plan 2026-11-10 follow-up B, T10): a requirement round blocked on its agent -- a frozen selector the catalog
 * no longer lists (`agent-selection-invalid:`), or ccloop's `single-call-unsupported` at accept -- can only be unblocked by
 * re-selecting the agent (requirement-set-agent); retrying the same selection blocks again. The Requirements view offers
 * that choice where the block is shown, with the agent and model fields the New requirement form uses (#220). Any other
 * block offers no such choice: set-agent would refuse it as a call in flight.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { AgentsViewV1, ModelListState, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
import { pickOption } from "./selectControl.js";
afterEach(cleanup);
const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
  { id: "my-coder", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
  { id: "my-claude", kind: "claude", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
] };
const ready = (models: string[]): ModelListState => ({ state: "ready", view: { installation: "my-coder", kind: "codex", source: "cache", observedAt: null,
  models: models.map((model) => ({ model, contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1-soft" as const })) } as never });
const blocked = (reason: string): RequirementViewV1 => {
  const view = requirementView("answered");
  const drafting = { ...view, rounds: [...view.rounds, { ...view.rounds[0]!, roundNo: 2, state: "drafting" as const, result: null, answers: null }] };
  return { ...drafting, summary: { ...drafting.summary, requirement: { ...drafting.summary.requirement!, roundNo: 2, roundState: "drafting", blockedRun: { runId: "run-7", reason } } } };
};
function mount(reason: string, lists: Record<string, ModelListState | undefined> = {}) {
  const onCommand = vi.fn(), onModels = vi.fn();
  const view = blocked(reason);
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={agents} language="en" onSelect={vi.fn()} onCommand={onCommand}
    models={(id) => lists[id]} onModels={onModels} />);
  return { onCommand, onModels, control: () => screen.queryByRole("form", { name: "Choose another agent" }) };
}
const STALE = "agent-selection-invalid:fixture-model (listed: tokenswitch/mode-a tokenswitch/mode-b)";
const UNSUPPORTED = "accept-refused:2:single-call-unsupported: codex model fixture-model has no single call";

describe("re-selecting a requirement's agent where its round is blocked on it (#236)", () => {
  it("shows the reason and offers the agent with its catalog's models, then sends requirement-set-agent with that agent and model", async () => {
    const { onCommand, onModels, control } = mount(STALE, { "my-coder": ready(["tokenswitch/mode-a", "tokenswitch/mode-b"]) });
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent!.includes(STALE))).toBe(true);
    const form = control()!;
    expect(form).not.toBeNull();
    // No agent chosen yet: nothing to send.
    expect(within(form).getByRole("button", { name: "Use this agent" })).toHaveProperty("disabled", true);
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-coder");
    expect(onModels).not.toHaveBeenCalled();
    const model = within(form).getByLabelText(/^Model/) as HTMLInputElement;
    expect(model.placeholder).toBe("gpt-6-sol");
    const listId = model.getAttribute("list")!;
    expect(Array.from(document.getElementById(listId)!.querySelectorAll("option")).map((o) => o.value)).toEqual(["tokenswitch/mode-a", "tokenswitch/mode-b"]);
    fireEvent.change(model, { target: { value: "tokenswitch/mode-a" } });
    fireEvent.click(within(form).getByRole("button", { name: "Use this agent" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toEqual({ verb: "requirement-set-agent", groupId: "r", expectedRevision: 3,
      payload: { agent: { agent: "my-coder", model: "tokenswitch/mode-a" } } });
  });

  it("offers it on ccloop's single-call-unsupported refusal too; an empty model keeps the agent's default and reads its list", async () => {
    const { onCommand, onModels, control } = mount(UNSUPPORTED);
    const form = control()!;
    expect(form).not.toBeNull();
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-claude");
    expect(onModels).toHaveBeenCalledWith("my-claude");
    fireEvent.click(within(form).getByRole("button", { name: "Use this agent" }));
    expect(onCommand.mock.calls[0]![0]).toEqual({ verb: "requirement-set-agent", groupId: "r", expectedRevision: 3, payload: { agent: { agent: "my-claude" } } });
  });

  it("offers no agent choice for any other blocked reason", () => {
    for (const reason of ["accept-refused:2:claim-invalid: not this agent's fault", "requirement-usage-unknown:omp-stalled", "agent-selection-rejected:estimator", "single-call-unsupported"]) {
      const { control } = mount(reason);
      expect(screen.getAllByRole("alert").some((alert) => alert.textContent!.includes(reason))).toBe(true);
      expect(control()).toBeNull();
      cleanup();
    }
  });
});
