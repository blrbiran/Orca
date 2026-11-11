// @vitest-environment jsdom
/**
 * Issue #220: App hands the operator's agent preferences to the Requirements section, so "Your default" on the New
 * requirement form names the agent and model the server will resolve (web/src/requirementAgent.ts).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "e-1", dispatchBlocked: false, blockers: [] };
const summary: ControlSummaryV1 = summaryWith(requirementView("awaiting-answers"));
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/projects") return json({ projects: [{ projectKey: "repo", controlRepoId: "repo" }] });
    if (url === "/api/control/config") return json(config);
    if (url.startsWith("/api/control/summary")) return json(summary);
    if (url === "/api/control/recovery") return json(recovery);
    if (url === "/api/control/agents") return json({ schema: "orca-agents-view-v1", installations: [
      { id: "my-claude", kind: "claude", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
    ] });
    if (url === "/api/control/operator/agent-preferences") {
      return json({ schema: "orca-agent-preferences-v1", operatorId: "op", revision: 0, preferences: { defaultAgent: "my-claude", perAgent: { "my-claude": { model: "opus-x" } } } });
    }
    return json({ error: { code: "not-here", message: url } }, 404);
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
  window.sessionStorage.clear();
});

describe("App passes the operator's agent preferences to Requirements (#220)", () => {
  // mutation: App does not pass `preferences` to RequirementsPanel -> no default line -> red
  it("shows the default agent and the operator's model for it on the New requirement form", async () => {
    window.location.hash = "#requirements";
    render(<App />);
    const form = await screen.findByRole("form", { name: "New requirement" });
    expect(await within(form).findByText("Your default: my-claude · opus-x")).toBeTruthy();
  });
});
