// @vitest-environment jsdom
/**
 * Panel i18n spec §4, §6.7: choosing 中文 in the sidebar writes orca.panel.lang = zh, sets <html lang="zh"> and
 * re-renders the page's text; choosing English reverses all three. Task 6 adds the helper-built case (a chain banner).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Ruling: human 「这次批准改写所有必要的判据」 (session 2026-10-29, Radix Select trial): the language picker is a Radix
// select, so the criterion opens it from the keyboard and picks the option, as a person without a mouse would.
async function languageSelect(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const trigger = container.querySelector<HTMLElement>('[data-select-trigger="language"]');
    if (trigger === null) throw new Error("no language switch yet");
    return trigger;
  });
}
// jsdom has neither of these; Radix calls them while the list is open.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
async function choose(trigger: HTMLElement, name: RegExp): Promise<void> {
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("option", { name });
  fireEvent.keyDown(option, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}
const ZH = /中文/, EN = /English/;

describe("the language switch (spec §6.7)", () => {
  it("switches the page to Chinese and back, remembering the choice in this browser", async () => {
    const { container } = render(<App />);
    const select = await languageSelect(container);
    expect(screen.getByRole("link", { name: /Decisions/ })).toBeTruthy();
    await choose(select, ZH);
    await waitFor(() => expect(screen.getByRole("link", { name: /决策/ })).toBeTruthy());
    expect(window.localStorage.getItem("orca.panel.lang")).toBe("zh");
    expect(document.documentElement.lang).toBe("zh");
    expect(select.textContent).toContain("中文");
    expect(container.textContent).toContain("主题");
    await choose(select, EN);
    await waitFor(() => expect(screen.getByRole("link", { name: /Decisions/ })).toBeTruthy());
    expect(window.localStorage.getItem("orca.panel.lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("re-renders a helper-built string too: the chain banner bannersFor builds", async () => {
    chainRepos = [{
      repoKey: "acme-alpha", defaultSessionTimeoutMin: null, problem: null,
      chain: { chainId: "chain-0000000b", goal: "g-1", by: "amy", via: "cli", startedAt: "2026-10-01T00:00:00.000Z", state: "stopped", holderGone: false, sessionsDone: 2, costUsd: 1.5, stop: { reason: "r-1", category: "done", at: "2026-10-01T01:00:00.000Z", awaitingHuman: [], detail: null } },
    }];
    const { container } = render(<App />);
    const select = await languageSelect(container);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Chain finished"));
    await choose(select, ZH);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("链已完成"));
    await choose(select, EN);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Chain finished"));
  });

  it("still switches when this browser refuses to store the choice (a full or blocked storage costs the memory, not the switch)", async () => {
    const { container } = render(<App />);
    const select = await languageSelect(container);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await choose(select, ZH);
    await waitFor(() => expect(screen.getByRole("link", { name: /决策/ })).toBeTruthy());
    expect(document.documentElement.lang).toBe("zh");
  });
});
