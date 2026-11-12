// @vitest-environment jsdom
/**
 * Feedback #59: the group view sends runs in id order (the wire's canonical set order), and run ids are UUIDs, so the
 * Runs table read as a random order. Each run also carries `createdOrdinal`, its creation position; the Runs table
 * shows rows in that order and numbers its "Run n" fallback label by the same position. A view without the field on
 * every run keeps the order it was sent in.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-25T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
// Review-style runs (no task, no estimate) so the run cell shows the "Run n" label.
const run = (runId: string, createdOrdinal?: number): RunViewV1 => ({
  runId, taskId: null, estimateId: null, generation: 1, state: "settled-restartable", phase: "work", claimOrdinal: null, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [],
  ...(createdOrdinal === undefined ? {} : { createdOrdinal }),
});
const view = (runs: RunViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [], workItems: [], estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const rows = (container: HTMLElement): Array<[string | null, string]> =>
  [...container.querySelectorAll("tr[data-run-id]")].map((row) => [row.getAttribute("data-run-id"), row.querySelector("td summary")?.textContent ?? ""]);
// Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — #219/R1: a group's regions other than the selected
// one are no longer rendered, so the Runs table exists only once its tab is opened; the criterion opens it as a person does.
const renderRuns = (runs: RunViewV1[]) => {
  const { container } = render(<ControlGroupView view={view(runs)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Runs and evidence" }));
  return container;
};

beforeEach(async () => { await i18n.changeLanguage("en"); });
afterEach(cleanup);

describe("the Runs table's order (feedback #59)", () => {
  // Ruling (2026-11-11, tester follow-up E): 「这次批准改写所有必要的判据」 — #244: the open run's transcript and evidence are
  // a full-width box below the runs table (was: a detail row spanning its six columns), so the table's 40rem narrow-screen
  // width never widens the transcript. The box is what the row's disclosure controls.
  it("opens one run's transcript and evidence full width below the table, outside it", () => {
    const container = renderRuns([{ ...run("run-a", 1), evidenceIds: ["ev-1"] }]);
    const table = container.querySelector('[data-overview-region="runs"] table')!;
    expect(table.classList.contains("runs-table")).toBe(true);
    expect(table.querySelectorAll("thead th")).toHaveLength(6);
    const trigger = table.querySelector<HTMLButtonElement>('tr[data-run-id="run-a"] button[aria-expanded="false"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("Open run Run 1");
    fireEvent.click(trigger);
    const detail = container.querySelector('[data-overview-region="runs"] [data-run-detail="run-a"]')!;
    expect(detail.closest("table")).toBeNull();
    expect(detail.id).toBe(trigger.getAttribute("aria-controls"));
    expect(detail.querySelector('section[aria-label="Transcript of run-a"] button')).toBeTruthy();
    expect(detail.querySelector("button")?.textContent).toMatch(/Transcript|evidence/);
    expect(detail.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
    expect(detail.textContent).toContain("ev-1");
  });
  it("shows runs in creation order and numbers Run 1..3 by it, though the view sends them in id order", () => {
    // Sent in id order a, m, z; created m, z, a.
    const container = renderRuns([run("a-third", 3), run("m-first", 1), run("z-second", 2)]);
    expect(rows(container)).toEqual([["m-first", "Run 1"], ["z-second", "Run 2"], ["a-third", "Run 3"]]);
  });
  it("keeps the order the view sent when any run lacks its creation position", () => {
    const container = renderRuns([run("a-third", 3), run("m-first"), run("z-second", 2)]);
    expect(rows(container)).toEqual([["a-third", "Run 1"], ["m-first", "Run 2"], ["z-second", "Run 3"]]);
  });
  it("distinguishes two runs of the same task in each expand button's accessible name", () => {
    const container = renderRuns([{ ...run("first", 1), taskId: "task-a" }, { ...run("second", 2), taskId: "task-a" }]);
    const triggers = [...container.querySelectorAll<HTMLButtonElement>('tr[data-run-id] button[aria-expanded]')];
    expect(triggers.map((button) => button.getAttribute("aria-label"))).toEqual(["Open run task-a · Run 1", "Open run task-a · Run 2"]);
    expect(triggers.map((button) => button.closest("td")?.textContent)).toEqual(["▸ task-a", "▸ task-a"]);
    fireEvent.click(triggers[0]!);
    expect(triggers[0]!.getAttribute("aria-label")).toBe("Close run task-a · Run 1");
  });
});
