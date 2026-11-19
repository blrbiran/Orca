// @vitest-environment jsdom
// Tester #393(d): the visible tab's Overview poll read the whole projection every 2 s (~110 ms / 83 KB). With a prior
// projection it now asks `?sinceChangeSeq=`; the tiny unchanged shape keeps the prior lists (adopting its changeSeq),
// and a changed-only answer is followed by one complete read, so a partial answer can never replace the whole list.
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

it("polls with the prior changeSeq, keeps the list on an unchanged answer, and follows a change with one full read", async () => {
  installFakePanel();
  const first = groupSummary("g1", ALPHA, { goal: "first group" });
  const second = groupSummary("g2", ALPHA, { goal: "second group" });
  const base = globalThis.fetch;
  const reads: string[] = [];
  let full = projection(5, [first]);
  let moved = projection(7);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith("/api/control/overview")) return base(input, init);
    reads.push(url);
    return json(url.includes("?sinceChangeSeq=") ? moved : full);
  }) as typeof fetch;

  render(<App />);
  await flush();
  const page = within(screen.getByRole("region", { name: "Overview" }));
  expect(page.getByText("first group")).toBeTruthy();
  // The identity settles over a few first reads; the polls below start from that settled projection.
  reads.length = 0;

  // (a) the next poll names the prior changeSeq; (b) the tiny empty answer does not replace the list.
  await pass(2_000);
  expect(reads).toEqual(["/api/control/overview?sinceChangeSeq=5"]);
  expect(page.getByText("first group")).toBeTruthy();

  // The unchanged answer's own changeSeq becomes the next cursor.
  await pass(2_000);
  expect(reads).toEqual(["/api/control/overview?sinceChangeSeq=5", "/api/control/overview?sinceChangeSeq=7"]);

  // (c) a changed-only answer (g2 alone) is followed by one complete read; g1 is never dropped.
  moved = projection(8, [second]);
  full = projection(8, [first, second]);
  await pass(2_000);
  expect(reads.slice(2)).toEqual(["/api/control/overview?sinceChangeSeq=7", "/api/control/overview"]);
  await flush();
  expect(page.getByText("second group")).toBeTruthy();
  expect(page.getByText("first group")).toBeTruthy();
});
