// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { App } from "../src/App.js";
import { ALPHA, BETA, groupSummary, installFakePanel, planGroupView, type FakePanel } from "./fixtures/twoProjects.js";
import { requirementView } from "./fixtures/requirement.js";

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

it("a project switch during the archive GET cancels the POST for the old scope", async () => {
  const summary = groupSummary("g", ALPHA, { state: "ready", commandRevision: 7 });
  panel.summary = { ...panel.summary, groups: [summary] };
  panel.groupViews.g = planGroupView({ ...summary, commandRevision: 9 });
  const original = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/control/groups/g"
    ? new Promise<Response>((resolve) => { release = resolve; }) : original(input, init)) as typeof fetch;
  render(<App />);
  await openCardMenu();
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
  await waitFor(() => expect(release).toBeDefined());
  fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "beta" } });
  await act(async () => { release!(new Response(JSON.stringify(panel.groupViews.g), { status: 200, headers: { "content-type": "application/json" } })); });
  expect(panel.posts).toHaveLength(0);
});

it.each(["estimate", "integration"] as const)("an enabled Archive with a fresh %s guard receives the server refusal", async (guard) => {
  const summary = groupSummary("g", ALPHA, { state: "ready", commandRevision: 7 });
  panel.summary = { ...panel.summary, groups: [summary] };
  const fresh = planGroupView(summary);
  if (guard === "estimate") fresh.estimates = [{ estimateId: "est-1", estimateVersion: 1, state: "start-unknown", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft", requestHash: null, outputHash: null, output: null, reasonCode: null }];
  else fresh.integration = { scheme: { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" }, schemeHash: "h", frozen: true, state: "resolving", reason: null, lastIntegrated: null, integratedCommit: null, pr: null };
  panel.groupViews.g = fresh;
  const code = guard === "estimate" ? "archive-call-in-flight" : "archive-integration-resolving";
  panel.onPost = async () => new Response(JSON.stringify({ error: { code, message: "not eligible", commandRevision: 7 } }),
    { status: 409, headers: { "content-type": "application/json" } });
  render(<App />);
  await openCardMenu();
  const archive = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }) as HTMLButtonElement;
  expect(archive.disabled).toBe(false);
  fireEvent.click(archive);
  await waitFor(() => expect(panel.posts).toHaveLength(1));
  expect((await screen.findByTestId("card-refusal-g")).textContent).toContain(code);
});

it.each([false, true])("accepted requirement opens the same group's Preparation tab (previously mounted: %s)", async (mounted) => {
  const accepted = requirementView("awaiting-review");
  accepted.summary = { ...accepted.summary, groupId: "r", repoId: ALPHA, state: "ready" };
  accepted.requirement = { ...accepted.requirement, repoId: ALPHA, acceptedDraftNo: 1 };
  accepted.drafts[0]!.state = "accepted";
  panel.summary = { ...panel.summary, groups: [accepted.summary] };
  panel.requirementViews.r = accepted;
  panel.groupViews.r = planGroupView(accepted.summary);
  window.location.hash = mounted ? "#tasks" : "#requirements";
  render(<App />);
  if (mounted) {
    const tasks = await screen.findByRole("navigation", { name: "Control groups" });
    fireEvent.click(within(tasks).getByRole("button", { name: /r · ready/ }));
    await screen.findByRole("region", { name: "Control group r" });
    fireEvent.click(screen.getByRole("tab", { name: "Problems" }));
    await act(async () => { window.location.hash = "#requirements"; window.dispatchEvent(new Event("hashchange")); });
  }
  const requirements = await screen.findByRole("navigation", { name: "Requirement list" });
  fireEvent.click(within(requirements).getByRole("button", { name: /r · ready/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Go to task preparation" }));
  const detail = await screen.findByRole("region", { name: "Control group r" });
  await waitFor(() => expect(within(detail).getByRole("tab", { name: "Preparation" }).getAttribute("aria-selected")).toBe("true"));
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
  // Spec 2026-10-13-unmetered-usage-settlement-design.md §B.3: the refusal offers the way to the group's dispatch controls.
  fireEvent.click(within(screen.getByTestId("card-refusal-g").parentElement!).getByRole("button", { name: "Open dispatch controls" }));
  const detail = await screen.findByRole("region", { name: "Control group g" });
  await waitFor(() => expect(within(detail).getByRole("tab", { name: "Preparation" }).getAttribute("aria-selected")).toBe("true"));
  expect(panel.posts).toHaveLength(1);
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
