// @vitest-environment jsdom
// Tester #393(c): a hidden tab kept its 2 s summary poll and its Overview todo/overview/recovery polls running. Nothing
// moves on screen while hidden, so the panel carried that work for nothing; coming back reads once, then the timers go on.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { installFakePanel } from "./fixtures/twoProjects.js";
import type { OverviewV1 } from "../src/controlTypes.js";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
let visibility: "visible" | "hidden" = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });

afterEach(() => { vi.useRealTimers(); cleanup(); visibility = "visible"; window.location.hash = ""; });

/** Fake timers that still follow the wall clock, so testing-library's own waits keep working. */
const pass = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

it("pauses the summary, todo, overview and recovery polls while hidden, and reads each again once when visible", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const overview: OverviewV1 = { schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq: 1, groups: [], steps: [], issues: [] };
  const fake = installFakePanel();
  const inner = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(`${init?.method ?? "GET"} ${String(input)}`);
    if (String(input).startsWith("/api/control/overview")) return json(overview);
    return inner(input, init);
  }) as typeof fetch;
  const count = (path: string): number => requests.filter((request) => request.startsWith(`GET ${path}`)).length;

  render(<App />);
  await screen.findByRole("region", { name: "Overview" });
  await waitFor(() => expect(count("/api/control/summary")).toBeGreaterThan(0));
  await waitFor(() => expect(count("/api/control/overview")).toBeGreaterThan(0));
  await waitFor(() => expect(count("/api/control/recovery")).toBeGreaterThan(0));
  await waitFor(() => expect(count("/api/todo")).toBeGreaterThan(0));
  expect(fake).toBeDefined();

  visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
  const hidden = {
    summary: count("/api/control/summary"), overview: count("/api/control/overview"),
    recovery: count("/api/control/recovery"), todo: count("/api/todo"),
  };
  await pass(10_000);
  // mutation: drop the pageHidden guard from the tick -> red here (the counts grow)
  expect({ summary: count("/api/control/summary"), overview: count("/api/control/overview"),
    recovery: count("/api/control/recovery"), todo: count("/api/todo") }).toEqual(hidden);

  visibility = "visible"; document.dispatchEvent(new Event("visibilitychange"));
  await waitFor(() => expect(count("/api/control/summary")).toBe(hidden.summary + 1));
  await waitFor(() => expect(count("/api/control/overview")).toBe(hidden.overview + 1));
  await waitFor(() => expect(count("/api/todo")).toBe(hidden.todo + 1));
  // The summary tick and the Overview pane each read recovery (the panel's summary pull always did).
  await waitFor(() => expect(count("/api/control/recovery")).toBe(hidden.recovery + 2));
});
