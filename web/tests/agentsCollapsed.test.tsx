// @vitest-environment jsdom
/**
 * Integration/panel-fixes spec §9.2 item 4. The Agents section is a <details> folded by default; the open state is
 * kept in localStorage "orca.panel.agentsOpen", and every storage access is guarded so a throwing localStorage
 * still renders (collapsed).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { AgentSettings } from "../src/AgentSettings.js";
import type { AgentPreferencesViewV1, AgentsViewV1 } from "../src/controlTypes.js";

const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [{ id: "claude", kind: "claude", defaults: { model: "m", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" }],
};
const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "op", revision: 1, preferences: { perAgent: {} } };
const KEY = "orca.panel.agentsOpen";
const ui = <AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />;
const details = (c: HTMLElement): HTMLDetailsElement => c.querySelector("details") as HTMLDetailsElement;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Agents section folded by default (spec §9.2 item 4)", () => {
  it("is a <details> without open on first render", () => {
    const { container } = render(ui);
    expect(details(container)).not.toBeNull();
    expect(details(container).open).toBe(false);
  });

  it("writes the open state on toggle and a fresh render reads it", () => {
    const first = render(ui);
    const d = details(first.container);
    d.open = true;
    d.dispatchEvent(new Event("toggle"));
    expect(localStorage.getItem(KEY)).toBe("1");
    first.unmount();
    expect(details(render(ui).container).open).toBe(true);
  });

  it("stores 0 when folded again", () => {
    localStorage.setItem(KEY, "1");
    const { container } = render(ui);
    details(container).open = false;
    details(container).dispatchEvent(new Event("toggle"));
    expect(localStorage.getItem(KEY)).toBe("0");
  });

  it("still renders, collapsed, when localStorage throws on read and on write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    const { container } = render(ui);
    expect(details(container).open).toBe(false);
    details(container).open = true;
    expect(() => details(container).dispatchEvent(new Event("toggle"))).not.toThrow();
  });
});
