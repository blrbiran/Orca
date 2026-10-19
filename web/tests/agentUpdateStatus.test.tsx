// @vitest-environment jsdom
/**
 * Issue #72 (UI part): an installation row whose update detection found nothing showed its status through the
 * `agents.updates.unavailable` string, whose `{{code}}` the row never fills (the row carries no failure code), so the
 * page read "Detection unavailable · {{code}}". The row status reads as words, in both languages.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { AgentSettings } from "../src/AgentSettings.js";
import type { AgentInstallationStateV1, AgentPreferencesViewV1, AgentsViewV1 } from "../src/controlTypes.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [{ id: "omp", kind: "omp", defaults: { model: "p/m", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1.0.0" }],
};
const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { defaultAgent: "omp", perAgent: {} } };
const state: AgentInstallationStateV1 = {
  schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, failureCode: null, preview: null,
  observation: { schema: "orca-agent-detection-observation-v1", baseTableHash: "a".repeat(64), observedAt: "2026-10-19T00:00:00.000Z",
    installed: [{ id: "omp", kind: "omp", command: ["/tmp/omp"], recordedVersion: "1.0.0", observedVersion: null, realpath: null, status: "unavailable" }] },
};

it.each([["en", "omp: 1.0.0 → unavailable (not detected)"], ["zh", "omp: 1.0.0 → 不可用 (未检测到)"]] as const)("an unavailable row reads without a placeholder in %s", async (language, line) => {
  await i18n.changeLanguage(language);
  render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} />);
  const region = screen.getByRole("region", { name: i18n.t("agents.updates.title") });
  expect(region.textContent).not.toContain("{{");
  expect(region.querySelector("li")?.textContent).toBe(line);
});
