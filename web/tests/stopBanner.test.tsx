// @vitest-environment jsdom
/**
 * Issue-fixes spec §3.2 (3), (4) and §3.4: a group stopped by a panel shutdown is left through the same resume dialog as a
 * human handoff-stop, every stopped group shows one banner (how it stopped, its state, the one way out), and the buttons
 * the stop mode refuses -- Start, Pause dispatch, Handoff stop -- are not rendered.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-08T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const settled: RunViewV1 = {
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "settled-restartable", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], continuable: false,
};
type Stop = NonNullable<GroupViewV1["stop"]>;
const view = (state: GroupViewV1["summary"]["state"], stop: Stop | null): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state, commandRevision: 6, projectionSeq: 4, stopMode: stop?.mode ?? null, stopState: stop?.state ?? null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000), used: amount(10), committedRemaining: amount(0), explicitUnallocatedReserve: amount(8_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [], estimates: [], runs: [settled], checkpoints: [], handoffRequests: [], stop, recoveryBlockers: [], recentCommandIds: [],
});
const shutdownStop = (state: Stop["state"]): Stop =>
  ({ mode: "shutdown", state, frozenRunIds: ["run-a"], acceptedAt: "2026-10-08T00:00:00.000Z", deadlineAt: "2026-10-08T00:02:00.000Z" });
const mount = (shown: GroupViewV1, onCommand = vi.fn()) => {
  render(<ControlGroupView view={shown} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
  return onCommand;
};
const refusedButtons = ["Start", "Pause dispatch", "Handoff stop"];

afterEach(cleanup);

describe("leaving a panel shutdown (issue-fixes spec §3.2 (3))", () => {
  it("renders the resume dialog for a shutdown/handoff-complete group and no Start, Pause or Handoff-stop button", () => {
    const onCommand = mount(view("ready", shutdownStop("handoff-complete")));
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
  });

  it("offers no resume and none of the refused buttons while the shutdown's frozen runs are still settling", () => {
    mount(view("running", shutdownStop("handoff-pending")));
    expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
  });
});

describe("the stop banner (issue-fixes spec §3.2 (4))", () => {
  it("says how the group stopped, its state, and the one way out, at the top of the group view", () => {
    const { container } = render(<ControlGroupView view={view("ready", shutdownStop("handoff-complete"))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const banner = screen.getByTestId("stop-banner");
    expect(banner.textContent).toContain("Stopped: the panel shut down while runs were active.");
    expect(banner.textContent).toContain("Ready to resume: use the resume button under Dispatch.");
    expect(banner.textContent).toContain("stop shutdown handoff-complete");
    // Above the plan line and everything after it: the first thing under the heading.
    const heading = container.querySelector("h2")!;
    expect(heading.nextElementSibling).toBe(banner);
  });

  it("names the settling state while a handoff-stop is still pending", () => {
    mount(view("running", { mode: "handoff", state: "handoff-pending", frozenRunIds: ["run-a"], acceptedAt: "2026-10-08T00:00:00.000Z", deadlineAt: "2026-10-08T00:30:00.000Z" }));
    expect(screen.getByTestId("stop-banner").textContent).toContain("Stopping: the frozen runs are still settling.");
  });

  it("does not offer Start on a paused ready group, because start refuses any stop intent; Resume dispatch is its way out", () => {
    const onCommand = mount(view("ready", { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null }));
    expect(screen.getByTestId("stop-banner").textContent).toContain("Way out: press Resume dispatch under Dispatch.");
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume dispatch" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-dispatch", groupId: "g", expectedRevision: 6, payload: {} });
  });

  it("renders no banner, and the Start button, for a ready group with no stop intent", () => {
    mount(view("ready", null));
    expect(screen.queryByTestId("stop-banner")).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("shows the banner in Chinese", async () => {
    await i18n.changeLanguage("zh");
    mount(view("ready", shutdownStop("handoff-complete")));
    const text = screen.getByTestId("stop-banner").textContent ?? "";
    expect(text).toContain("已停止：面板关闭时有运行在跑。");
    expect(text).toContain("可以恢复了：用「派发」下的恢复按钮。");
    expect(screen.getByRole("button", { name: "恢复（不续跑）" })).toBeTruthy();
  });
});
