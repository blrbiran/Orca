// @vitest-environment jsdom
/**
 * Taste refinement P1-3: the decision review loop in the App -- after a successful Agree the next row opens once the
 * reviewed one has left the list, j/k/a/c work on the Decisions pane only, never from inside a field and never twice
 * for an Agree still in flight, and a "reviewed this session" count. The render/fetch harness follows
 * web/tests/decisionsI18n.test.tsx ("says each recorded outcome in Chinese ...").
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { App } from "../src/App.js";
import type { Decision } from "../src/DecisionDetail.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

const QUESTION_A = "question A";
const QUESTION_B = "question B";
const QUESTION_C = "question C";
const row = (id: string, question: string): DecisionListRow =>
  ({ projectKey: "github.com/x/y", id, at: "2026-10-01T00:00:00.000Z", kind: "reconcile", scope: "cross-repo", verdict: "ok", question }) as DecisionListRow;
const A = row("A", QUESTION_A);
const B = row("B", QUESTION_B);
const C = row("C", QUESTION_C);
const QUESTIONS: Record<string, string> = { A: QUESTION_A, B: QUESTION_B, C: QUESTION_C };
const decisionOf = (id: string): Decision => ({ id, question: QUESTIONS[id] ?? id, chose: `chose ${id}`, because: `because ${id}`, alternatives: [] });

const REPORT: MetricsReport = {
  as_of: "2026-09-16T00:00:00.000Z",
  as_of_mode: "wall_clock",
  repos: [],
  correction_rate: {
    numerator_corrections_excluding_stale: 0,
    denominator_decisions: 0,
    rate_excluding_stale: null,
    corrections_total_including_stale: 0,
    by_decision_kind: [],
    buckets: [],
    caveats: [],
  },
  repair_rate: {
    numerator_overturned: 0,
    denominator_corrections_including_stale: 0,
    rate: null,
    stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" },
    buckets: [],
    caveats: [],
  },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [],
  review_coverage: { available: false, reason: "no producer has run yet" },
  excluded_as_future: 0,
  unresolved_decisions: [],
  unkeyable_repos: [],
  malformed_lines: [],
};
const COVERAGE: PanelCoverage = { reviewed_high_tier: 0, high_tier_total: 2, rate: 0, caveat: "the coverage caveat" };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Every request the App sent, in order. */
let sent: Array<{ url: string; method: string; body: string }> = [];
const posts = (path: string): Array<{ url: string; body: string }> => sent.filter((r) => r.method === "POST" && r.url.startsWith(path));
/** When set, the next POST /api/reviews waits until the test resolves it. */
let hold: Promise<void> | null = null;
/** When true, GET /api/decision answers 500. */
let decisionFails = false;
/** GET /api/todo answers `rows` until a review is recorded, `afterReview` from then on. */
let rows: DecisionListRow[] = [A, B];
let afterReview: DecisionListRow[] = [B];

beforeEach(async () => {
  sent = [];
  hold = null;
  decisionFails = false;
  rows = [A, B];
  afterReview = [B];
  let reviewed = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    sent.push({ url, method, body: typeof init?.body === "string" ? init.body : "" });
    if (url.startsWith("/api/todo")) return json(200, { rows: reviewed ? afterReview : rows });
    if (url.startsWith("/api/metrics")) return json(200, { report: REPORT, panel_review_coverage: COVERAGE });
    if (url.startsWith("/api/decision?")) {
      if (decisionFails) return json(500, { code: "decision-read-failed", message: "the decision read failed" });
      const id = new URL(url, "http://panel").searchParams.get("decisionId") ?? "";
      return json(200, { decision: decisionOf(id) });
    }
    if (url.startsWith("/api/reviews")) {
      if (hold !== null) await hold;
      reviewed = true;
      return json(200, { recorded: true });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
  await i18n.changeLanguage("en");
  window.location.hash = "#decisions";
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const detail = (): HTMLElement => document.querySelector(".split-detail") as HTMLElement;
const question = (): string | null => within(detail()).queryByTestId("decision-question")?.textContent ?? null;

/** Render the App on Decisions and open row A. */
async function openA(): Promise<void> {
  render(<App />);
  await waitFor(() => expect(document.querySelector('[data-section="decisions"]')?.getAttribute("data-active")).toBe("true"));
  await waitFor(() => expect(document.querySelectorAll(".decision-list li button")).toHaveLength(rows.length));
  fireEvent.click(within(document.querySelector(".decision-list") as HTMLElement).getByText(QUESTION_A).closest("button")!);
  await waitFor(() => expect(question()).toBe(QUESTION_A));
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
const openRow = (q: string): void => {
  fireEvent.click(within(document.querySelector(".decision-list") as HTMLElement).getByText(q).closest("button")!);
};

describe("the decision review loop", () => {
  it("after a successful Agree, opens the next row once the reviewed one has left the list, and counts it", async () => {
    await openA();
    expect(screen.queryByTestId("reviewed-count")).toBeNull();
    fireEvent.click(within(detail()).getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe(QUESTION_B));
    expect(screen.getByTestId("reviewed-count").textContent).toBe("Reviewed this session: 1");
  });

  it("does not record a review when 'a' is pressed inside the correction textarea", async () => {
    await openA();
    const because = document.querySelector<HTMLTextAreaElement>('textarea[name="because"]')!;
    fireEvent.keyDown(because, { key: "a" });
    await settle();
    expect(posts("/api/reviews")).toHaveLength(0);
  });

  it("records an Agree with 'a', moves with 'j', and ignores both outside Decisions", async () => {
    await openA();
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe(QUESTION_B));
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(posts("/api/reviews")).toHaveLength(1));
    expect(JSON.parse(posts("/api/reviews")[0]!.body).decisionId).toBe("B");
    window.location.hash = "#metrics"; fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => expect(document.querySelector('[data-section="metrics"]')?.getAttribute("data-active")).toBe("true"));
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "k" });
    await settle();
    expect(posts("/api/reviews")).toHaveLength(1);
    expect(question()).toBe(QUESTION_B);
  });

  it("sends one Agree for a double 'a' while the first is still in flight (Review Focus 2)", async () => {
    await openA();
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "a" });
    await settle();
    expect(posts("/api/reviews")).toHaveLength(1);
    release();
    await waitFor(() => expect(question()).toBe(QUESTION_B));
    expect(posts("/api/reviews")).toHaveLength(1);
  });

  it("shows the error page instead of crashing when a read fails while Decisions is open (Review Focus 1)", async () => {
    await openA();
    decisionFails = true;
    fireEvent.click(within(document.querySelector(".decision-list") as HTMLElement).getByText(QUESTION_B).closest("button")!);
    expect((await screen.findByRole("heading", { name: "orca panel could not load" })).tagName).toBe("H1");
    expect(screen.getByTestId("error-code").textContent).toBe("decision-read-failed");
  });

  it("records one review for a second 'a' on a row whose Agree is already recorded (fix round 1)", async () => {
    await openA();
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(question()).toBe(QUESTION_B));
    fireEvent.keyDown(document.body, { key: "a" });
    // B is the last unreviewed row, so it stays open once its Agree is recorded.
    await waitFor(() => expect(within(detail()).queryByRole("status")?.textContent).toBe("Recorded as reviewed."));
    await waitFor(() => expect(document.querySelectorAll(".decision-list li button")).toHaveLength(1));
    fireEvent.keyDown(document.body, { key: "a" });
    await settle();
    expect(posts("/api/reviews")).toHaveLength(1);
    expect(screen.getByTestId("reviewed-count").textContent).toBe("Reviewed this session: 1");
  });

  it("does not move the person when they opened another row while the Agree was in flight (fix round 1)", async () => {
    rows = [A, B, C];
    afterReview = [B, C];
    await openA();
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    fireEvent.click(within(detail()).getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(posts("/api/reviews")).toHaveLength(1));
    openRow(QUESTION_C);
    await waitFor(() => expect(question()).toBe(QUESTION_C));
    release();
    await waitFor(() => expect(document.querySelectorAll(".decision-list li button")).toHaveLength(2));
    await settle();
    expect(question()).toBe(QUESTION_C);
  });

  it("puts the cursor in the correction's reason with 'c' (fix round 1)", async () => {
    await openA();
    fireEvent.keyDown(document.body, { key: "c" });
    expect(document.activeElement).toBe(document.querySelector('.section-pane[data-section="decisions"] textarea[name="because"]'));
  });

  it("goes back to the previous row with 'k' (fix round 1)", async () => {
    await openA();
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(question()).toBe(QUESTION_B));
    fireEvent.keyDown(document.body, { key: "k" });
    await waitFor(() => expect(question()).toBe(QUESTION_A));
  });

  it("does not re-open the same row when 'k' is pressed on the first row after a re-read replaced its object (final review M5)", async () => {
    await openA();
    // Leaving for Overview and coming back re-reads the todo list: same decision, fresh row objects.
    const go = async (hash: string, section: string): Promise<void> => {
      window.location.hash = hash; fireEvent(window, new HashChangeEvent("hashchange"));
      await waitFor(() => expect(document.querySelector(`[data-section="${section}"]`)?.getAttribute("data-active")).toBe("true"));
    };
    rows = rows.map((r) => ({ ...r }));
    await go("#overview", "overview");
    await settle();
    await go("#decisions", "decisions");
    await settle();
    const reads = (): number => sent.filter((r) => r.method === "GET" && r.url.startsWith("/api/decision?") && r.url.includes("decisionId=A")).length;
    const before = reads();
    fireEvent.keyDown(document.body, { key: "k" });
    await settle();
    expect(reads()).toBe(before);
    expect(question()).toBe(QUESTION_A);
  });

  it("ignores 'a' while focus is on a control outside the Decisions pane (final review M6)", async () => {
    await openA();
    const outside = Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) => b.closest('.section-pane[data-section="decisions"]') === null);
    expect(outside).toBeDefined();
    outside!.focus();
    fireEvent.keyDown(outside!, { key: "a" });
    await settle();
    expect(posts("/api/reviews")).toHaveLength(0);
  });
});

const kindFilter = (): HTMLSelectElement => document.querySelector('select[name="filter-kind"]') as HTMLSelectElement;
describe("Overview's view-all link (final review M4)", () => {
  it("resets Decisions to the unreviewed, unfiltered list it counted", async () => {
    // Four unreviewed rows, one of a different kind, so the Kind filter visibly narrows the list.
    rows = [A, B, C, { ...row("D", "question D"), kind: "interface" } as DecisionListRow];
    await openA();
    expect(document.querySelectorAll(".decision-list li button")).toHaveLength(4);
    fireEvent.change(kindFilter(), { target: { value: "interface" } });
    await waitFor(() => expect(document.querySelectorAll(".decision-list li button")).toHaveLength(1));
    window.location.hash = "#overview";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const link = await screen.findByRole("link", { name: "View all 4 decisions" });
    expect(link.getAttribute("href")).toBe("#decisions");
    fireEvent.click(link);
    // jsdom does not follow hash links on click.
    window.location.hash = "#decisions";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect((kindFilter()).value).toBe(""));
    expect(document.querySelectorAll(".decision-list li button")).toHaveLength(4);
    // The row opened before the detour is no longer open.
    expect(question()).not.toBe(QUESTION_A);
  });
});
