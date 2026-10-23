// @vitest-environment jsdom
/**
 * Tester round 2 spec §4.2.3 (ruling H1, C4) and §4.2.5 (review C1): an estimate run over its grant is a warning line on
 * the group, never a stop; a group a work run blocked says which run and why, and its preparation editors turn read-only
 * (the server refuses every prestart command there); a token deficit an estimate left names the one way out.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { AgentSelectionPreviewV1, AgentsViewV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";
import { amount, config, run, view } from "./fixtures/board.js";

afterEach(cleanup);

const draft = (runs: RunViewV1[], over: Partial<GroupViewV1> = {}): GroupViewV1 => {
  const base = view([], runs);
  return { ...base, summary: { ...base.summary, state: "draft" }, proposal: { ...base.proposal, state: "editable", profiles: null, budgetMode: null, executionSnapshotHash: null }, ...over };
};
const estimateRun = (over: Partial<RunViewV1>): RunViewV1 => run({ runId: "run-est", taskId: null, estimateId: "est-1", phase: "estimate", state: "settled-restartable", ...over });
const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [] } as unknown as AgentsViewV1;
const preview = (v: GroupViewV1): AgentSelectionPreviewV1 => ({
  schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: v.proposal.proposalVersion, groupOverrides: {}, taskOverrides: {},
  planLayers: { group: {}, tasks: {} }, slots: [], selectionsHash: "9".repeat(64),
} as unknown as AgentSelectionPreviewV1);
const show = (v: GroupViewV1) => render(<ControlGroupView view={v} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} agents={agents} preview={preview(v)} />);

describe("estimate over its grant (C4)", () => {
  it("shows one status line per over dimension naming the run, the dimension, used and grant", () => {
    const over = estimateRun({ used: { tokens: 1_200_000, activeMs: 2_000_000, attempts: 1, sessions: 1 }, grant: { tokens: 1_000_000, activeMs: 1_800_000, attempts: 1, sessions: 1 }, overGrant: ["tokens", "activeMs"] });
    show(draft([over]));
    const lines = screen.getAllByTestId("estimate-over-grant");
    expect(lines.map((line) => line.textContent)).toEqual([
      "Estimate run run-est used 1.2M tokens, over its grant of 1M. It was not stopped and the group was not blocked; the estimate is advice only.",
      "Estimate run run-est used 2000000 activeMs, over its grant of 1800000. It was not stopped and the group was not blocked; the estimate is advice only.",
    ]);
    for (const line of lines) expect(line.getAttribute("role")).toBe("status");
    // An estimate overrun is never the blocked banner, and leaves the confirm offered.
    expect(screen.queryByTestId("blocked-banner")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm task plan", hidden: true })).toBeTruthy();
  });

  it("shows nothing for an estimate run within its grant, or a work run over it", () => {
    show(draft([estimateRun({ overGrant: [] }), run({ runId: "run-w", overGrant: ["tokens"], grant: amount(5) })]));
    expect(screen.queryByTestId("estimate-over-grant")).toBeNull();
  });
});

describe("a blocked group (C4)", () => {
  it("names the first non-estimate over-grant run in an alert and turns the preparation editors read-only", () => {
    const v = draft([
      estimateRun({ overGrant: ["tokens"], grant: amount(100) }),
      run({ runId: "run-w", used: amount(150), grant: amount(100), overGrant: ["tokens"] }),
    ]);
    // A blocked group opens on Progress, so the Preparation panel is hidden: the queries below include hidden nodes.
    show({ ...v, summary: { ...v.summary, state: "blocked" } });
    const alert = screen.getByTestId("blocked-banner");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe("This group is blocked: run run-w went over its tokens grant (150 of 100). No new step starts in it, and preparation changes are refused.");
    expect(screen.queryByRole("button", { name: "Confirm task plan", hidden: true })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set group worker agent", hidden: true })).toBeNull();
  });

  it("keeps both editors open for the same group while it is a draft", () => {
    show(draft([run({ runId: "run-w", used: amount(150), grant: amount(100), overGrant: ["tokens"] })]));
    expect(screen.getByRole("button", { name: "Confirm task plan", hidden: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set group worker agent", hidden: true })).toBeTruthy();
  });
});

describe("a token deficit an estimate left (§4.2.5)", () => {
  it("names the deficit and the limit raise", () => {
    const base = draft([estimateRun({ overGrant: ["tokens"], grant: amount(100), used: amount(150) })]);
    show({ ...base, ledger: { ...base.ledger, budgetDeficit: { tokens: 50_000, activeMs: 0, attempts: 0, sessions: 0 } } });
    expect(screen.getByTestId("estimate-deficit").textContent).toBe("An estimate run went over this group's token limit by 50K. Raise the limit (proposed group limit) to continue; other changes are refused until then.");
  });

  it("says nothing without a deficit", () => {
    show(draft([estimateRun({ overGrant: ["tokens"], grant: amount(100), used: amount(150) })]));
    expect(screen.queryByTestId("estimate-deficit")).toBeNull();
  });
});
