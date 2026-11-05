// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { AgentSettings } from "../src/AgentSettings.js";
import type { AgentPreferencesViewV1, AgentsViewV1 } from "../src/controlTypes.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const UNTIL = Date.UTC(2026, 10, 5, 16, 12), SINCE = Date.UTC(2026, 10, 5, 12, 0);
const local = (at: number): string => new Date(at).toLocaleString();

/** Quota failover spec §3 "Show": the agents page lists each resting installation -- since, until, why -- read-only. */
describe("the agents page lists resting installations (§3 Show)", () => {
  const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { perAgent: {} } };
  const agents = (rests?: AgentsViewV1["rests"]): AgentsViewV1 => ({ schema: "orca-agents-view-v1", installations: [
    { id: "codex", kind: "codex", version: "1.0", defaults: { model: "gpt-x", contextWindow: "agent-default" }, contextOptions: ["agent-default"] },
  ], ...(rests === undefined ? {} : { rests }) });

  it("names the installation, until, since, the source and the CLI's text, in English and Chinese", async () => {
    const rests = [{ installation: "codex", until: UNTIL, since: SINCE, source: "vendor" as const, detail: "try again at 16:12" }];
    const { container, unmount } = render(<AgentSettings agents={agents(rests)} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    const rows = () => [...container.querySelectorAll('[data-testid="agent-rest"]')].map((node) => node.textContent?.trim());
    expect(rows()).toEqual([`codex rests until ${local(UNTIL)} (since ${local(SINCE)}) · until the reset time its CLI named try again at 16:12`]);
    expect(container.querySelector('section[aria-label="Quota rests"]')).not.toBeNull();
    unmount();
    await i18n.changeLanguage("zh");
    const zh = render(<AgentSettings agents={agents([{ ...rests[0]!, source: "default", detail: null }])} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    expect([...zh.container.querySelectorAll('[data-testid="agent-rest"]')].map((node) => node.textContent?.trim())).toEqual([`codex 休息到 ${local(UNTIL)}（自 ${local(SINCE)} 起） · 默认休息时长：它的 CLI 没有给出恢复时间`]);
  });

  it("shows no rest section when none rests", () => {
    const { container } = render(<AgentSettings agents={agents()} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    expect(container.querySelector('[data-testid="agent-rest"]')).toBeNull();
    expect(container.textContent).not.toContain("Quota rests");
  });
});
