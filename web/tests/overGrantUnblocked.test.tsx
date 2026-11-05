// @vitest-environment jsdom
/**
 * Session 3cfc2e73 D2 (spec 2026-11-05 §3.2): in a group with no token limit a run over its grant does not block the
 * group; the detail view says so in a status line per over dimension, and the Board card carries an over-grant chip.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { AgentSelectionPreviewV1, AgentsViewV1, GroupSummaryV1, GroupViewV1 } from "../src/controlTypes.js";
import "../src/i18n.js";
import { amount, config, run, view } from "./fixtures/board.js";

afterEach(cleanup);

const agents = { schema: "orca-agents-view-v1", installations: [] } as unknown as AgentsViewV1;
const preview = (v: GroupViewV1) => ({ schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: v.proposal.proposalVersion, groupOverrides: {}, taskOverrides: {},
  planLayers: { group: {}, tasks: {} }, slots: [], selectionsHash: "9".repeat(64) } as unknown as AgentSelectionPreviewV1);
const show = (v: GroupViewV1) => render(<ControlGroupView view={v} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} agents={agents} preview={preview(v)} onRereadPreview={() => {}} />);
const withState = (state: GroupViewV1["summary"]["state"]) => {
  const base = view([], [run({ runId: "run-w", used: amount(150), grant: amount(100), overGrant: ["tokens"] })]);
  return { ...base, summary: { ...base.summary, state } };
};

describe("a run over its grant in a group that is not blocked", () => {
  it("is a status line naming the run, the dimension, used and grant, and never the blocked banner", () => {
    show(withState("running"));
    const line = screen.getByTestId("run-over-grant");
    expect(line.getAttribute("role")).toBe("status");
    expect(line.textContent).toBe("Run run-w used 150 tokens, over its grant of 100. This group has no token limit, so it was not blocked; its other tasks keep running.");
    expect(screen.queryByTestId("blocked-banner")).toBeNull();
  });

  it("is the blocked banner, not the status line, once the group is blocked", () => {
    show(withState("blocked"));
    expect(screen.queryByTestId("run-over-grant")).toBeNull();
    expect(screen.getByTestId("blocked-banner")).toBeTruthy();
  });
});

const summary = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "running", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 1, running: 1, waiting: 0, blocked: 0, done: 0 }, executionPending: false, ...over,
});

describe("the Board's over-grant chip", () => {
  it("shows on a card whose summary says overGrant, and on no other", () => {
    render(<BoardView groups={[summary({ groupId: "g", overGrant: true }), summary({ groupId: "h" })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const chip = within(screen.getByTestId("board-card-g")).getByTestId("board-card-over-grant");
    expect([chip.textContent, chip.getAttribute("data-tone")]).toEqual(["Over grant", "warn"]);
    expect(within(screen.getByTestId("board-card-h")).queryByTestId("board-card-over-grant")).toBeNull();
  });
});
