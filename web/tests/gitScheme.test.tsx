// @vitest-environment jsdom
/**
 * Board spec 2026-10-03 B3, B4, D4-D7: the group's Git section (work branch, the mode new runs use, each task run's
 * workspace and landing, merge into main and push waiting on a person) and the loop plan card's git line following the
 * repository's mode.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import type { ControlSummaryV1, GroupViewV1, RecoveryViewV1, RepositoryWorkspaceV1 } from "../src/controlTypes.js";
import { PLAN, config, run, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const workspace = (repoId: string, workspaceMode: "worktree" | "clone"): RepositoryWorkspaceV1 => ({ schema: "orca-repository-workspace-v1", repoId, workspaceMode, revision: 3 });
const show = (groupView: GroupViewV1, ws?: RepositoryWorkspaceV1 | null) =>
  render(<ControlGroupView view={groupView} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} workspace={ws} />);
const section = () => screen.getByRole("region", { name: "Git" });

describe("the Git section (spec B3)", () => {
  it("names the work branch and shows merge into main and push as waiting on a person, with no button for either", () => {
    show(view([workItem({})]));
    const text = section().textContent ?? "";
    expect(text).toContain("Work branch orca/g, created from the repository's HEAD");
    expect(text).toContain("Merge into main: waiting on a person");
    expect(text).toContain("Push: waiting on a person");
    expect(within(section()).queryAllByRole("button")).toEqual([]);
  });

  it("lists each task run's workspace, start commit and landing, and leaves out runs without git facts", () => {
    const base = "1".repeat(40), landed = "2".repeat(40);
    show(view([workItem({})], [
      run({ runId: "run-a", git: { workspaceMode: "clone", base, landedCommit: landed } }),
      run({ runId: "run-b", taskId: "b", git: { workspaceMode: "worktree", base, landedCommit: null } }),
      run({ runId: "run-c", taskId: "c", git: null }),
      run({ runId: "run-e", taskId: null, estimateId: "e", phase: "estimate", git: { workspaceMode: "worktree", base: null, landedCommit: null } }),
    ]));
    const rows = within(within(section()).getByRole("table", { name: "Runs and their landings" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent))).toEqual([
      ["a", "run-a", "a private clone", "111111111111", "222222222222"],
      ["b", "run-b", "a git worktree", "111111111111", "not landed"],
    ]);
  });

  it("says so when no task run has a workspace yet", () => {
    show(view([workItem({})], [run({ git: null })]));
    expect(section().textContent).toContain("No task run has a workspace yet.");
  });

  it("gives the mode new runs use only from a read of this group's repository", () => {
    show(view([workItem({})]), workspace("orca", "clone"));
    expect(section().textContent).toContain("New runs use a private clone");
    cleanup();
    show(view([workItem({})]), workspace("other", "clone"));
    expect(section().textContent).toContain("Workspace mode of new runs: not read yet");
    cleanup();
    show(view([workItem({})]), null);
    expect(section().textContent).toContain("Workspace mode of new runs: not read yet");
  });
});

describe("the page's read of the mode reaches the group (spec B3)", () => {
  it("passes the control panel's workspace read on to the open group's Git section", () => {
    const groupView = view([workItem({})]);
    const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [groupView.summary] };
    const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
    render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{ g: groupView }} selected="g" drafts={{}} uncertain={[]} refusal={null}
      refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} workspace={workspace("orca", "clone")} />);
    expect(section().textContent).toContain("New runs use a private clone");
  });
});

describe("the loop plan card's git line (spec D7)", () => {
  const card = (ws?: RepositoryWorkspaceV1 | null): string => {
    show(view([workItem({ taskId: "a", loopPlan: PLAN })]), ws);
    fireEvent.click(screen.getByRole("button", { name: "a", expanded: false }));
    return screen.getByRole("region", { name: "Plan a" }).textContent ?? "";
  };

  it("says clone when the repository's mode is clone", () => {
    expect(card(workspace("orca", "clone"))).toContain("Git workspace: its own private clone, merged back into orca/g; pushing is done by a person");
  });

  it("says worktree when the mode is worktree, and when the caller never reads the mode", () => {
    expect(card(workspace("orca", "worktree"))).toContain("Git workspace: its own worktree, merged back into orca/g");
    cleanup();
    expect(card(undefined)).toContain("Git workspace: its own worktree, merged back into orca/g");
  });

  it("says the mode is not read yet when the page has not read it, or read another repository", () => {
    expect(card(null)).toContain("Git workspace: the repository's mode is not read yet");
    cleanup();
    expect(card(workspace("other", "clone"))).toContain("Git workspace: the repository's mode is not read yet");
  });
});
