// @vitest-environment jsdom
/**
 * Tester #257 (spec 2026-11-11-tester-followup-e-design.md §10): the Decisions default stays "Unreviewed = high tier
 * and not reviewed". When /api/todo counts unreviewed major decisions outside the high tier for the projects in view,
 * the list says "N major decisions outside the high tier" with one action that lists them (a status of their own,
 * read from /api/decisions like Reviewed and All).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { rowsForStatus } from "../src/DecisionsView.js";
import i18n from "../src/i18n.js";
import type { DecisionListRow } from "../src/types.js";
import { shownText } from "./selectControl.js";

type StatusRow = DecisionListRow & { reviewed: boolean; highTier: boolean };
const row = (id: string, over: Partial<StatusRow>): StatusRow => ({
  projectKey: "proj", id, at: "2026-09-16T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", importance: "major",
  question: null, reviewed: false, highTier: true, ...over,
});
const OPEN = row("run/1", {});
const OUTSIDE_MAJOR = row("run/2", { highTier: false, scope: "file" });
const OUTSIDE_MINOR = row("run/3", { highTier: false, scope: "file", importance: "minor" });
const OUTSIDE_REVIEWED = row("run/4", { highTier: false, scope: "file", reviewed: true });
const FULL = [OPEN, OUTSIDE_MAJOR, OUTSIDE_MINOR, OUTSIDE_REVIEWED];
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

let counts: Record<string, number> | undefined;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  counts = { proj: 1 };
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("/api/todo")) return json(counts === undefined ? { rows: [OPEN] } : { rows: [OPEN], majorOutsideHighTier: counts });
    if (url.startsWith("/api/decisions")) return json({ rows: FULL });
    if (url.startsWith("/api/metrics")) return json({ report: { as_of: "2026-09-16T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, excluded_as_future: 0, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 1, rate: 0, caveat: "c" } });
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); window.location.hash = ""; });

const listed = (): string[] => Array.from(document.querySelectorAll<HTMLButtonElement>(".decision-list li button")).map((b) => b.textContent ?? "");
async function openDecisions(): Promise<void> {
  window.location.hash = "#decisions";
  render(<App />);
  await screen.findByText("Unreviewed high-tier decisions");
}

describe("rowsForStatus, major outside the high tier (#257)", () => {
  it("is unreviewed, outside the high tier and graded major -- nothing else", () => {
    // mutation: drop any of the three tests -> another row joins, red here
    expect(rowsForStatus(FULL, "major-outside").map((r) => r.id)).toEqual(["run/2"]);
    // The default is unchanged.
    expect(rowsForStatus(FULL, "unreviewed").map((r) => r.id)).toEqual(["run/1"]);
  });
});

describe("the Decisions page (#257)", () => {
  it("keeps the high-tier default, says how many major decisions it leaves out, and lists them on request", async () => {
    await openDecisions();
    expect(listed()).toHaveLength(1);
    // mutation: never show the note -> red here
    const note = await screen.findByText("1 major decision outside the high tier");
    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    // mutation: the action switches to All -> four rows, red here
    await waitFor(() => expect(listed()).toHaveLength(1));
    expect(listed()[0]).toContain("file");
    expect(shownText(screen.getByRole("combobox", { name: "Status" }))).toBe("Major, outside the high tier");
    expect(document.querySelector(".decisions h1")?.textContent).toBe("Unreviewed major decisions outside the high tier");
    // The note belongs to the default list only.
    expect(note.isConnected).toBe(false);
  });

  it("says nothing when there are none, or when the server does not count them", async () => {
    counts = {};
    await openDecisions();
    await new Promise((r) => setTimeout(r, 30));
    // mutation: show the note at zero -> red here
    expect(screen.queryByText(/outside the high tier/)).toBeNull();
    cleanup();
    counts = undefined;
    await openDecisions();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/outside the high tier/)).toBeNull();
  });

  it("counts every project in view, in plural, and speaks Chinese", async () => {
    counts = { proj: 2, other: 3 };
    await openDecisions();
    // mutation: count only the first project -> "2 major decisions", red here
    expect(await screen.findByText("5 major decisions outside the high tier")).toBeTruthy();
    await act(async () => { await i18n.changeLanguage("zh"); });
    expect(screen.getByText("高层级之外还有 5 条未评审的重要决策")).toBeTruthy();
    expect(screen.getByRole("button", { name: "列出它们" })).toBeTruthy();
  });
});
