// @vitest-environment jsdom
/**
 * Project filtering spec §11 R1: a recovery Retry belongs to its blocker's own group. The command carries that group's
 * current summary revision -- never the open detail's -- whether the group is an ordinary one, a clarifying one (no group
 * view; the requirement view is read instead) or the owner of a run-scoped blocker. A blocker whose group has no valid
 * summary, whose epoch is not the summary's, that a complete re-read is still pending for, or that is no longer listed
 * stays visible but cannot be retried: the page offers a Re-read, which only reads, and an old button sends nothing.
 *
 * The App criteria open group a1 (Alpha, revision 3) while the blocker belongs to b1 (Beta, revision 9), so a client that
 * borrowed the open group's revision would send 3 -- the bug R1 removes. The pure criteria pin each refusal branch of
 * recoveryRetryAction one by one, each with every other condition satisfied, so a mutation dropping that one branch is seen.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { initialControlState } from "../src/controlState.js";
import type { ControlClientState } from "../src/controlState.js";
import type { GroupSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { recoveryRetryAction } from "../src/recoveryTarget.js";
import type { RecoveryTarget } from "../src/recoveryTarget.js";
import { requirementView } from "./fixtures/requirement.js";
import { ALPHA, BETA, groupSummary, installFakePanel, planGroupView, twoConfig } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
beforeEach(() => { panel = installFakePanel(); });
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

type Blocker = RecoveryViewV1["blockers"][number];
const RETRY = "/api/control/recovery/retry";

/** a1 in Alpha at revision 3 (the group the person opens), `b1` as given, and the recovery view listing `blockers`. */
function seed(b1: GroupSummaryV1, blockers: Blocker[]): void {
  const a1 = groupSummary("a1", ALPHA, { commandRevision: 3 });
  panel.summary = { ...panel.summary, groups: [a1, b1] };
  panel.groupViews["a1"] = planGroupView(a1);
  if (b1.state !== "clarifying") panel.groupViews["b1"] = planGroupView(b1);
  panel.recovery = { ...panel.recovery, blockers };
}

const openA1 = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: /^a1 · / }));
  await screen.findByRole("region", { name: "Control group a1" });
};
/** The recovery list's row naming `groupId` (the global list's rows, not the open group's own). */
const blockerRow = async (groupId: string): Promise<HTMLElement> => {
  const region = await screen.findByRole("region", { name: "Recovery" });
  let row: HTMLElement | undefined;
  await waitFor(() => {
    row = within(region).getAllByRole("listitem").find((item) => item.textContent?.includes(` · ${groupId}`));
    expect(row).toBeDefined();
  });
  return row!;
};
const retryPosts = (): FakePanel["posts"] => panel.posts.filter((post) => post.url === RETRY);

describe("App: a recovery Retry carries its own group's revision", () => {
  it("1: with a1 (rev 3) open, retrying b1's group blocker sends b1 at revision 9", async () => {
    seed(groupSummary("b1", BETA, { commandRevision: 9, recoveryBlockerCount: 1 }), [{ scope: "group", groupId: "b1", runId: null, code: "cleanup-pending", evidenceIds: [] }]);
    render(<App />);
    await openA1();
    const row = await blockerRow("b1");
    const retry = within(row).getByRole("button", { name: "Retry recovery" }) as HTMLButtonElement;
    await waitFor(() => expect(retry.disabled).toBe(false));
    // The row names b1's own repository (Beta), not the open group's project; an actionable row offers no Re-read.
    expect(row.textContent).toContain("b1 · Beta");
    expect(within(row).queryByRole("button", { name: "Re-read" })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(retryPosts()).toHaveLength(1));
    expect(retryPosts()[0]!.body).toMatchObject({ expectedRevision: 9, payload: { scope: "group", groupId: "b1" } });
  });

  it("2: a clarifying b1 is retried at its summary's revision 9, and its requirement view -- not a group view -- is read", async () => {
    const requirement = requirementView("awaiting-answers");
    const b1 = { ...requirement.summary, groupId: "b1", repoId: BETA, commandRevision: 9 };
    panel.requirementViews["b1"] = { ...requirement, epoch: "epoch-a", summary: b1, requirement: { ...requirement.requirement, repoId: BETA } };
    seed(b1, [{ scope: "group", groupId: "b1", runId: null, code: "cleanup-pending", evidenceIds: [] }]);
    render(<App />);
    await openA1();
    const retry = within(await blockerRow("b1")).getByRole("button", { name: "Retry recovery" }) as HTMLButtonElement;
    await waitFor(() => expect(retry.disabled).toBe(false));
    fireEvent.click(retry);
    await waitFor(() => expect(retryPosts()).toHaveLength(1));
    expect(retryPosts()[0]!.body).toMatchObject({ expectedRevision: 9, payload: { scope: "group", groupId: "b1" } });
    await waitFor(() => expect(panel.requests).toContain("GET /api/control/groups/b1/requirement"));
    // The group view endpoint refuses a clarifying group (DR25): reading it would only put group-not-found on screen.
    expect(panel.requests).not.toContain("GET /api/control/groups/b1");
  });

  it("3: a run-scoped b1 blocker sends the run payload at b1's revision 9", async () => {
    seed(groupSummary("b1", BETA, { commandRevision: 9, recoveryBlockerCount: 1 }), [{ scope: "run", groupId: "b1", runId: "run-b", code: "attempt-outcome-unknown", evidenceIds: [] }]);
    render(<App />);
    await openA1();
    const retry = within(await blockerRow("b1")).getByRole("button", { name: "Retry recovery" }) as HTMLButtonElement;
    await waitFor(() => expect(retry.disabled).toBe(false));
    fireEvent.click(retry);
    await waitFor(() => expect(retryPosts()).toHaveLength(1));
    expect(retryPosts()[0]!.body).toMatchObject({ expectedRevision: 9, payload: { scope: "run", runId: "run-b" } });
  });

  it("4: a blocker of zz, which has no summary, stays visible with a disabled Retry; Re-read reads the summary and sends nothing", async () => {
    seed(groupSummary("b1", BETA, { commandRevision: 9 }), [{ scope: "group", groupId: "zz", runId: null, code: "cleanup-pending", evidenceIds: [] }]);
    render(<App />);
    await openA1();
    const row = await blockerRow("zz");
    // No summary, so no known repository: the explicit group id alone, never the open group's or another's label.
    expect(row.textContent).toContain("zz · cleanup-pending");
    expect((within(row).getByRole("button", { name: "Retry recovery" }) as HTMLButtonElement).disabled).toBe(true);
    const summaryReads = (): number => panel.requests.filter((request) => request.startsWith("GET /api/control/summary")).length;
    const before = summaryReads();
    fireEvent.click(within(row).getByRole("button", { name: "Re-read" }));
    // The read starts in the click itself: no poll tick can be the one counted here.
    expect(summaryReads()).toBe(before + 1);
    await act(async () => { await Promise.resolve(); });
    expect(panel.posts.filter((post) => post.url.startsWith("/api/control/"))).toEqual([]);
  });

  // App's reducer voids its caches when the recovery view's epoch differs from the summary's (controlState.ts
  // reduceRecovery), so App never renders such a pair; ControlPanel, given one, must still refuse the Retry.
  it("5: a recovery view at epoch-b while the summary is at epoch-a leaves the blocker visible and its Retry disabled", () => {
    const b1 = groupSummary("b1", BETA, { commandRevision: 9, recoveryBlockerCount: 1 });
    const onCommand = vi.fn();
    render(
      <ControlPanel config={twoConfig} summary={{ ...panel.summary, groups: [b1] }} groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={null}
        refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={onCommand}
        recovery={{ ...panel.recovery, epoch: "epoch-b", blockers: [{ scope: "group", groupId: "b1", runId: null, code: "cleanup-pending", evidenceIds: [] }] }} />,
    );
    const row = within(screen.getByRole("region", { name: "Recovery" })).getAllByRole("listitem").find((item) => item.textContent?.includes(" · b1"))!;
    expect(row.textContent).toContain("cleanup-pending");
    const retry = within(row).getByRole("button", { name: "Retry recovery" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("6: once a poll no longer lists the blocker, no Retry for it remains", async () => {
    seed(groupSummary("b1", BETA, { commandRevision: 9, recoveryBlockerCount: 1 }), [{ scope: "group", groupId: "b1", runId: null, code: "cleanup-pending", evidenceIds: [] }]);
    render(<App />);
    await openA1();
    await blockerRow("b1");
    panel.recovery = { ...panel.recovery, blockers: [] };
    const region = screen.getByRole("region", { name: "Recovery" });
    await waitFor(() => expect(within(region).queryAllByRole("listitem").some((item) => item.textContent?.includes(" · b1"))).toBe(false), { timeout: 5_000 });
    expect(within(region).queryAllByRole("button", { name: "Retry recovery" })).toEqual([]);
  }, 10_000);
});

describe("recovery blockers across an epoch change, and a Retry with no App sender", () => {
  it("7: a recovery read of a new epoch before its summary keeps the blocker listed but not retryable, until the complete summary lands", async () => {
    seed(groupSummary("b1", BETA, { commandRevision: 9, recoveryBlockerCount: 1 }), [{ scope: "group", groupId: "b1", runId: null, code: "cleanup-pending", evidenceIds: [] }]);
    render(<App />);
    const retryOf = async (): Promise<HTMLButtonElement> => within(await blockerRow("b1")).getByRole("button", { name: "Retry recovery" }) as HTMLButtonElement;
    await waitFor(async () => expect((await retryOf()).disabled).toBe(false));
    // The server restarted: its recovery view answers in epoch-b while the summary the next tick reads is still epoch-a.
    panel.recovery = { ...panel.recovery, epoch: "epoch-b" };
    await waitFor(() => expect(screen.getByText(/projection refetch required/)).toBeTruthy(), { timeout: 5_000 });
    const stale = await retryOf();
    expect(stale.disabled).toBe(true);
    fireEvent.click(stale);
    expect(retryPosts()).toEqual([]);
    // The complete summary of epoch-b lands: the blocker's own summary is valid again and Retry is offered.
    panel.summary = { ...panel.summary, epoch: "epoch-b", changeSeq: 1 };
    await waitFor(async () => expect((await retryOf()).disabled).toBe(false), { timeout: 5_000 });
    fireEvent.click(await retryOf());
    await waitFor(() => expect(retryPosts()).toHaveLength(1));
    expect(retryPosts()[0]!.body).toMatchObject({ expectedRevision: 9, payload: { scope: "group", groupId: "b1" } });
  }, 15_000);

  it("8: ControlPanel without an App sender builds the target's own action and hands it to onCommand", () => {
    const a1 = groupSummary("a1", ALPHA, { commandRevision: 3 });
    const b1 = groupSummary("b1", BETA, { commandRevision: 9, recoveryBlockerCount: 1 });
    const onCommand = vi.fn();
    render(
      <ControlPanel config={twoConfig} summary={{ ...panel.summary, groups: [a1, b1] }} groups={{ a1: planGroupView(a1) }} selected="a1" drafts={{}} uncertain={[]} refusal={null}
        refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={onCommand}
        recovery={{ ...panel.recovery, blockers: [{ scope: "group", groupId: "b1", runId: null, code: "cleanup-pending", evidenceIds: [] }] }} />,
    );
    const row = within(screen.getByRole("region", { name: "Recovery" })).getAllByRole("listitem").find((item) => item.textContent?.includes(" · b1"))!;
    fireEvent.click(within(row).getByRole("button", { name: "Retry recovery" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "b1", expectedRevision: 9, payload: { scope: "group", groupId: "b1" } });
  });
});

describe("recoveryRetryAction: built now, from the target's own summary, or not at all", () => {
  const b1 = groupSummary("b1", BETA, { commandRevision: 9 });
  const a1 = groupSummary("a1", ALPHA, { commandRevision: 3 });
  const target: RecoveryTarget = { source: "recovery", epoch: "epoch-a", groupId: "b1", runId: null, code: "cleanup-pending" };
  /** Every condition met: the epoch agrees, no re-read is pending, b1 is listed and summarised (after a1). */
  const state = (over: Partial<ControlClientState> = {}): ControlClientState => ({
    ...initialControlState(),
    epoch: "epoch-a",
    groups: { a1, b1 },
    canonical: { a1: planGroupView(a1) },
    recovery: { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [{ scope: "group", groupId: "b1", runId: null, code: "cleanup-pending", evidenceIds: [] }] },
    ...over,
  });

  it("builds b1's command at b1's revision when every condition holds", () => {
    expect(recoveryRetryAction(state(), target)).toEqual({ verb: "recovery-retry", groupId: "b1", expectedRevision: 9, payload: { scope: "group", groupId: "b1" } });
  });

  it("builds a run-scoped command for a group view's run blocker at that group's revision", () => {
    const view = { ...planGroupView(b1), recoveryBlockers: [{ scope: "run" as const, code: "attempt-outcome-unknown", runId: "run-b", evidenceIds: [] }] };
    expect(recoveryRetryAction(state({ canonical: { b1: view } }), { source: "group-view", epoch: "epoch-a", groupId: "b1", runId: "run-b", code: "attempt-outcome-unknown" }))
      .toEqual({ verb: "recovery-retry", groupId: "b1", expectedRevision: 9, payload: { scope: "run", runId: "run-b" } });
  });

  it("refuses an empty (global) groupId", () => {
    const global = state({ recovery: { ...state().recovery!, blockers: [{ scope: "global", groupId: "", runId: null, code: "cleanup-pending", evidenceIds: [] }] }, groups: { a1, b1, "": b1 } });
    expect(recoveryRetryAction(global, { ...target, groupId: "" })).toBeNull();
  });

  it("refuses while a complete re-read is pending", () => {
    expect(recoveryRetryAction(state({ refetchRequired: true }), target)).toBeNull();
  });

  it("refuses when the state's epoch is not the one the button was rendered from", () => {
    // The recovery view and the target agree on epoch-b; only the summary's epoch differs.
    const recovery = { ...state().recovery!, epoch: "epoch-b" };
    expect(recoveryRetryAction(state({ recovery }), { ...target, epoch: "epoch-b" })).toBeNull();
  });

  it("refuses with no epoch at all", () => {
    expect(recoveryRetryAction(state({ epoch: null }), target)).toBeNull();
  });

  it("refuses a blocker the recovery view no longer lists (a vanished blocker's old button)", () => {
    expect(recoveryRetryAction(state({ recovery: { ...state().recovery!, blockers: [] } }), target)).toBeNull();
    // Nor one listed for another run or another code of the same group.
    expect(recoveryRetryAction(state(), { ...target, code: "other" })).toBeNull();
  });

  it("refuses a group-view blocker the group view no longer lists", () => {
    expect(recoveryRetryAction(state({ canonical: { b1: planGroupView(b1) } }), { source: "group-view", epoch: "epoch-a", groupId: "b1", runId: "run-b", code: "attempt-outcome-unknown" })).toBeNull();
  });

  it("refuses when the target group has no summary, never borrowing another group's", () => {
    expect(recoveryRetryAction(state({ groups: { a1 } }), target)).toBeNull();
  });
});
