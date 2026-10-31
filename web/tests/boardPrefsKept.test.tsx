// @vitest-environment jsdom
/**
 * Tester #91: the Board unmounts when hidden (its cards would duplicate Task control's buttons), so a person who opened a
 * card and came back found the columns again and the archived box cleared. The two choices now outlive the unmount.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { config, view } from "./fixtures/board.js";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const groupView = view([]);
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [groupView.summary] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

beforeEach(() => {
  window.location.hash = "#board";
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/control/config") return json(config);
    if (url.startsWith("/api/control/summary")) return json(summary);
    if (url === "/api/control/recovery") return json(recovery);
    if (url === "/api/projects") return json({ projects: [{ projectKey: "orca", controlRepoId: "orca" }] });
    if (url === `/api/control/groups/${groupView.summary.groupId}`) return json(groupView);
    return json({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); window.location.hash = ""; window.sessionStorage.clear(); vi.restoreAllMocks(); });

const boardRegion = async (): Promise<ReturnType<typeof within>> => within(await screen.findByRole("region", { name: "Board" }));
/** Open a card (the Board unmounts), then go Back the way a person does. */
const leaveByCardAndComeBack = async (): Promise<void> => {
  fireEvent.click(await screen.findByTestId(`board-card-${groupView.summary.groupId}`).then((card) => within(card).getAllByRole("button")[0]!));
  await screen.findByRole("region", { name: `Control group ${groupView.summary.groupId}` });
  expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
  window.location.hash = "#board";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};
const leaveAndComeBack = async (): Promise<void> => {
  window.location.hash = "#overview";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await vi.waitFor(() => expect(screen.queryByRole("region", { name: "Board" })).toBeNull());
  window.location.hash = "#board";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

describe("the Board keeps its view through an unmount (tester #91)", () => {
  // mutation: App stops passing prefs -> each return starts from the columns with Archived unticked -> red
  it("keeps the archived box after a card was opened and Back pressed", async () => {
    render(<App />);
    fireEvent.click((await boardRegion()).getByRole("checkbox", { name: "Show archived" }));
    await leaveByCardAndComeBack();
    expect(((await boardRegion()).getByRole("checkbox", { name: "Show archived" }) as HTMLInputElement).checked).toBe(true);
    expect((await boardRegion()).getByRole("region", { name: "Archived" })).toBeTruthy();
  });

  it("keeps Graph after leaving and coming back", async () => {
    render(<App />);
    fireEvent.click((await boardRegion()).getByRole("button", { name: "Group graph" }));
    await leaveAndComeBack();
    expect((await boardRegion()).getByRole("button", { name: "Group graph" }).getAttribute("aria-pressed")).toBe("true");
  });
});
