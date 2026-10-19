// @vitest-environment jsdom
/**
 * Decisions review withdraw spec §7 / §10.1 (plan Task 6): the detail pane shows who has the decision reviewed and
 * every correction on it, offers Withdraw review / Withdraw only where the server would accept them, and a withdrawal
 * keeps the decision open and reads its detail again -- it never advances to the next row the way Agree does.
 * Fake fetch only (Rule 17).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionReviewState } from "../src/api.js";
import { App } from "../src/App.js";
import { DecisionDetail } from "../src/DecisionDetail.js";
import type { Decision } from "../src/DecisionDetail.js";
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { zhErrors } from "../src/locales/zh.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

const DECISION: Decision = { id: "run/1", question: "q-1", chose: "c-1", because: "b-1", alternatives: [] };
type Correction = DecisionReviewState["corrections"][number];
const correction = (id: string, over: Partial<Correction>): Correction => ({
  id, kind: "wrong", because: `because of ${id}`, by: "me", at: "2026-10-18T02:00:00.000Z", state: "open", mine: true, withdrawable: true, ...over,
});
const MINE_WITHDRAWN = correction("c-mine-withdrawn", { state: "withdrawn", withdrawable: false });
const OTHERS_OPEN = correction("c-others-open", { by: "other", mine: false, withdrawable: false });
const MINE_CLOSED = correction("c-mine-closed", { state: "closed", withdrawable: false });
const MINE_OPEN = correction("c-mine-open", {});
const reviewed = (corrections: Correction[]): DecisionReviewState => ({
  reviewers: [{ by: "me", at: "2026-10-18T01:00:00.000Z" }, { by: "other", at: "2026-10-18T03:00:00.000Z" }],
  mine: "reviewed",
  corrections,
});

const rowOf = (container: HTMLElement, id: string): HTMLElement =>
  container.querySelector<HTMLElement>(`[data-correction-id="${id}"]`)!;
const withdrawReviewButton = (container: HTMLElement): HTMLElement | null =>
  within(container).queryByRole("button", { name: "Withdraw review" });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the detail's review state (spec §7)", () => {
  beforeEach(async () => { await i18n.changeLanguage("en"); });

  it("shows the reviewers in the ok tone, a secondary Withdraw review, and Agree disabled as Reviewed", () => {
    const onWithdrawReview = vi.fn();
    const { container } = render(
      <DecisionDetail decision={DECISION} review={reviewed([MINE_WITHDRAWN, OTHERS_OPEN])} onWithdrawReview={onWithdrawReview} />,
    );
    const block = container.querySelector<HTMLElement>('[data-testid="decision-reviewers"]')!;
    expect(block.getAttribute("data-tone")).toBe("ok");
    expect(block.querySelector("h3")?.textContent).toBe("Reviewed by");
    expect([...block.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "me · 2026-10-18T01:00:00.000Z",
      "other · 2026-10-18T03:00:00.000Z",
    ]);
    const withdraw = withdrawReviewButton(container)!;
    expect(withdraw.classList.contains("btn-primary")).toBe(false);
    // One primary per view (DESIGN.md): Agree stays the primary, disabled, and says why.
    expect(container.querySelectorAll(".btn-primary")).toHaveLength(1);
    const agree = container.querySelector<HTMLButtonElement>(".actions > button.btn-primary")!;
    expect(agree.disabled).toBe(true);
    expect(agree.textContent).toBe("Reviewed");
    fireEvent.click(withdraw);
    expect(onWithdrawReview).toHaveBeenCalledTimes(1);
  });

  it("offers no Withdraw review while the viewer's own correction here is open (§4.4), and Withdraw on that correction", () => {
    const onWithdrawCorrection = vi.fn();
    const { container } = render(
      <DecisionDetail decision={DECISION} review={reviewed([MINE_OPEN, OTHERS_OPEN, MINE_WITHDRAWN, MINE_CLOSED])} onWithdrawReview={() => undefined} onWithdrawCorrection={onWithdrawCorrection} />,
    );
    // mutation: show Withdraw review regardless of an own open correction -> red here
    expect(withdrawReviewButton(container)).toBeNull();
    const mine = rowOf(container, MINE_OPEN.id);
    const button = within(mine).getByRole("button", { name: "Withdraw" });
    expect(button.classList.contains("btn-primary")).toBe(false);
    fireEvent.click(button);
    expect(onWithdrawCorrection).toHaveBeenCalledWith(MINE_OPEN.id);
    // mutation: a Withdraw on any open correction (not only the viewer's own) -> red here
    expect(within(rowOf(container, OTHERS_OPEN.id)).queryByRole("button")).toBeNull();
    expect(within(rowOf(container, MINE_WITHDRAWN.id)).queryByRole("button")).toBeNull();
    expect(within(rowOf(container, MINE_CLOSED.id)).queryByRole("button")).toBeNull();
  });

  it("lists each correction with kind, because, by, at and state; withdrawn struck through, closed in the ok tone, open in none", () => {
    const { container } = render(<DecisionDetail decision={DECISION} review={reviewed([OTHERS_OPEN, MINE_WITHDRAWN, MINE_CLOSED])} />);
    const block = container.querySelector<HTMLElement>('[data-testid="decision-corrections"]')!;
    expect(block.querySelector("h3")?.textContent).toBe("Corrections");
    expect(block.getAttribute("data-tone")).toBeNull();
    const open = rowOf(container, OTHERS_OPEN.id);
    expect(open.textContent).toBe("wrong · because of c-others-open · other · 2026-10-18T02:00:00.000Z · open");
    expect(open.getAttribute("data-tone")).toBeNull();
    expect(open.classList.contains("correction-withdrawn")).toBe(false);
    const withdrawn = rowOf(container, MINE_WITHDRAWN.id);
    expect(withdrawn.textContent).toContain("withdrawn");
    expect(withdrawn.classList.contains("correction-withdrawn")).toBe(true);
    expect(withdrawn.getAttribute("data-tone")).toBeNull();
    const closed = rowOf(container, MINE_CLOSED.id);
    expect(closed.textContent).toContain("closed");
    expect(closed.getAttribute("data-tone")).toBe("ok");
    expect(closed.classList.contains("correction-withdrawn")).toBe(false);
  });

  it("with the viewer not reviewed: Agree enabled as Agree, no Withdraw review, and no empty blocks", () => {
    const { container } = render(<DecisionDetail decision={DECISION} review={{ reviewers: [], mine: "none", corrections: [] }} />);
    const agree = container.querySelector<HTMLButtonElement>(".actions > button.btn-primary")!;
    expect(agree.disabled).toBe(false);
    expect(agree.textContent).toBe("Agree");
    expect(withdrawReviewButton(container)).toBeNull();
    expect(container.querySelector('[data-testid="decision-reviewers"]')).toBeNull();
    expect(container.querySelector('[data-testid="decision-corrections"]')).toBeNull();
  });
});

// ---- The page (App): a withdrawal is a request record, re-reads the detail and never advances (spec §10.1). ----

type StatusRow = DecisionListRow & { reviewed: boolean; highTier: boolean };
const row = (id: string, isReviewed: boolean): StatusRow => ({
  projectKey: "proj", id, at: "2026-09-16T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok",
  question: null, reviewed: isReviewed, highTier: true,
});
const REPORT = {
  as_of: "2026-09-16T00:00:00.000Z", as_of_mode: "wall_clock", repos: [],
  correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] },
  repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" },
  excluded_as_future: 0, withdrawn_corrections: 0, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [],
} as unknown as MetricsReport;
const COVERAGE: PanelCoverage = { reviewed_high_tier: 2, high_tier_total: 2, rate: 1, caveat: "c" };
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The fake server's state: whether "me" still has run/1 reviewed, and my one correction on run/2. */
let mineOnFirst: boolean;
let correctionWithdrawn: boolean;
let requested: string[];
let posted: Array<{ url: string; body: unknown }>;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.location.hash = "#decisions";
  mineOnFirst = true;
  correctionWithdrawn = false;
  requested = [];
  posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requested.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("/api/todo")) return json({ rows: mineOnFirst ? [] : [row("run/1", false)] });
    if (url.startsWith("/api/decisions")) return json({ rows: [row("run/1", mineOnFirst), row("run/2", true)] });
    if (url.startsWith("/api/metrics")) return json({ report: REPORT, panel_review_coverage: COVERAGE });
    if (url === "/api/reviews/withdraw") {
      posted.push({ url, body: JSON.parse(String(init?.body)) });
      mineOnFirst = false;
      return json({ result: "written" });
    }
    if (url === "/api/corrections/withdraw") {
      posted.push({ url, body: JSON.parse(String(init?.body)) });
      correctionWithdrawn = true;
      return json({ withdrawal: { correctionId: "c-2" }, review: "skipped" });
    }
    if (url.startsWith("/api/decision?")) {
      const id = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("decisionId") ?? "";
      const review: DecisionReviewState = id === "run/1"
        ? { reviewers: mineOnFirst ? [{ by: "me", at: "2026-10-18T01:00:00.000Z" }] : [], mine: mineOnFirst ? "reviewed" : "none", corrections: [] }
        : {
          reviewers: [{ by: "me", at: "2026-10-18T01:00:00.000Z" }], mine: "reviewed",
          corrections: [correction("c-2", correctionWithdrawn ? { state: "withdrawn", withdrawable: false } : {})],
        };
      return json({ decision: { id, question: `question of ${id}`, chose: "c", because: "b", alternatives: [] }, review });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

const listedIds = (): string[] =>
  [...document.querySelectorAll(".decision-list li .row-id")].map((node) => node.textContent ?? "");
const detailReads = (id: string): number =>
  requested.filter((r) => r.startsWith("GET /api/decision?") && r.includes(`decisionId=${encodeURIComponent(id)}`)).length;
const splitDetail = (): HTMLElement => document.querySelector<HTMLElement>(".split-detail")!;

async function openReviewed(id: string): Promise<void> {
  render(<App />);
  await screen.findByText("Unreviewed high-tier decisions");
  fireEvent.change(document.querySelector('select[name="filter-status"]')!, { target: { value: "reviewed" } });
  await waitFor(() => expect(listedIds()).toEqual(["run/1", "run/2"]));
  const button = [...document.querySelectorAll<HTMLButtonElement>(".decision-list li button")].find((b) => b.textContent?.includes(id))!;
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe(`question of ${id}`));
}

describe("withdrawing in the page (spec §7, §10.1)", () => {
  it("Withdraw review posts the withdrawal, keeps the decision open after its row leaves the list, and re-reads its detail", async () => {
    await openReviewed("run/1");
    const agree = (): HTMLButtonElement => splitDetail().querySelector<HTMLButtonElement>(".actions > button.btn-primary")!;
    expect(agree().disabled).toBe(true);
    const readsBefore = detailReads("run/1");
    fireEvent.click(within(splitDetail()).getByRole("button", { name: "Withdraw review" }));
    await waitFor(() => expect(posted).toEqual([{ url: "/api/reviews/withdraw", body: { projectKey: "proj", decisionId: "run/1" } }]));
    expect(await within(splitDetail()).findByText("Review withdrawn.")).toHaveProperty("tagName", "P");
    expect(within(splitDetail()).getByText("Review withdrawn.").getAttribute("data-tone")).toBe("ok");
    // The row is no longer reviewed, so it leaves the Reviewed list ...
    await waitFor(() => expect(listedIds()).toEqual(["run/2"]));
    // ... and the detail was read again: Agree is live again.
    await waitFor(() => expect(agree().disabled).toBe(false));
    expect(agree().textContent).toBe("Agree");
    expect(detailReads("run/1")).toBeGreaterThan(readsBefore);
    expect(screen.getByTestId("decision-question").textContent).toBe("question of run/1");
    expect(within(splitDetail()).queryByRole("button", { name: "Withdraw review" })).toBeNull();
    expect(detailReads("run/2")).toBe(0);
  });

  it("says the withdrawn decision left the list for the status filter, never that it has been reviewed (fix round 1)", async () => {
    await openReviewed("run/1");
    fireEvent.click(within(splitDetail()).getByRole("button", { name: "Withdraw review" }));
    await waitFor(() => expect(listedIds()).toEqual(["run/2"]));
    const note = splitDetail().querySelector('[role="note"]');
    // mutation: restore the old en notInList ("…: it has been reviewed.") -> red here
    expect(note?.textContent).toBe("This decision is no longer in the list under the current status filter.");
    expect(splitDetail().textContent).not.toContain("has been reviewed");
    await act(async () => { await i18n.changeLanguage("zh"); });
    expect(splitDetail().querySelector('[role="note"]')?.textContent).toBe("这条决策已不在当前状态筛选的列表里。");
    expect(splitDetail().textContent).not.toContain("已被评审");
  });

  it("never moves on to the next row, even when the re-read list has dropped the open one (spec §10.1)", async () => {
    // A stale Unreviewed list still shows run/1, which this viewer has since reviewed (the detail says so); while the
    // withdrawal is in flight someone else reviews it, so the re-read list no longer has it. That is exactly when
    // Agree's advance would open run/2 -- a withdrawal must not.
    let othersReviewed = false;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.startsWith("/api/todo")) {
        requested.push(`GET ${url}`);
        return json({ rows: othersReviewed ? [row("run/2", false)] : [row("run/1", false), row("run/2", false)] });
      }
      if (url === "/api/reviews/withdraw") othersReviewed = true;
      return real(input, init);
    }) as typeof fetch;
    render(<App />);
    await waitFor(() => expect(listedIds()).toEqual(["run/1", "run/2"]));
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".decision-list li button")].find((b) => b.textContent?.includes("run/1"))!);
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe("question of run/1"));
    fireEvent.click(within(splitDetail()).getByRole("button", { name: "Withdraw review" }));
    await within(splitDetail()).findByText("Review withdrawn.");
    await waitFor(() => expect(listedIds()).toEqual(["run/2"]));
    await waitFor(() => expect(splitDetail().querySelector<HTMLButtonElement>(".actions > button.btn-primary")!.disabled).toBe(false));
    // mutation: the withdraw path sets pendingAdvance after the re-read, as Agree does -> run/2 opens here, red
    expect(screen.getByTestId("decision-question").textContent).toBe("question of run/1");
    expect(detailReads("run/2")).toBe(0);
  });

  it("Withdraw on the viewer's own correction posts its id, keeps the decision open and shows it withdrawn", async () => {
    await openReviewed("run/2");
    const mine = (): HTMLElement => rowOf(splitDetail(), "c-2");
    fireEvent.click(within(mine()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(posted).toEqual([{ url: "/api/corrections/withdraw", body: { correctionId: "c-2" } }]));
    expect(await within(splitDetail()).findByText("Correction withdrawn.")).toHaveProperty("tagName", "P");
    await waitFor(() => expect(mine().classList.contains("correction-withdrawn")).toBe(true));
    expect(within(mine()).queryByRole("button")).toBeNull();
    expect(screen.getByTestId("decision-question").textContent).toBe("question of run/2");
  });

  it("a recorded correction re-reads the open detail too, so the new correction is listed with its Withdraw (spec §7)", async () => {
    let recorded = false;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === "/api/corrections") { recorded = true; return json({ correction: { id: "c_00000000000000a1" } }); }
      // Task 13: the debug-group open the page sends once the correction is stored.
      if (url === "/api/control/corrections/c_00000000000000a1/debug-group") return json({ schema: "orca-command-success-v1", commandRevision: 1, result: { kind: "debug-group-opened", groupId: "debug-c_00000000000000a1", correctionId: "c_00000000000000a1", created: true } });
      if (recorded && url.startsWith("/api/decision?") && url.includes("decisionId=run%2F1")) {
        requested.push(`GET ${url}`);
        return json({
          decision: { id: "run/1", question: "question of run/1", chose: "c", because: "b", alternatives: [] },
          review: { reviewers: [{ by: "me", at: "2026-10-18T01:00:00.000Z" }], mine: "reviewed", corrections: [correction("c-new", {})] },
        });
      }
      return real(input, init);
    }) as typeof fetch;
    await openReviewed("run/1");
    expect(rowOf(splitDetail(), "c-new")).toBeNull();
    fireEvent.change(splitDetail().querySelector('textarea[name="because"]')!, { target: { value: "a reason" } });
    fireEvent.submit(splitDetail().querySelector("form.correction-form")!);
    await within(splitDetail()).findByText("Correction recorded.");
    // mutation: no detail re-read after a recorded Agree / Correct -> the new correction never shows, red
    await waitFor(() => expect(rowOf(splitDetail(), "c-new")).not.toBeNull());
    expect(within(rowOf(splitDetail(), "c-new")).getByRole("button", { name: "Withdraw" })).not.toBeNull();
  });

  it("a refused withdrawal shows the server's refusal under the decision", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      String(input) === "/api/reviews/withdraw"
        ? json({ code: "review-has-open-correction", message: "distinct server message" }, 409)
        : real(input, init)) as typeof fetch;
    await openReviewed("run/1");
    fireEvent.click(within(splitDetail()).getByRole("button", { name: "Withdraw review" }));
    expect((await within(splitDetail()).findByTestId("refusal-code")).textContent).toBe("review-has-open-correction");
    expect(within(splitDetail()).getByTestId("refusal-message").textContent).toBe(enErrors["review-has-open-correction"]);
    expect(within(splitDetail()).queryByTestId("record-another")).toBeNull();
  });

  it("a refused withdrawal reads in Chinese for a zh reader, not the server's English sentence (spec §7)", async () => {
    await i18n.changeLanguage("zh");
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      String(input) === "/api/reviews/withdraw"
        ? json({ code: "review-not-active", message: "You have not reviewed this decision, so there is no review of yours to withdraw." }, 409)
        : real(input, init)) as typeof fetch;
    render(<App />);
    await waitFor(() => expect(document.querySelector('select[name="filter-status"]')).not.toBeNull());
    fireEvent.change(document.querySelector('select[name="filter-status"]')!, { target: { value: "reviewed" } });
    await waitFor(() => expect(listedIds()).toEqual(["run/1", "run/2"]));
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".decision-list li button")].find((b) => b.textContent?.includes("run/1"))!);
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe("question of run/1"));
    fireEvent.click(within(splitDetail()).getByRole("button", { name: "撤回审阅" }));
    expect((await within(splitDetail()).findByTestId("refusal-code")).textContent).toBe("review-not-active");
    expect(within(splitDetail()).getByTestId("refusal-message").textContent).toBe(zhErrors["review-not-active"]);
  });

  it("disables Withdraw review while its own request is pending, so a double click sends one withdrawal (final review Minor 4)", async () => {
    let release: ((answer: Response) => void) | undefined;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input) !== "/api/reviews/withdraw") return real(input, init);
      posted.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Promise<Response>((resolve) => { release = resolve; });
    }) as typeof fetch;
    await openReviewed("run/1");
    const button = (): HTMLButtonElement => within(splitDetail()).getByRole<HTMLButtonElement>("button", { name: "Withdraw review" });
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    // mutation: no `disabled` on Withdraw review while its request is pending -> red here
    await waitFor(() => expect(button().disabled).toBe(true));
    fireEvent.click(button());
    expect(posted).toHaveLength(1);
    await act(async () => { mineOnFirst = false; release!(json({ result: "written" })); });
    await within(splitDetail()).findByText("Review withdrawn.");
    expect(posted).toHaveLength(1);
  });

  it("disables a correction's Withdraw while its own request is pending, and only that correction's", async () => {
    let release: ((answer: Response) => void) | undefined;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.startsWith("/api/decision?") && url.includes("decisionId=run%2F2")) {
        requested.push(`GET ${url}`);
        return json({
          decision: { id: "run/2", question: "question of run/2", chose: "c", because: "b", alternatives: [] },
          review: { reviewers: [{ by: "me", at: "2026-10-18T01:00:00.000Z" }], mine: "reviewed", corrections: [correction("c-2", {}), correction("c-3", {})] },
        });
      }
      if (url !== "/api/corrections/withdraw") return real(input, init);
      posted.push({ url, body: JSON.parse(String(init?.body)) });
      return new Promise<Response>((resolve) => { release = resolve; });
    }) as typeof fetch;
    await openReviewed("run/2");
    const withdrawOf = (id: string): HTMLButtonElement => within(rowOf(splitDetail(), id)).getByRole<HTMLButtonElement>("button", { name: "Withdraw" });
    fireEvent.click(withdrawOf("c-2"));
    // mutation: no `disabled` on a correction's Withdraw while its request is pending -> red here
    await waitFor(() => expect(withdrawOf("c-2").disabled).toBe(true));
    // mutation: disable every correction's Withdraw while any withdrawal is pending -> red here
    expect(withdrawOf("c-3").disabled).toBe(false);
    fireEvent.click(withdrawOf("c-2"));
    expect(posted).toEqual([{ url: "/api/corrections/withdraw", body: { correctionId: "c-2" } }]);
    await act(async () => { release!(json({ withdrawal: { correctionId: "c-2" }, review: "skipped" })); });
    await within(splitDetail()).findByText("Correction withdrawn.");
  });

  it("re-reads the open detail after the 409 that says the correction was withdrawn but the review was not (final review Minor 3)", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input) !== "/api/corrections/withdraw") return real(input, init);
      posted.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      correctionWithdrawn = true;
      return json({
        code: "reviews-store-busy",
        message: "the correction was withdrawn (id c-2), but your review of the decision could not be withdrawn with it: busy",
        withdrawal: { correctionId: "c-2" },
      }, 409);
    }) as typeof fetch;
    await openReviewed("run/2");
    const mine = (): HTMLElement => rowOf(splitDetail(), "c-2");
    const readsBefore = detailReads("run/2");
    fireEvent.click(within(mine()).getByRole("button", { name: "Withdraw" }));
    expect((await within(splitDetail()).findByTestId("refusal-code")).textContent).toBe("reviews-store-busy");
    // mutation: no detail re-read after a refused withdrawal -> c-2 keeps showing open with its Withdraw, red here
    await waitFor(() => expect(mine().classList.contains("correction-withdrawn")).toBe(true));
    expect(within(mine()).queryByRole("button")).toBeNull();
    expect(detailReads("run/2")).toBeGreaterThan(readsBefore);
    // The refusal stays on screen beside the re-read detail.
    expect(within(splitDetail()).getByTestId("refusal-code").textContent).toBe("reviews-store-busy");
  });

  it("the a key sends no second Agree once the open decision reads reviewed", async () => {
    await openReviewed("run/1");
    fireEvent.keyDown(document.body, { key: "a" });
    // Give a stray POST every chance to be sent before looking.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requested.filter((r) => r.startsWith("POST /api/reviews"))).toEqual([]);
  });
});
