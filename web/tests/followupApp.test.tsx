// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { App } from "../src/App.js";
import { ALPHA, BETA, groupSummary, installFakePanel, planGroupView, type FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
beforeEach(() => { panel = installFakePanel(); });
afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); window.location.hash = ""; });

async function openCardMenu(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Control groups" });
  await waitFor(() => expect(within(nav).getByRole("button", { name: /g · ready/ })).toBeTruthy());
  fireEvent.click(within(nav).getByRole("button", { name: "More actions" }));
}

it("card archive reads the current group revision and does not start execution", async () => {
  const summary = groupSummary("g", ALPHA, { state: "ready", commandRevision: 7 });
  panel.summary = { ...panel.summary, groups: [summary] };
  panel.groupViews.g = planGroupView({ ...summary, commandRevision: 9 });
  render(<App />);
  await openCardMenu();
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
  await waitFor(() => expect(panel.posts).toHaveLength(1));
  expect(panel.posts[0]!.url).toBe("/api/control/groups/g/archive");
  expect(panel.posts[0]!.body).toMatchObject({ expectedRevision: 9 });
  expect(panel.posts.some((post) => post.url.endsWith("/start"))).toBe(false);
});

it("a fresh read owned by another repository cannot archive the old card", async () => {
  const summary = groupSummary("g", ALPHA, { state: "ready", commandRevision: 7 });
  panel.summary = { ...panel.summary, groups: [summary] };
  panel.groupViews.g = planGroupView({ ...summary, repoId: BETA, commandRevision: 9 });
  render(<App />);
  await openCardMenu();
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
  await waitFor(() => expect(panel.requests.some((request) => request === "GET /api/control/groups/g")).toBe(true));
  expect(panel.posts).toHaveLength(0);
});

it("a server archive refusal remains visible at the card where it was requested", async () => {
  const summary = groupSummary("g", ALPHA, { state: "ready", commandRevision: 7 });
  panel.summary = { ...panel.summary, groups: [summary] };
  panel.groupViews.g = planGroupView(summary);
  panel.onPost = async () => new Response(JSON.stringify({ error: { code: "archive-run-active", message: "still active", commandRevision: 7 } }),
    { status: 409, headers: { "content-type": "application/json" } });
  render(<App />);
  await openCardMenu();
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
  expect((await screen.findByTestId("card-refusal-g")).textContent).toContain("archive-run-active");
});

it("a running chain keeps its banner and Stop access while advanced navigation is off", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/chains"
    ? Promise.resolve(new Response(JSON.stringify({ repos: [{ repoKey: "alpha", defaultSessionTimeoutMin: 30, problem: null,
      chain: { chainId: "chain-1", goal: "Improve Orca", by: "owner", via: "panel", startedAt: "2026-10-11T00:00:00.000Z", state: "running", holderGone: false, sessionsDone: 0, costUsd: 0, stop: null } }] }),
      { status: 200, headers: { "content-type": "application/json" } })) : original(input, init)) as typeof fetch;
  render(<App />);
  const label = await screen.findByText("Continuous improvement chain-1 is running");
  const banner = label.closest('[role="status"]') as HTMLElement;
  expect(within(banner).getByRole("button", { name: "Stop chain" })).toBeTruthy();
});
