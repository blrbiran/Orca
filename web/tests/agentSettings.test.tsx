// @vitest-environment jsdom
/**
 * Agent selection spec §6.8 (T15): the operator's defaults page. The context is a dropdown over what the
 * chosen agent can express -- never a free box -- and what is sent is exactly what the drafts describe, under
 * the revision the page read.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import type { JSX } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSettings, preferencesFromDrafts } from "../src/AgentSettings.js";
import { CLEARED_DRAFT, SelectionFields } from "../src/AgentFields.js";
import { initialControlState, reduceControlState } from "../src/controlState.js";
import { agentField, defaultAgentField } from "./agentFieldControl.js";
import { optionsOf, pickOption, shownText } from "./selectControl.js";
import type { AgentPreferencesViewV1, AgentInstallationStateV1, AgentsViewV1, OperatorPreferencesV1 } from "../src/controlTypes.js";

afterEach(() => cleanup());

const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [
    { id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "2.1.282" },
    { id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" },
  ],
};
const preferences: AgentPreferencesViewV1 = {
  schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 4,
  preferences: { defaultAgent: "claude", perAgent: { claude: { model: "claude-fable-5" } } },
};

describe("the Agents settings page (agent selection spec §6.8)", () => {
  it("shows unavailable detection separately and applies only explicitly selected preview changes", () => {
    const onApply = vi.fn();
    const state: AgentInstallationStateV1 = {
      schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, failureCode: null,
      observation: { schema: "orca-agent-detection-observation-v1", baseTableHash: "a".repeat(64), observedAt: "2026-10-11T00:00:00.000Z",
        installed: [{ id: "claude", kind: "claude", command: ["/tmp/claude"], recordedVersion: "2.1.282", observedVersion: null, realpath: null, status: "unavailable" }] },
      preview: { schema: "orca-agent-detection-preview-v1", baseTableHash: "a".repeat(64), observedAt: "2026-10-11T00:00:00.000Z", previewId: "preview-1",
        installed: [{ id: "claude", kind: "claude", command: ["/tmp/claude"], recordedVersion: "2.1.282", observedVersion: null, realpath: null, status: "unavailable" }],
        changes: [{ changeId: "version-1", kind: "version", installationId: "claude", command: ["/tmp/claude"], realpath: "/tmp/claude", version: "2.1.283" },
          { changeId: "path-1", kind: "path", installationId: "codex", command: ["/tmp/codex"], realpath: "/tmp/codex", version: "0.2" }] },
    };
    render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} onApplyUpdates={onApply} />);
    expect(screen.getByText(/unavailable/)).toBeDefined();
    const apply = screen.getByRole("button", { name: "Apply selected changes" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Version: claude/));
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(["version-1"]);
  });
  it("offers an explicit retained-result check for a pending update without offering a new apply", () => {
    const onRetry = vi.fn();
    const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: true, failureCode: "control-peer-timeout", observation: null, preview: null,
      pendingCommand: { schema: "orca-raw-command-v1", commandId: "retained-1", expectedRevision: 0, actorId: "operator-1", verb: "apply-agent-update", target: { kind: "operator", operatorId: "operator-1" },
        payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["choice-1"] } } };
    render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} onRetryPendingUpdate={onRetry} />);
    expect(screen.getByText("retained-1")).toBeDefined();
    expect((screen.getByRole("button", { name: "Detect again" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Apply selected changes" })).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check retained result" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("shows each resolved symlink target and the full addition configuration before acceptance", () => {
    const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null,
      failureCode: null, observation: null, preview: { schema: "orca-agent-detection-preview-v1", previewId: "preview-paths", baseTableHash: "a".repeat(64),
        observedAt: "2026-10-11T00:00:00.000Z", installed: [], changes: [
          { changeId: "path-a", kind: "path", installationId: "claude", command: ["/tmp/claude-link"], realpath: "/opt/claude-A", version: "2" },
          { changeId: "path-b", kind: "path", installationId: "claude", command: ["/tmp/claude-link"], realpath: "/opt/claude-B", version: "2" },
          { changeId: "add-c", kind: "addition", installationId: "codex", command: ["/tmp/codex", "--custom"], realpath: "/opt/codex", version: "3",
            installation: { kind: "codex", command: ["/tmp/codex", "--custom"], version: "3", configDir: "/tmp/codex-config", timeoutMs: 1234, killGraceMs: 77, sandbox: "workspace-write", budgetMode: "soft" } },
          { changeId: "add-missing", kind: "addition", installationId: "unreviewable", command: ["/tmp/unknown"], realpath: "/opt/unknown", version: "4" },
        ] } };
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} />);
    expect(container.textContent).toContain("/opt/claude-A");
    expect(container.textContent).toContain("/opt/claude-B");
    expect(container.textContent).toContain("/opt/codex");
    expect(container.textContent).toContain('"configDir": "/tmp/codex-config"');
    expect(container.textContent).toContain('"timeoutMs": 1234');
    expect(container.textContent).toContain('"--custom"');
    expect((screen.getByLabelText(/New installation: unreviewable/) as HTMLInputElement).disabled).toBe(true);
  });
  it("clears draft model and context when changing the role Agent", async () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): choosing another agent sends it and clears the model and context drafts
    const onDraft = vi.fn();
    render(<SelectionFields agents={agents} prefix="role" label="Role" current={{ agent: "claude", model: "A-m", contextWindow: 1_000_000 }}
      inheritedAgent="claude" drafts={{ "role:model": "typed-A", "role:context": "1000000" }} onDraft={onDraft} />);
    await pickOption(screen.getByRole("combobox", { name: /^agent/ }), "codex (codex 0.155.1)");
    expect(onDraft.mock.calls).toEqual([["role:agent", "codex"], ["role:model", CLEARED_DRAFT], ["role:context", CLEARED_DRAFT]]);
  });
  it("keeps a model-only role override with its old primary Agent when the primary changes", () => {
    const withRole: AgentPreferencesViewV1 = { ...preferences, preferences: { ...preferences.preferences, estimator: { model: "A-estimate" } } };
    expect(preferencesFromDrafts(agents, withRole, { "agents:default-agent": "codex" }).estimator)
      .toEqual({ agent: "claude", model: "A-estimate" });
  });
  it("keeps a valid old-Agent context role saveable when the new primary has different context options", () => {
    const withRole: AgentPreferencesViewV1 = { ...preferences, preferences: { ...preferences.preferences, estimator: { contextWindow: 1_000_000 } } };
    const onSave = vi.fn();
    render(<AgentSettings agents={agents} preferences={withRole} drafts={{ "agents:default-agent": "codex" }} onDraft={vi.fn()} onSave={onSave} />);
    expect((screen.getByRole("button", { name: "Save agent preferences" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save agent preferences" }));
    expect(onSave.mock.calls[0]![0].estimator).toEqual({ agent: "claude", contextWindow: 1_000_000 });
  });
  it("places the primary Agent, model and context together and folds role overrides", () => {
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    const primary = container.querySelector('[aria-label="Primary Agent"]') as HTMLElement;
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the default-agent picker, the model box and the context picker all sit in the Primary block
    expect(defaultAgentField(primary)).toBeTruthy();
    expect(primary.querySelector('input[name="agents:per:claude:model"]')).not.toBeNull();
    expect(agentField(primary, "agents:per:claude", "context")).toBeTruthy();
    expect((container.querySelector('[data-role-overrides]') as HTMLDetailsElement).open).toBe(false);
  });
  it("keeps an unsupported context draft visible and prevents a lossy preferences save", () => {
    const onSave = vi.fn();
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{ "agents:per:codex:context": "1000000" }} onDraft={vi.fn()} onSave={onSave} />);
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the unsupported draft stays shown in the codex context picker
    expect(shownText(agentField(container, "agents:per:codex", "context"))).toBe("1000000");
    expect((screen.getByRole("button", { name: "Save agent preferences" }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/context/i);
  });
  it("lists every installation from the table view with its version and its defaults", () => {
    const html = renderToStaticMarkup(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    for (const text of ["claude", "2.1.282", "claude-opus-5-5", "codex", "0.155.1", "gpt-6-sol", "preferences revision 4"]) expect(html).toContain(text);
  });

  it("offers each agent's context as a dropdown over that agent's own options, and no free text box for any context", async () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): each layer's context picker offers inherit plus exactly its agent's options, in order; five pickers, no box
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    const options = async (prefix: string): Promise<string[]> => (await optionsOf(agentField(container, prefix, "context"))).map(([name]) => name);
    expect(await options("agents:per:claude")).toEqual(["inherit", "agent default", "1000000 tokens"]);
    expect(await options("agents:per:codex")).toEqual(["inherit", "agent default"]);
    // The estimator slot names no agent of its own, so it offers what the default agent (claude) can express.
    expect(await options("agents:estimator")).toEqual(["inherit", "agent default", "1000000 tokens"]);
    // Checks spec 2026-10-22 §6.1 (Task 10): the review slot is a fifth context dropdown, like the estimator's.
    expect(await options("agents:review")).toEqual(["inherit", "agent default", "1000000 tokens"]);
    expect([...container.querySelectorAll("fieldset")].map((set) => set.querySelector('input[name$=":model"]')!.getAttribute("name")!.replace(/:model$/, ""))
      .map((prefix) => agentField(container, prefix, "context"))).toHaveLength(5);
    expect(container.querySelectorAll('input[name$=":context"]')).toHaveLength(0);
  });

  it("sends the preferences the drafts describe, under the revision the page was read at", () => {
    const onSave = vi.fn();
    render(<AgentSettings agents={agents} preferences={preferences} onDraft={vi.fn()} onSave={onSave} drafts={{
      "agents:default-agent": "codex", "agents:per:claude:context": "1000000",
      "agents:reconcile:agent": "claude", "agents:reconcile:model": "claude-opus-5-5",
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save agent preferences" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      defaultAgent: "codex",
      perAgent: { claude: { model: "claude-fable-5", contextWindow: 1_000_000 } },
      reconcile: { agent: "claude", model: "claude-opus-5-5" },
    }, 4);
  });

  it("leaves a field unset when its box is emptied, and drops a context the agent cannot express, rather than sending either", () => {
    expect(preferencesFromDrafts(agents, preferences, {
      "agents:per:claude:model": "", "agents:default-agent": "", "agents:per:codex:context": "1000000",
    })).toEqual({ perAgent: {} });
  });

  // The page's drafts live in the control reducer, which forgets a draft whose text is "" (the budget
  // editor's boxes fall back to the server value that way). Emptying an agent field must still read as
  // "unset at this layer", or a model or default agent the operator set once could never be taken back.
  it("clears a saved model and the default agent through the panel's own draft store", async () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): choosing "none" for the default agent clears it through the draft store and the save sends no defaultAgent
    const onSave = vi.fn();
    function Page(): JSX.Element {
      const [state, dispatch] = useReducer(reduceControlState, undefined, initialControlState);
      return <AgentSettings agents={agents} preferences={preferences} drafts={state.drafts} onDraft={(key, text) => dispatch({ type: "draft", key, text })} onSave={onSave} />;
    }
    const { container } = render(<Page />);
    const model = container.querySelector('input[name="agents:per:claude:model"]') as HTMLInputElement;
    const defaultAgent = defaultAgentField(container);
    expect(model.value).toBe("claude-fable-5");
    expect(shownText(defaultAgent)).toBe("claude");
    fireEvent.change(model, { target: { value: "" } });
    await pickOption(defaultAgent, "none (every group has to choose one)");
    expect(model.value).toBe("");
    expect(shownText(defaultAgentField(container))).toBe("none (every group has to choose one)");
    fireEvent.click(screen.getByRole("button", { name: "Save agent preferences" }));
    expect(onSave).toHaveBeenCalledWith({ perAgent: {} } satisfies OperatorPreferencesV1, 4);
  });

  // ccloop error codes spec (2026-10-15) §4.6: the installation panel explains ccloop's code beside it.
  it("explains a failed detection's ccloop code", () => {
    const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, failureCode: "agent-config-invalid", observation: null, preview: null };
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} />);
    expect(container.textContent).toContain("Detection unavailable · agent-config-invalid The agent's configuration is not valid.");
  });

  // Controller ruling on A7 (plan R3): an unknown code's explanation is the code itself, so it is shown once.
  it("shows a failed detection's unknown ccloop code once", () => {
    const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, failureCode: "omp-new-thing", observation: null, preview: null };
    render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} />);
    expect(screen.getByText(/omp-new-thing/).textContent).toBe("Detection unavailable · omp-new-thing");
  });
});
