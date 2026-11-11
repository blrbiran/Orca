// @vitest-environment jsdom
/**
 * Tasks and Requirements read the control plane like the Board does (tester #77): while the first read is in flight, the
 * Tasks pane said "The task control plane is not available on this panel." and Requirements rendered nothing. A load in
 * progress is neutral; "not available" comes only after a failed read, with a way to ask again.
 */
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { config, view } from "./fixtures/board.js";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = (): Response => json({ error: { code: "panel-down", message: "down", commandRevision: null, evidenceIds: [], retryable: false } }, 503);
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [view([]).summary] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

let answerConfig: () => Promise<Response>;
let answerSummary: () => Promise<Response>;

beforeEach(() => {
  answerConfig = async () => json(config);
  answerSummary = async () => json(summary);
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/control/config") return answerConfig();
    if (url.startsWith("/api/control/summary")) return answerSummary();
    if (url === "/api/control/recovery") return json(recovery);
    if (url === "/api/projects") return json({ projects: [{ projectKey: "orca", controlRepoId: "orca" }] });
    return refused();
  }) as typeof fetch;
});
afterEach(() => { cleanup(); window.location.hash = ""; window.sessionStorage.clear(); vi.restoreAllMocks(); });

const NOT_AVAILABLE = "The task control plane is not available on this panel.";
const LOADING = "Reading task control…";
const pane = (section: string) => within(document.querySelector(`[data-section="${section}"]`) as HTMLElement);

describe.each([
  { section: "tasks", ready: () => pane("tasks").findByRole("region", { name: "Task control" }) },
  { section: "requirements", ready: () => pane("requirements").findByRole("region", { name: "Requirements" }) },
])("the $section pane's first load", ({ section, ready }) => {
  // mutation: the pane's loading branch is removed (Tasks says not available, Requirements renders nothing) -> red
  it("reads neutrally while the first load has not finished, and never says not available", async () => {
    window.location.hash = `#${section}`;
    answerConfig = () => new Promise(() => undefined);
    render(<App />);
    expect(await pane(section).findByRole("status")).toHaveProperty("textContent", LOADING);
    expect(pane(section).queryByText(NOT_AVAILABLE)).toBeNull();
    expect(pane(section).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  // mutation: the failed branch shows the loading line instead -> a failed read reads "Reading…" for ever -> red
  it("says not available after the config read failed, and Try again brings the pane up", async () => {
    window.location.hash = `#${section}`;
    answerConfig = async () => refused();
    render(<App />);
    await waitFor(() => expect(pane(section).getByText(NOT_AVAILABLE)).toBeTruthy());
    expect(pane(section).queryByText(LOADING)).toBeNull();
    answerConfig = async () => json(config);
    fireEvent.click(pane(section).getByRole("button", { name: "Try again" }));
    expect(await ready()).toBeTruthy();
    expect(pane(section).queryByText(NOT_AVAILABLE)).toBeNull();
  });

  it("says not available when the poll after the config failed, and Try again reads it again", async () => {
    window.location.hash = `#${section}`;
    answerSummary = async () => refused();
    render(<App />);
    await waitFor(() => expect(pane(section).getByText(NOT_AVAILABLE)).toBeTruthy());
    answerSummary = async () => json(summary);
    fireEvent.click(pane(section).getByRole("button", { name: "Try again" }));
    expect(await ready()).toBeTruthy();
  });
});
