// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3, §3.5, §5: the decisions area in Chinese -- the heading, the filters and their options, the row's
 * pills (enum values in words; the data-* attributes keep the raw value), the missing-question placeholder, why an open
 * decision left the list, and the detail's form with each correction kind in words.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { App } from "../src/App.js";
import { DecisionDetail } from "../src/DecisionDetail.js";
import type { Decision } from "../src/DecisionDetail.js";
import { DecisionsView, NO_FILTER } from "../src/DecisionsView.js";
import { DecisionOperations } from "../src/DecisionOperations.js";
import type { DecisionReviewState } from "../src/api.js";
import type { DecisionRequest, RecordedKey } from "../src/decisionRequests.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

const ROW: DecisionListRow = { projectKey: "github.com/x/y", id: "run/1", at: "2026-09-16T00:00:00.000Z", kind: "reconcile", scope: "cross-repo", verdict: "downgraded", question: null };
const DECISION: Decision = { id: "run/1", question: "q-1", chose: "c-1", because: "b-1", alternatives: [{ option: "o-1", why_not: "w-1" }] };
const optionTexts = (container: HTMLElement, name: string): Array<string | null> =>
  [...container.querySelectorAll(`select[name="${name}"] option`)].map((option) => option.textContent);
/** A label's own words: its first text node, before the control it wraps. */
const labelTexts = (container: HTMLElement, selector: string): Array<string | null> =>
  [...container.querySelectorAll(`${selector} label`)].map((label) => label.firstChild?.textContent ?? null);
const texts = (container: HTMLElement, selector: string): Array<string | null> =>
  [...container.querySelectorAll(selector)].map((node) => node.textContent);

afterEach(cleanup);

describe("the decisions area in Chinese", () => {
  it("shows the list, its filters, the pills and the detail's form in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const { container } = render(<DecisionsView rows={[ROW]} filter={NO_FILTER} selected={ROW} detail={<DecisionDetail decision={DECISION} />} />);
    const text = container.textContent ?? "";
    for (const expected of ["未评审的高层级决策", "1 / 1", "（没有记录问题）", "选择了", "被否决的备选", "同意", "改选（可选）", "纠正"]) expect(text).toContain(expected);
    expect(container.querySelector(".field-kind")?.textContent).toBe("协调");
    expect(container.querySelector(".field-kind")?.getAttribute("data-level")).toBe("1");
    expect(container.querySelector(".field-scope")?.textContent).toBe("跨仓库");
    expect(container.querySelector(".field-verdict")?.textContent).toBe("已降级");
    expect(optionTexts(container, "filter-kind")).toEqual(["任意", "🔴 协调"]);
    expect(optionTexts(container, "filter-scope")).toEqual(["任意", "跨仓库"]);
    expect(optionTexts(container, "kind")).toEqual(["错了 —— 选错了", "不合我意 —— 说得通，但不是我会选的", "过时 —— 当时对，现在不成立了"]);
    // Each site read on its own node, so no assertion passes on a neighbour's text (task 5 implementer addition).
    expect(container.querySelector("h1")?.textContent).toBe("未评审的高层级决策");
    expect(container.querySelector('[data-testid="decision-count"]')?.textContent).toBe("1 / 1");
    expect(container.querySelector(".section-lede")?.textContent).toBe("agent 记录下、还没人评审过的高层级决策。打开一条，读完，然后点「同意」或「纠正」。");
    expect(labelTexts(container, ".filters")).toEqual(["类型", "范围", "仓库"]);
    expect(optionTexts(container, "filter-projectKey")).toEqual(["任意", "github.com/x/y"]);
    expect(container.querySelector(".row-question")?.textContent).toBe("（没有记录问题）");
    expect(texts(container, ".decision-detail h3")).toEqual(["选择了", "理由", "被否决的备选"]);
    expect(container.querySelector(".actions > button.btn-primary")?.textContent).toBe("同意");
    expect(texts(container, ".detail-help")).toEqual([
      "标记为已评审：我读过了，不需要改。计入评审覆盖率。",
      "这会记录一条纠正；它不改台账。要改决策本身，用 orca correct --close 关闭它，或交给修复 agent。",
    ]);
    expect(labelTexts(container, ".correction-form")).toEqual(["类型", "理由", "改选（可选）"]);
    expect(container.querySelector('.correction-form button[type="submit"]')?.textContent).toBe("纠正");
    // Form values and data attributes keep the raw values (spec §3.5).
    expect([...container.querySelectorAll('select[name="kind"] option')].map((o) => o.getAttribute("value"))).toEqual(["wrong", "not_my_taste", "stale"]);
    expect([...container.querySelectorAll('select[name="filter-scope"] option')].map((o) => o.getAttribute("value"))).toEqual(["", "cross-repo"]);
  });

  it("says in Chinese why an open decision is not in the list", async () => {
    await i18n.changeLanguage("zh");
    const reviewed = render(<DecisionsView rows={[]} filter={NO_FILTER} selected={ROW} detail={<p>detail</p>} />).container;
    expect(reviewed.textContent ?? "").toContain("这条决策已不在当前状态筛选的列表里。");
    expect(reviewed.textContent ?? "").toContain("没有要评审的。每条高层级决策都已评审。");
    expect(reviewed.querySelector('[role="note"]')?.textContent).toBe("这条决策已不在当前状态筛选的列表里。");
    expect(reviewed.querySelector(".split-list .empty")?.textContent).toBe("没有要评审的。每条高层级决策都已评审。");
    cleanup();
    const hidden = render(<DecisionsView rows={[ROW]} filter={{ ...NO_FILTER, scope: "repo" }} selected={ROW} detail={<p>detail</p>} />).container;
    expect(hidden.textContent ?? "").toContain("这条决策被当前筛选条件隐藏了。");
    expect(hidden.textContent ?? "").toContain("没有符合这些筛选条件的决策。");
    expect(hidden.querySelector('[role="note"]')?.textContent).toBe("这条决策被当前筛选条件隐藏了。");
    expect(hidden.querySelector(".split-list .empty")?.textContent).toBe("没有符合这些筛选条件的决策。");
    cleanup();
    const unopened = render(<DecisionsView rows={[ROW]} filter={NO_FILTER} />).container;
    expect(unopened.querySelector(".split-detail .empty")?.textContent).toBe("选择一条决策来阅读。");
  });
});

// ---- Decisions review withdraw spec §7: the review state, the corrections and the withdraw outcomes in both languages. ----

const REVIEW_STATE: DecisionReviewState = {
  reviewers: [{ by: "me", at: "2026-10-18T01:00:00.000Z" }],
  mine: "reviewed",
  corrections: [
    { id: "c-open", kind: "wrong", because: "b-open", by: "me", at: "2026-10-18T02:00:00.000Z", state: "open", mine: true, withdrawable: true },
    { id: "c-withdrawn", kind: "stale", because: "b-w", by: "me", at: "2026-10-18T02:00:00.000Z", state: "withdrawn", mine: true, withdrawable: false },
    { id: "c-closed", kind: "stale", because: "b-c", by: "me", at: "2026-10-18T02:00:00.000Z", state: "closed", mine: true, withdrawable: false },
  ],
};
const NO_OPEN_OF_MINE: DecisionReviewState = { ...REVIEW_STATE, corrections: REVIEW_STATE.corrections.slice(1) };
const withdrawRecord = (verb: DecisionRequest["verb"], text: RecordedKey): DecisionRequest => ({
  requestId: verb, owner: { projectKey: "p", decisionId: "d" }, verb, payload: null, status: { kind: "recorded", text }, dismissed: false,
});

describe("the review state and withdraw words in each language", () => {
  const cases = [
    { lang: "zh", reviewedBy: "已审", corrections: "纠正", states: ["未关闭", "已撤回", "已关闭"], withdrawReview: "撤回审阅", withdraw: "撤回", agreeDone: "已审",
      lines: ["p / d · 撤回审阅：已撤回审阅。", "p / d · 撤回：已撤回纠正。"] },
    { lang: "en", reviewedBy: "Reviewed by", corrections: "Corrections", states: ["open", "withdrawn", "closed"], withdrawReview: "Withdraw review", withdraw: "Withdraw", agreeDone: "Reviewed",
      lines: ["p / d · Withdraw review: Review withdrawn.", "p / d · Withdraw: Correction withdrawn."] },
  ] as const;
  for (const c of cases) {
    it(`says them in ${c.lang}`, async () => {
      await i18n.changeLanguage(c.lang);
      const own = render(<DecisionDetail decision={DECISION} review={REVIEW_STATE} />).container;
      // The two new blocks are reading blocks too, so they are h3s after the decision's own three.
      expect(texts(own, ".decision-detail h3").slice(3)).toEqual([c.reviewedBy, c.corrections]);
      expect(texts(own, ".correction-state")).toEqual([...c.states]);
      expect(texts(own, "[data-correction-id] button")).toEqual([c.withdraw]);
      expect(own.querySelector(".actions > button.btn-primary")?.textContent).toBe(c.agreeDone);
      cleanup();
      const none = render(<DecisionDetail decision={DECISION} review={NO_OPEN_OF_MINE} />).container;
      expect(texts(none, '[data-testid="decision-reviewers"] button')).toEqual([c.withdrawReview]);
      cleanup();
      const notices = render(
        <DecisionOperations
          requests={[withdrawRecord("withdraw-review", "decisions.reviewWithdrawn"), withdrawRecord("withdraw-correction", "decisions.correctionWithdrawn")]}
          projectName={(key) => key}
          onDismiss={() => undefined}
          onRecordAnother={() => undefined}
        />,
      ).container;
      expect(texts(notices, '[data-testid="operation-line"]')).toEqual([...c.lines]);
    });
  }
});

// ---- The recorded outcome (App): it keeps its key, so the words follow a language switch (spec §3.3). ----

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
  excluded_as_future: 0, withdrawn_corrections: 0,
  unresolved_decisions: [],
  unkeyable_repos: [],
  malformed_lines: [],
};
const COVERAGE: PanelCoverage = { reviewed_high_tier: 0, high_tier_total: 1, rate: 0, caveat: "the coverage caveat" };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the recorded outcome in Chinese", () => {
  it("says each recorded outcome in Chinese, and in English after a switch", async () => {
    /** Answers for POST /api/corrections, in order. */
    const corrections: Response[] = [
      json(200, { recorded: true }),
      json(409, { code: "correction-already-recorded", message: "distinct refusal message", retry_field: "again" }),
      json(200, { recorded: true }),
    ];
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.startsWith("/api/todo")) return json(200, { rows: [ROW] });
      if (url.startsWith("/api/metrics")) return json(200, { report: REPORT, panel_review_coverage: COVERAGE });
      if (url.startsWith("/api/decision")) return json(200, { decision: DECISION });
      if (url.startsWith("/api/reviews")) return json(200, { recorded: true });
      if (url.startsWith("/api/corrections")) return corrections.shift() ?? json(500, { code: "no-more", message: "no more answers" });
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    await i18n.changeLanguage("zh");
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: /^决策/ }));
    await waitFor(() => expect(document.querySelector('[data-section="decisions"]')?.getAttribute("data-active")).toBe("true"));
    await waitFor(() => expect(document.querySelector(".decision-list li button")).not.toBeNull());
    fireEvent.click(document.querySelector(".decision-list li button")!);
    await screen.findByText(DECISION.question);

    // Agree.
    fireEvent.click(document.querySelector(".actions > button.btn-primary")!);
    await waitFor(() => expect(within(document.querySelector(".split-detail") as HTMLElement).queryByRole("status")?.textContent).toBe("已记录为已评审。"));

    // Correct, recorded at once.
    const submit = (): void => {
      fireEvent.change(document.querySelector('textarea[name="because"]')!, { target: { value: "a reason" } });
      fireEvent.submit(document.querySelector("form.correction-form")!);
    };
    submit();
    await waitFor(() => expect(within(document.querySelector(".split-detail") as HTMLElement).queryByRole("status")?.textContent).toBe("纠正已记录。"));

    // Correct again: refused, then recorded through "Record another".
    submit();
    await screen.findByTestId("record-another");
    expect(within(document.querySelector(".split-detail") as HTMLElement).queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByTestId("record-another"));
    await waitFor(() => expect(within(document.querySelector(".split-detail") as HTMLElement).queryByRole("status")?.textContent).toBe("纠正已记录。"));

    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(within(document.querySelector(".split-detail") as HTMLElement).queryByRole("status")?.textContent).toBe("Correction recorded.");
  });
});
