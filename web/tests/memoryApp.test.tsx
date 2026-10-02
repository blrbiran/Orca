// @vitest-environment jsdom
/**
 * Review Focus 5 / plan D8: a panel used without visiting Memory never asks for it (so ccmem is never started), and
 * #memory mounts the view and reads it. App's other requests are answered with the minimum the page needs.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

const metrics = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let requests: string[];

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/todo") return json({ rows: [] });
    if (url === "/api/metrics") return json(metrics);
    if (url === "/api/chains") return json({ repos: [] });
    if (url === "/api/memory/status") return json({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] });
    if (url.startsWith("/api/memory/list")) return json({ projectKey: "mem", query: "", page: { records: [], total: 0, truncated: false } });
    return json({ error: { code: "control-not-mounted", message: url } }, 404);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); window.location.hash = ""; });

describe("App and the Memory section (plan D8, Review Focus 5)", () => {
  it("never asks for memory while another section is in use", async () => {
    window.location.hash = "#decisions";
    render(<App />);
    await waitFor(() => expect(requests).toContain("/api/metrics"));
    await new Promise((r) => setTimeout(r, 50));
    expect(requests.filter((u) => u.startsWith("/api/memory"))).toEqual([]);
  });

  it("reads memory when #memory is the section", async () => {
    window.location.hash = "#memory";
    render(<App />);
    await waitFor(() => expect(requests).toContain("/api/memory/list?projectKey=mem"));
    expect(screen.getByText("No memory matches.")).toBeTruthy();
  });
});
