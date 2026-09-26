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
import { initialControlState, reduceControlState } from "../src/controlState.js";
import type { AgentPreferencesViewV1, AgentsViewV1, OperatorPreferencesV1 } from "../src/controlTypes.js";

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
  it("lists every installation from the table view with its version and its defaults", () => {
    const html = renderToStaticMarkup(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    for (const text of ["claude", "2.1.282", "claude-opus-5-5", "codex", "0.155.1", "gpt-6-sol", "preferences revision 4"]) expect(html).toContain(text);
  });

  it("offers each agent's context as a dropdown over that agent's own options, and no free text box for any context", () => {
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    const options = (name: string): string[] => [...container.querySelectorAll(`select[name="${name}"] option`)].map((option) => (option as HTMLOptionElement).value);
    expect(options("agents:per:claude:context")).toEqual(["", "agent-default", "1000000"]);
    expect(options("agents:per:codex:context")).toEqual(["", "agent-default"]);
    // The estimator slot names no agent of its own, so it offers what the default agent (claude) can express.
    expect(options("agents:estimator:context")).toEqual(["", "agent-default", "1000000"]);
    expect(container.querySelectorAll('select[name$=":context"]')).toHaveLength(4);
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
  it("clears a saved model and the default agent through the panel's own draft store", () => {
    const onSave = vi.fn();
    function Page(): JSX.Element {
      const [state, dispatch] = useReducer(reduceControlState, undefined, initialControlState);
      return <AgentSettings agents={agents} preferences={preferences} drafts={state.drafts} onDraft={(key, text) => dispatch({ type: "draft", key, text })} onSave={onSave} />;
    }
    const { container } = render(<Page />);
    const model = container.querySelector('input[name="agents:per:claude:model"]') as HTMLInputElement;
    const defaultAgent = container.querySelector('select[name="agents:default-agent"]') as HTMLSelectElement;
    expect(model.value).toBe("claude-fable-5");
    fireEvent.change(model, { target: { value: "" } });
    fireEvent.change(defaultAgent, { target: { value: "" } });
    expect(model.value).toBe("");
    expect(defaultAgent.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save agent preferences" }));
    expect(onSave).toHaveBeenCalledWith({ perAgent: {} } satisfies OperatorPreferencesV1, 4);
  });
});
