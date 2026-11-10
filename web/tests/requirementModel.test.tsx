// @vitest-environment jsdom
/**
 * Issue #220: the New requirement form let a person choose an agent but not its model, so a default model the provider's
 * catalog does not list was refused only after submit, with the fix on another page. The form now offers the model for the
 * chosen agent, from its catalog when read, says when the default is not listed, and sends the model with that agent.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { AgentsViewV1, ModelListState } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
import { pickOption } from "./selectControl.js";
afterEach(cleanup);
const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
  { id: "my-coder", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
  { id: "my-claude", kind: "claude", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
] };
const ready = (models: string[]): ModelListState => ({ state: "ready", view: { installation: "my-coder", kind: "codex", source: "cache", observedAt: null,
  models: models.map((model) => ({ model, contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1-soft" as const })) } as never });

function mount(lists: Record<string, ModelListState | undefined>) {
  const onCommand = vi.fn(), onModels = vi.fn();
  const view = requirementView("failed");
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={agents} language="en" onSelect={vi.fn()} onCommand={onCommand}
    models={(id) => lists[id]} onModels={onModels} />);
  const form = screen.getByRole("form", { name: "New requirement" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Idea" }), { target: { value: "Investigate" } });
  return { form, onCommand, onModels };
}

describe("choosing the model where a requirement starts (#220)", () => {
  it("offers no model box until an agent is chosen, and reads the chosen agent's list when it has none", async () => {
    const { form, onModels } = mount({});
    expect(within(form).queryByLabelText(/^Model/)).toBeNull();
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-coder");
    expect(onModels).toHaveBeenCalledWith("my-coder");
    expect((within(form).getByLabelText(/^Model/) as HTMLInputElement).placeholder).toBe("gpt-6-sol");
  });

  it("says the agent's default is not listed, and sends the model typed for that agent", async () => {
    const { form, onCommand } = mount({ "my-coder": ready(["mode-a", "mode-b"]) });
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-coder");
    expect(form.textContent).toContain("default model gpt-6-sol is not in its model list");
    fireEvent.change(within(form).getByLabelText(/^Model/), { target: { value: "mode-a" } });
    fireEvent.submit(form);
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ verb: "requirement-open", payload: { agent: { agent: "my-coder", model: "mode-a" } } });
  });

  it("sends no model when the box is left empty, and a new agent clears the one typed for the last", async () => {
    const { form, onCommand } = mount({ "my-coder": ready(["mode-a"]), "my-claude": ready(["local"]) });
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-coder");
    fireEvent.change(within(form).getByLabelText(/^Model/), { target: { value: "mode-a" } });
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-claude");
    expect((within(form).getByLabelText(/^Model/) as HTMLInputElement).value).toBe("");
    fireEvent.submit(form);
    expect(onCommand.mock.calls[0]![0].payload.agent).toEqual({ agent: "my-claude" });
  });
});
