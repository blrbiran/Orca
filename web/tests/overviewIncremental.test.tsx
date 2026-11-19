// @vitest-environment jsdom
// Tester #393(d): the visible tab's Overview poll read the whole projection every 2 s (~110 ms / 83 KB). With a prior
// projection it now asks `?sinceChangeSeq=`; the tiny unchanged shape keeps the prior lists, and a changed answer is
// followed by one complete read, so a partial answer can never replace the whole list. An empty answer whose changeSeq
// is ahead of the cursor is a change too: what moved may simply no longer be listed (the last group was archived).
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ALPHA, groupSummary, installFakePanel } from "./fixtures/twoProjects.js";
import type { OverviewV1 } from "../src/controlTypes.js";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const projection = (changeSeq: number, groups: OverviewV1["groups"] = []): OverviewV1 =>
  ({ schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq, groups, steps: [], issues: [] });
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const pass = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { window.location.hash = ""; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); });

/** The overview route: `full` answers a complete read, `moved` a `?sinceChangeSeq=` one. Every read is logged. */
function serveOverview(script: { full: OverviewV1; moved: OverviewV1 }): string[] {
  installFakePanel();
  const base = globalThis.fetch;
  const reads: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith("/api/control/overview")) return base(input, init);
    reads.push(url);
    return json(url.includes("?sinceChangeSeq=") ? script.moved : script.full);
  }) as typeof fetch;
  return reads;
}

it("polls with the prior changeSeq, keeps the list on an unchanged answer, and follows a change with one full read", async () => {
  const first = groupSummary("g1", ALPHA, { goal: "first group" });
  const second = groupSummary("g2", ALPHA, { goal: "second group" });
  const script = { full: projection(5, [first]), moved: projection(5) };
  const reads = serveOverview(script);

  render(<App />);
  await flush();
  const page = within(screen.getByRole("region", { name: "Overview" }));
  expect(page.getByText("first group")).toBeTruthy();
  // The identity settles over a few first reads; the polls below start from that settled projection.
  reads.length = 0;

  // (a) the next poll names the prior changeSeq; (b) the tiny answer at that same changeSeq does not replace the list.
  await pass(2_000);
  expect(reads).toEqual(["/api/control/overview?sinceChangeSeq=5"]);
  expect(page.getByText("first group")).toBeTruthy();

  // (c) a changed-only answer (g2 alone) is followed by one complete read; g1 is never dropped.
  script.moved = projection(8, [second]);
  script.full = projection(8, [first, second]);
  await pass(2_000);
  expect(reads.slice(1)).toEqual(["/api/control/overview?sinceChangeSeq=5", "/api/control/overview"]);
  await flush();
  expect(page.getByText("second group")).toBeTruthy();
  expect(page.getByText("first group")).toBeTruthy();

  // The complete answer's changeSeq is the next cursor, and an unchanged poll after it is still one tiny request.
  script.moved = projection(8);
  await pass(2_000);
  expect(reads.slice(3)).toEqual(["/api/control/overview?sinceChangeSeq=8"]);
  expect(page.getByText("first group")).toBeTruthy();
});

it("an empty answer ahead of the cursor is a change: one complete read drops the group no longer listed", async () => {
  const only = groupSummary("g1", ALPHA, { goal: "last group" });
  // Archiving the last visible group advances the journal, but the overview has nothing left to list: the incremental
  // answer is empty at a higher changeSeq, which is not "unchanged".
  const script = { full: projection(5, [only]), moved: projection(9) };
  const reads = serveOverview(script);

  render(<App />);
  await flush();
  const page = within(screen.getByRole("region", { name: "Overview" }));
  expect(page.getByText("last group")).toBeTruthy();
  reads.length = 0;
  script.full = projection(9);

  await pass(2_000);
  await flush();
  expect(page.queryByText("last group")).toBeNull();
  expect(reads).toEqual(["/api/control/overview?sinceChangeSeq=5", "/api/control/overview"]);
});
