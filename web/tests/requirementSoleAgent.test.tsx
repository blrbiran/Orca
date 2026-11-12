// @vitest-environment jsdom
/**
 * #246 (human: 「#246 => 同意」): with no defaultAgent and exactly one installed agent, requirement-open runs on that agent
 * (src/control/agentSelection.ts soleInstalledAgent). The New requirement form's "Your default" line says so instead of
 * "No default agent is set"; with two installed it still asks for a pick.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { AgentsViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
afterEach(cleanup);

const row = (id: string, model: string): AgentsViewV1["installations"][number] =>
  ({ id, kind: "codex", defaults: { model, contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" });

function form(installations: AgentsViewV1["installations"]): HTMLElement {
  const view = requirementView("failed");
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={{ schema: "orca-agents-view-v1", installations }}
    language="en" onSelect={vi.fn()} onCommand={vi.fn()} models={() => undefined} onModels={vi.fn()} preferences={{ perAgent: {} }} />);
  const shown = screen.getByRole("form", { name: "New requirement" });
  fireEvent.change(within(shown).getByRole("textbox", { name: "Idea" }), { target: { value: "Investigate" } });
  return shown;
}

describe("'Your default' names the one installed agent (#246)", () => {
  it("one installed and no defaultAgent: names that agent and its model", () => {
    const shown = form([row("only-coder", "gpt-x")]);
    expect(shown.textContent).toContain("Your default: only-coder · gpt-x");
    expect(shown.textContent).not.toContain("No default agent is set");
  });

  it("two installed and no defaultAgent: still asks for a pick", () => {
    const shown = form([row("one", "m1"), row("two", "m2")]);
    expect(shown.textContent).toContain("No default agent is set");
  });
});
