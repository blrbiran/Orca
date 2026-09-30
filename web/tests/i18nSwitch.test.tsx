// @vitest-environment jsdom
/**
 * Panel i18n spec §4, §6.7: choosing 中文 in the sidebar writes orca.panel.lang = zh, sets <html lang="zh"> and
 * re-renders the page's text; choosing English reverses all three. Task 6 adds the helper-built case (a chain banner).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// Copied verbatim from web/tests/controlCommandRecovery.test.tsx:100 (the page reads the metrics on load).
const METRICS = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
/** What GET /api/chains answers; a Task 6 case puts a stopped chain here. */
let chainRepos: unknown[] = [];

beforeEach(() => {
  window.localStorage.clear();
  chainRepos = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return json({ rows: [] });
    if (url === "/api/metrics") return json(METRICS);
    if (url === "/api/chains") return json({ repos: chainRepos });
    // No control plane in this criterion: the config read is refused and the page shows no control section.
    return json({ error: { code: "control-port-unconfigured", message: "no control plane in this criterion" } }, 404);
  }) as typeof fetch;
});
afterEach(cleanup);

async function languageSelect(container: HTMLElement): Promise<HTMLSelectElement> {
  return waitFor(() => {
    const select = container.querySelector<HTMLSelectElement>('select[name="language"]');
    if (select === null) throw new Error("no language switch yet");
    return select;
  });
}

describe("the language switch (spec §6.7)", () => {
  it("switches the page to Chinese and back, remembering the choice in this browser", async () => {
    const { container } = render(<App />);
    const select = await languageSelect(container);
    expect(screen.getByRole("link", { name: /Decisions/ })).toBeTruthy();
    fireEvent.change(select, { target: { value: "zh" } });
    await waitFor(() => expect(screen.getByRole("link", { name: /决策/ })).toBeTruthy());
    expect(window.localStorage.getItem("orca.panel.lang")).toBe("zh");
    expect(document.documentElement.lang).toBe("zh");
    expect(select.value).toBe("zh");
    expect(container.textContent).toContain("主题");
    fireEvent.change(select, { target: { value: "en" } });
    await waitFor(() => expect(screen.getByRole("link", { name: /Decisions/ })).toBeTruthy());
    expect(window.localStorage.getItem("orca.panel.lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
