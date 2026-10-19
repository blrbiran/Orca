// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { DecisionDetail } from "../src/DecisionDetail.js";
import type { Decision } from "../src/DecisionDetail.js";
import i18n from "../src/i18n.js";
import { WEB_CORRECTION_KINDS } from "../src/types.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

/**
 * task 8 ruling K7. Every field is a distinct literal, so no assertion can
 * pass by matching a different one.
 */
const decision: Decision = {
  id: "run/1",
  question: "distinct question text",
  chose: "distinct chose text",
  because: "distinct because text",
  alternatives: [{ option: "distinct alternative option text", why_not: "distinct why-not text" }],
};

describe("DecisionDetail (task 8 ruling K7)", () => {
  it("renders the question, the chosen option, the reasoning, and every alternative", () => {
    const html = renderToStaticMarkup(<DecisionDetail decision={decision} />);
    expect(html).toContain(decision.question);
    expect(html).toContain(decision.chose);
    expect(html).toContain(decision.because);
    expect(html).toContain(decision.alternatives[0]!.option);
    expect(html).toContain(decision.alternatives[0]!.why_not);
  });

  // Final review I-3 / ruling R66: `Correct` used to post `because: ""`, which
  // the seam refuses every time. The form must offer every correction kind and
  // must not let a correction go out without a reason.
  it("renders a correction form with every correction kind, a required because box, and an optional chose_instead box", () => {
    const html = renderToStaticMarkup(<DecisionDetail decision={decision} />);
    for (const kind of WEB_CORRECTION_KINDS) expect(html).toContain(`<option value="${kind}"`);
    expect(html).toMatch(/<textarea name="because" required=""/);
    expect(html).toContain('name="chose_instead"');
    expect(html).not.toMatch(/name="chose_instead"[^>]*required/);
  });
});

// ---- Debug task plan Task 13 (§3.1 panel bullet, ruling C11): the record form opens the debug group at once. ----

const CID = "c_00000000000000f6";
const ROW: DecisionListRow = { projectKey: "proj", id: "run/1", at: "2026-09-16T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", question: null };
const REPORT = {
  as_of: "2026-09-16T00:00:00.000Z", as_of_mode: "wall_clock", repos: [],
  correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] },
  repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" },
  excluded_as_future: 0, withdrawn_corrections: 0, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [],
} as unknown as MetricsReport;
const COVERAGE: PanelCoverage = { reviewed_high_tier: 0, high_tier_total: 1, rate: 0, caveat: "c" };
const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("recording from the decision detail (Task 13)", () => {
  afterEach(() => { cleanup(); window.location.hash = ""; });

  it("sends the open right after the row is stored; a failed open keeps the recorded state and shows the error with Retry", async () => {
    await i18n.changeLanguage("en");
    window.location.hash = "#decisions";
    const posts: Array<{ url: string; body: { commandId?: string; expectedRevision?: number; payload?: unknown } }> = [];
    const opens: Array<() => Response> = [
      () => reply({ error: { code: "correction-repository-unknown", message: "correction-repository-unknown:proj", commandRevision: null } }, 404),
      () => reply({ schema: "orca-command-success-v1", commandRevision: 1, result: { kind: "debug-group-opened", groupId: `debug-${CID}`, correctionId: CID, created: true } }),
    ];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (init?.method === "POST") posts.push({ url, body: JSON.parse(String(init.body)) });
      if (url.startsWith("/api/todo")) return reply({ rows: [ROW] });
      if (url.startsWith("/api/metrics")) return reply({ report: REPORT, panel_review_coverage: COVERAGE });
      if (url.startsWith("/api/decision?")) return reply({ decision: { id: "run/1", question: "question of run/1", chose: "c", because: "b", alternatives: [] } });
      if (url === "/api/corrections") return reply({ correction: { id: CID } });
      if (url === `/api/control/corrections/${CID}/debug-group`) return opens.shift()!();
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    render(<App />);
    await waitFor(() => expect(document.querySelector(".decision-list li button")).not.toBeNull());
    fireEvent.click(document.querySelector<HTMLButtonElement>(".decision-list li button")!);
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe("question of run/1"));
    const detail = (): HTMLElement => document.querySelector<HTMLElement>(".split-detail")!;
    fireEvent.change(detail().querySelector('textarea[name="because"]')!, { target: { value: "a reason" } });
    fireEvent.submit(detail().querySelector("form.correction-form")!);
    const refusal = await within(detail()).findByTestId("correction-refusal");
    // One record, then one open of the correction the route stored (mutation: no open after the record -> red here).
    expect(posts.map((post) => post.url)).toEqual(["/api/corrections", `/api/control/corrections/${CID}/debug-group`]);
    expect(posts[1]!.body.expectedRevision).toBe(0);
    expect(posts[1]!.body.payload).toEqual({ correctionId: CID });
    // The recorded state stays: the open's failure is shown beside it, never instead of it.
    expect(within(detail()).getByRole("status").textContent).toBe("Correction recorded.");
    expect(refusal.querySelector("code")?.textContent).toBe("correction-repository-unknown");
    fireEvent.click(within(detail()).getByRole("button", { name: "Retry" }));
    expect(await within(detail()).findByText(`Debug group debug-${CID} opened.`)).toBeTruthy();
    expect(posts.map((post) => post.url)).toEqual(["/api/corrections", `/api/control/corrections/${CID}/debug-group`, `/api/control/corrections/${CID}/debug-group`]);
    expect(posts[2]!.body.commandId).not.toBe(posts[1]!.body.commandId);
    expect(within(detail()).getByRole("status").textContent).toBe("Correction recorded.");
  });
});
