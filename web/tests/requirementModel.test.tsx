// @vitest-environment jsdom
/**
 * Issue #220: the New requirement form let a person choose an agent but not its model, so a default model the provider's
 * catalog does not list was refused only after submit, with the fix on another page. The form now offers the model for the
 * chosen agent, from its catalog when read, says when the default is not listed, and sends the model with that agent.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { AgentsViewV1, ModelListState, OperatorPreferencesV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
import { pickOption } from "./selectControl.js";
afterEach(cleanup);
const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
  { id: "my-coder", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
  { id: "my-claude", kind: "claude", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
] };
const ready = (models: string[]): ModelListState => ({ state: "ready", view: { installation: "my-coder", kind: "codex", source: "cache", observedAt: null,
  models: models.map((model) => ({ model, contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1-soft" as const })) } as never });

function mount(lists: Record<string, ModelListState | undefined>, preferences?: OperatorPreferencesV1 | null) {
  const onCommand = vi.fn(), onModels = vi.fn();
  const view = requirementView("failed");
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={agents} language="en" onSelect={vi.fn()} onCommand={onCommand}
    models={(id) => lists[id]} onModels={onModels} {...(preferences === undefined ? {} : { preferences })} />);
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

/**
 * Issue #220, second half: "Your default" named no agent and no model, and an empty model box promised the installation's
 * default while the server takes the operator's per-agent model first (src/control/agentSelection.ts resolveSelection; the
 * mirror is web/src/requirementAgent.ts). The form now names what the call will use, warns from that agent's catalog,
 * and reads that catalog.
 */
describe("what 'Your default' and an empty model box will actually use (#220)", () => {
  /** `defaultAgent` null: the operator set none. */
  const prefs = (perAgent: OperatorPreferencesV1["perAgent"], defaultAgent: string | null = "my-coder"): OperatorPreferencesV1 =>
    ({ ...(defaultAgent === null ? {} : { defaultAgent }), perAgent });

  // mutation: the default line is not rendered -> red
  // mutation: the line reads chosen.defaults.model instead of the resolved model -> "gpt-6-sol" -> red
  it("names the default agent and the operator's model for it before the installation's default", () => {
    const { form } = mount({}, prefs({ "my-coder": { model: "mode-b" } }));
    expect(form.textContent).toContain("Your default: my-coder · mode-b");
  });

  it("names the installation's default model when the operator chose none for that agent", () => {
    const { form } = mount({}, prefs({ "my-claude": { model: "elsewhere" } }));
    expect(form.textContent).toContain("Your default: my-coder · gpt-6-sol");
  });

  // mutation: the catalog read for the resolved default agent is dropped -> onModels never called -> red
  it("reads the default agent's catalog without a pick, and warns when it does not list the model that will run", () => {
    const first = mount({}, prefs({ "my-coder": { model: "mode-b" } }));
    expect(first.onModels).toHaveBeenCalledWith("my-coder");
    cleanup();
    const { form } = mount({ "my-coder": ready(["mode-a"]) }, prefs({ "my-coder": { model: "mode-b" } }));
    expect(form.textContent).toContain("default model mode-b is not in its model list");
  });

  it("says no default agent is set, so a pick is needed, when the operator has none", () => {
    const { form } = mount({}, prefs({}, null));
    expect(form.textContent).toContain("No default agent is set");
    expect(form.textContent).not.toContain("Your default:");
  });

  // mutation: the placeholder or the unlisted warning reads chosen.defaults.model again -> red
  it("puts the operator's model for a picked agent in the empty box and checks that one against the catalog", async () => {
    const { form } = mount({ "my-coder": ready(["mode-b"]) }, prefs({ "my-coder": { model: "mode-b" } }, null));
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-coder");
    expect((within(form).getByLabelText(/^Model/) as HTMLInputElement).placeholder).toBe("mode-b");
    expect(form.textContent).not.toContain("is not in its model list");
  });
});

/**
 * Issue #220 residual: the form warned that the model was not listed, yet let the person submit into the server's certain
 * refusal (agent-selection-invalid). The submit now follows the server's test (`selectorMissOf`,
 * src/control/estimatorCompatibility.ts): a codex catalog that was read (cache or probe) and lists models but not the one
 * that will be sent. Anything else -- another kind, no catalog source, an empty or unread list -- is not refused there, so
 * the submit stays open.
 */
describe("a model the server would refuse is not submitted (#220)", () => {
  const list = (models: string[], change: Partial<{ kind: string; source: string }> = {}): ModelListState =>
    ({ state: "ready", view: { ...(ready(models) as { view: object }).view, ...change } } as never);
  const submit = (form: HTMLElement) => within(form).getByRole("button", { name: "Start clarifying" }) as HTMLButtonElement;

  // mutation: the submit's disabled ignores the refusal -> enabled -> red
  // mutation: onSubmit does not check the refusal -> fireEvent.submit sends -> red
  it("disables the submit with the reason while the picked agent's default is unlisted, and opens once a listed model is typed", async () => {
    const { form, onCommand } = mount({ "my-coder": list(["mode-a"]) });
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-coder");
    expect(submit(form).disabled).toBe(true);
    expect(document.getElementById(submit(form).getAttribute("aria-describedby")!)!.textContent).toContain("Orca refuses gpt-6-sol here");
    fireEvent.submit(form);
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText(/^Model/), { target: { value: "mode-a" } });
    expect(submit(form).disabled).toBe(false);
    expect(within(form).queryByTestId("requirement-model-refused")).toBeNull();
    fireEvent.submit(form);
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  // mutation: refusedModel checks only the typed box, not what an empty box resolves to -> "Your default" stays open -> red
  it("refuses what 'Your default' resolves to, without a pick", () => {
    const { form } = mount({ "my-coder": list(["mode-a"]) }, { defaultAgent: "my-coder", perAgent: { "my-coder": { model: "mode-b" } } });
    expect(submit(form).disabled).toBe(true);
    expect(within(form).getByTestId("requirement-model-refused").textContent).toContain("mode-b");
  });

  // mutation: the kind test is dropped -> the claude list refuses -> red
  // mutation: the source test is dropped -> the source-none list refuses -> red
  it.each([
    ["another kind's list", list(["mode-a"], { kind: "claude" })],
    ["a list with no source", list(["mode-a"], { source: "none" })],
    ["an empty list", list([])],
    ["a list still loading", { state: "loading" } as ModelListState],
  ])("leaves the submit open for %s, as the server does", async (_name, state) => {
    const { form } = mount({ "my-coder": state });
    await pickOption(within(form).getByRole("combobox", { name: "Agent" }), "my-coder");
    expect(submit(form).disabled).toBe(false);
    expect(within(form).queryByTestId("requirement-model-refused")).toBeNull();
  });
});
