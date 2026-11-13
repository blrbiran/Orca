// @vitest-environment jsdom
/**
 * Tester #77: the Board said "not available" during every first load, because a null recovery also means "not read yet".
 * A load in progress is neutral; "not available" comes only after a failed read, with a way to ask again.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  window.location.hash = "#board";
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
/** The Board's own pane: the hidden Task control pane has a line of its own that this item does not change. */
const board = () => within(document.querySelector('[data-section="board"]') as HTMLElement);

describe("the Board's first load (tester #77)", () => {
  // mutation: the loading branch says control.unavailable -> the false alarm the tester reported -> red
  it("reads neutrally while the first load has not finished, and never says not available", async () => {
    answerConfig = () => new Promise(() => undefined);
    render(<App />);
    expect(await screen.findByText("Reading the board…")).toBeTruthy();
    expect(board().queryByText(NOT_AVAILABLE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  // mutation: setControlConfigFailed(true) is dropped -> a failed read shows "Reading the board…" for ever -> red
  it("says not available after the config read failed, and Try again brings the Board up", async () => {
    answerConfig = async () => refused();
    render(<App />);
    await waitFor(() => expect(board().getByText(NOT_AVAILABLE)).toBeTruthy());
    expect(screen.queryByText("Reading the board…")).toBeNull();
    answerConfig = async () => json(config);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Board" })).toBeTruthy();
    expect(board().queryByText(NOT_AVAILABLE)).toBeNull();
  });

  // mutation: the panelRefusal test is dropped -> the config was read but the poll fails, and the page says "Reading" for ever -> red
  it("says not available when the poll after the config failed, and Try again reads it again", async () => {
    answerSummary = async () => refused();
    render(<App />);
    await waitFor(() => expect(board().getByText(NOT_AVAILABLE)).toBeTruthy());
    answerSummary = async () => json(summary);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Board" })).toBeTruthy();
  });
});

describe("a refused summary (tester #298)", () => {
  it("still reads recovery, and the Tasks pane says not available with the refusal that names the run, and Try again", async () => {
    let recoveryReads = 0;
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input) === "/api/control/recovery") recoveryReads++;
      return base(input);
    }) as typeof fetch;
    answerSummary = async () => json({ error: { code: "recovery-blocked", message: "recovery-blocked:run-invalid:run-1:bad", commandRevision: null, evidenceIds: [], retryable: false } }, 423);
    window.location.hash = "#tasks";
    render(<App />);
    // mutation: read recovery back inside the summary's try in readControlTick -> never asked for after a refused summary, red
    await waitFor(() => expect(recoveryReads).toBeGreaterThan(0));
    const tasks = within(document.querySelector('[data-section="tasks"]') as HTMLElement);
    await waitFor(() => expect(tasks.getByText(NOT_AVAILABLE)).toBeTruthy());
    // mutation: drop the RefusalNotice from controlLoadState -> the pane says only "not available", red
    expect(tasks.getByTestId("control-load-refusal").textContent).toContain("recovery-blocked");
    expect(tasks.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
