// @vitest-environment jsdom
/**
 * web/DESIGN.md "Components": one primary per view -- only `.btn-primary` is filled with the accent, so it marks the one
 * thing the page is for. Overview had none (its "New requirement" looked like any row), Tasks' "Import plan" was primary
 * above a group whose own Start or Confirm was not, and an open loop-plan form added a second fill beside Start.
 * Counted in the DOM, hidden regions included: a group's regions stay mounted (GroupDetailRegions.tsx).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/ControlPanel.js";
import { LoopPlanCard } from "../src/LoopPlanCard.js";
import { Overview } from "../src/Overview.js";
import type { ControlSummaryV1, GroupViewV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { PLAN, amount, config, view, workItem } from "./fixtures/board.js";
afterEach(cleanup);

const primaries = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".btn-primary")];
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const summaryOf = (v: GroupViewV1): ControlSummaryV1 => ({ schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [v.summary] });
const withState = (state: GroupViewV1["summary"]["state"], proposal: GroupViewV1["proposal"]["state"] = "confirmed"): GroupViewV1 => {
  const v = view([]);
  return { ...v, summary: { ...v.summary, state }, proposal: { ...v.proposal, state: proposal } };
};
const tasks = (v: GroupViewV1, selected: string | null) => render(<ControlPanel config={config} summary={summaryOf(v)} recovery={recovery} groups={{ g: v }} selected={selected}
  drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onCommand={vi.fn()} onDraft={vi.fn()} />);

describe("one primary button per view (DESIGN.md)", () => {
  // mutation: Overview's New requirement stays a row button -> 0 primaries -> red
  it("Overview: New requirement is the one primary", () => {
    render(<Overview model={{ progress: [], queue: [], issues: [], sources: [], complete: true, scopeUnavailable: false } as never}
      onOpen={vi.fn()} onImport={vi.fn()} onRequirement={vi.fn()} />);
    expect(primaries().map((b) => b.textContent)).toEqual(["New requirement"]);
  });

  // mutation: Import plan keeps btn-primary -> 1 primary with no group open, 2 beside a ready group's Start -> red
  it("Tasks with no group open has no primary; Import plan is secondary", () => {
    tasks(view([]), null);
    // Ruling (2026-11-13, tester follow-up J): 「这次批准改写所有必要的判据」 -- #306: Import a plan is an item of the Tasks page's "New" menu now, not a button of its own.
    expect(screen.getByRole("button", { name: "New" }).classList.contains("btn-primary")).toBe(false);
    expect(primaries()).toHaveLength(0);
  });

  // mutation: Start is not given btn-primary -> 0 primaries -> red
  it("a ready group: Start is the one primary", () => {
    tasks(withState("ready"), "g");
    expect(primaries().map((b) => b.textContent)).toEqual(["Start"]);
  });

  // mutation: Confirm is not given btn-primary while the proposal is editable -> 0 primaries -> red
  // mutation: Confirm is primary whatever the proposal state -> a running group shows a primary Confirm -> the running case is red
  it("a draft group with an editable proposal: Confirm is the one primary", () => {
    tasks(withState("draft", "editable"), "g");
    expect(primaries().map((b) => b.textContent)).toEqual(["Confirm task plan"]);
  });

  it("a running group has no main action to fill", () => {
    tasks(withState("running"), "g");
    expect(primaries()).toHaveLength(0);
  });

  // mutation: the loop plan's submit keeps btn-primary -> a second primary beside Start -> red
  it("an open loop-plan change form adds no second primary", () => {
    const base = withState("ready");
    const item = workItem({ taskId: "a", status: "ready", loopPlan: PLAN });
    const v: GroupViewV1 = { ...base, workItems: [item],
      allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", amount: amount(100) }] as never };
    function Held(): JSX.Element {
      const [drafts, setDrafts] = useState<Record<string, string>>({});
      return <LoopPlanCard view={v} item={item} drafts={drafts} onDraft={(key, text) => setDrafts((all) => ({ ...all, [key]: text }))} onCommand={vi.fn()} />;
    }
    render(<Held />);
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    const form = screen.getByRole("form");
    expect(within(form).getAllByRole("button").length).toBeGreaterThan(0);
    expect(primaries()).toHaveLength(0);
  });
});
