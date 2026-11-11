// @vitest-environment jsdom
/**
 * Issue #221: Settings -> Agent folds to one row, and that row said only "Agents" -- a person had to open it to learn which
 * agent and model work runs on. The row now says the default in force (the saved preferences, not an unsaved draft): the
 * default agent and its model -- the operator's model for that agent, else the installation's own default. And the page's
 * one main action is saving (web/DESIGN.md: one primary per view).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { AgentSettings } from "../src/AgentSettings.js";
import type { AgentPreferencesViewV1, AgentsViewV1, OperatorPreferencesV1 } from "../src/controlTypes.js";
afterEach(cleanup);

const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [
    { id: "claude", kind: "claude", defaults: { model: "install-default", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
    { id: "codex", kind: "codex", defaults: { model: "codex-default", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
  ],
};
const mount = (preferences: OperatorPreferencesV1, drafts: Record<string, string> = {}) => {
  const view: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "op", revision: 1, preferences };
  const { container } = render(<AgentSettings agents={agents} preferences={view} drafts={drafts} onDraft={vi.fn()} onSave={vi.fn()} />);
  return container.querySelector("details > summary")!.textContent ?? "";
};

describe("the Agents row says the default in force (#221)", () => {
  // mutation: the summary shows the title only -> red
  it("names the default agent and the installation's model when the operator chose none", () => {
    expect(mount({ defaultAgent: "claude", perAgent: {} })).toContain("Default: claude · install-default");
  });

  // mutation: the model reads the installation's default whatever the operator chose -> red
  it("names the operator's model for the default agent before the installation's", () => {
    expect(mount({ defaultAgent: "claude", perAgent: { claude: { model: "op-model" }, codex: { model: "other" } } })).toContain("Default: claude · op-model");
  });

  it("says no default agent is set when there is none", () => {
    const summary = mount({ perAgent: { claude: { model: "op-model" } } });
    expect(summary).toContain("No default agent");
    expect(summary).not.toContain("Default:");
  });
});

describe("Save is the Agents page's one primary (DESIGN.md)", () => {
  // mutation: Save is not given btn-primary -> no primary -> red
  it("fills Save agent preferences and nothing else", () => {
    mount({ defaultAgent: "claude", perAgent: {} });
    expect([...document.querySelectorAll(".btn-primary")].map((button) => button.textContent)).toEqual(["Save agent preferences"]);
  });
});
