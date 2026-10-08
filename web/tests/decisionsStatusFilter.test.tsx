// @vitest-environment jsdom
/**
 * Integration-and-panel-fixes spec §9.2(1): the Decisions pane's status filter. Unreviewed is the default and is
 * today's list (/api/todo, so the existing criteria over that list keep meaning what they meant); Reviewed is every
 * decision with a `reviewed` row, any tier; All is every listed decision. Both come from /api/decisions. A decision
 * opened from any filter shows the correction form, and a second correction meets the server's refusal.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { rowsForStatus } from "../src/DecisionsView.js";
import i18n from "../src/i18n.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

type StatusRow = DecisionListRow & { reviewed: boolean; highTier: boolean };
const row = (id: string, over: Partial<StatusRow>): StatusRow => ({
  projectKey: "proj", id, at: "2026-09-16T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok",
  question: null, reviewed: false, highTier: true, ...over,
});
const OPEN = row("run/1", {});
const REVIEWED_HIGH = row("run/2", { reviewed: true });
const REVIEWED_LOW = row("run/3", { reviewed: true, highTier: false, scope: "file" });
const UNREVIEWED_LOW = row("run/4", { highTier: false, scope: "file" });
const FULL = [OPEN, REVIEWED_HIGH, REVIEWED_LOW, UNREVIEWED_LOW];
const TODO = [OPEN];

const REPORT = {
  as_of: "2026-09-16T00:00:00.000Z", as_of_mode: "wall_clock", repos: [],
  correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] },
  repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" },
  excluded_as_future: 0, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [],
} as unknown as MetricsReport;
const COVERAGE: PanelCoverage = { reviewed_high_tier: 1, high_tier_total: 2, rate: 0.5, caveat: "c" };

const ALREADY = {
  code: "correction-already-recorded",
  message: "You already recorded a correction on this decision. If you mean to record a second, separate one, choose \"record another\".",
  retry_field: "again",
};
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let requested: string[] = [];
let posted: Array<Record<string, unknown>> = [];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  requested = [];
  posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith("/api/todo")) return json({ rows: TODO });
    if (url.startsWith("/api/decisions")) return json({ rows: FULL });
    if (url.startsWith("/api/metrics")) return json({ report: REPORT, panel_review_coverage: COVERAGE });
    if (url.startsWith("/api/corrections")) {
      posted.push(JSON.parse(String(init?.body ?? "null")));
      return json(ALREADY, 409);
    }
    if (url.startsWith("/api/decision")) {
      const id = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("decisionId") ?? "";
      return json({ decision: { id, question: `question of ${id}`, chose: "c", because: "b", alternatives: [] } });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});
afterEach(cleanup);

const listed = (): string[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".decision-list li button")).map((b) => b.textContent ?? "");
const status = (): HTMLSelectElement => document.querySelector<HTMLSelectElement>('select[name="filter-status"]')!;
const ids = (rows: readonly DecisionListRow[]): string[] => rows.map((r) => r.id);

async function openHome(): Promise<void> {
  render(<App />);
  await screen.findByText("Unreviewed high-tier decisions");
}

describe("rowsForStatus (spec §9.2(1))", () => {
  it("Unreviewed is high-tier and not reviewed; Reviewed is reviewed at ANY tier; All is every row", () => {
    expect(ids(rowsForStatus(FULL, "unreviewed"))).toEqual(["run/1"]);
    expect(ids(rowsForStatus(FULL, "reviewed"))).toEqual(["run/2", "run/3"]);
    expect(ids(rowsForStatus(FULL, "all"))).toEqual(["run/1", "run/2", "run/3", "run/4"]);
  });
});

describe("the Decisions status filter in the page", () => {
  it("defaults to Unreviewed, lists exactly today's /api/todo rows, and does not read /api/decisions", async () => {
    await openHome();
    expect(status().value).toBe("unreviewed");
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("interface");
    expect(requested.some((u) => u.startsWith("/api/decisions"))).toBe(false);
  });

  it("Reviewed lists the reviewed decisions of any tier and none of the others", async () => {
    await openHome();
    fireEvent.change(status(), { target: { value: "reviewed" } });
    await waitFor(() => expect(listed()).toHaveLength(2));
    expect(screen.getByTestId("decision-count").textContent).toBe("2 of 2");
    expect(requested.some((u) => u.startsWith("/api/decisions"))).toBe(true);
  });

  it("All lists every decision", async () => {
    await openHome();
    fireEvent.change(status(), { target: { value: "all" } });
    await waitFor(() => expect(listed()).toHaveLength(4));
  });

  it("says so, in the status' own words, when Reviewed has nothing -- not that every decision has been reviewed", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      String(input).startsWith("/api/decisions") ? json({ rows: [OPEN, UNREVIEWED_LOW] }) : real(input, init)) as typeof fetch;
    await openHome();
    fireEvent.change(status(), { target: { value: "reviewed" } });
    expect((await screen.findByText("No decisions in this status.")).tagName).toBe("P");
    expect(screen.queryByText(/Every high-tier decision has been reviewed/)).toBeNull();
  });

  it("opens a reviewed decision with the correction form, and a second correction shows the refusal", async () => {
    await openHome();
    fireEvent.change(status(), { target: { value: "reviewed" } });
    await waitFor(() => expect(listed()).toHaveLength(2));
    fireEvent.click(document.querySelector<HTMLButtonElement>(".decision-list li button")!);
    await screen.findByText("question of run/2");
    const because = document.querySelector<HTMLTextAreaElement>('textarea[name="because"]');
    expect(because).not.toBeNull();
    fireEvent.change(because!, { target: { value: "a second look" } });
    fireEvent.submit(document.querySelector("form.correction-form")!);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ projectKey: "proj", decisionId: "run/2" });
    // The owner's own request is shown inline under the open decision (spec §11 R3), through Refusal.
    expect((await screen.findByTestId("refusal-message")).textContent).toBe(ALREADY.message);
    expect(document.body.textContent).toContain("correction-already-recorded");
    expect(screen.getByRole("button", { name: /record another/i })).not.toBeNull();
  });
});
