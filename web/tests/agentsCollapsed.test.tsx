// @vitest-environment jsdom
/**
 * Issue #221. The Agents section is a <details> shown open on a first visit -- it is the only place to set each agent's
 * model, and a folded "Agent" row read as an empty page. Folding it is remembered in localStorage "orca.panel.agentsOpen"
 * ("0"), and every storage access is guarded so a throwing localStorage still renders (open).
 *
 * Ruling: human 2026-11-10 (session 9179cdad, #218/#221 question: 「两条都允许」) -- this criterion was "folded by default"
 * (integration/panel-fixes spec §9.2 item 4); it now pins open-by-default with the person's fold remembered.
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

describe("Agents section open on a first visit (#221)", () => {
  it("is a <details> with open on first render, its installation table in view", () => {
    const { container } = render(ui);
    expect(details(container)).not.toBeNull();
    expect(details(container).open).toBe(true);
    expect(container.querySelector("table")?.textContent).toContain("claude");
  });

  it("writes the folded state on toggle and a fresh render keeps it folded", () => {
    const first = render(ui);
    const d = details(first.container);
    d.open = false;
    d.dispatchEvent(new Event("toggle"));
    expect(localStorage.getItem(KEY)).toBe("0");
    first.unmount();
    expect(details(render(ui).container).open).toBe(false);
  });

  it("stores 1 when opened again", () => {
    localStorage.setItem(KEY, "0");
    const { container } = render(ui);
    details(container).open = true;
    details(container).dispatchEvent(new Event("toggle"));
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("still renders, open, when localStorage throws on read and on write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    const { container } = render(ui);
    expect(details(container).open).toBe(true);
    // jsdom reports a throwing listener to window "error" instead of rethrowing, so observe that channel.
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent): void => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener("error", onError);
    vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    details(container).open = false;
    details(container).dispatchEvent(new Event("toggle"));
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    expect(details(container).open).toBe(false);
  });
});
