// @vitest-environment jsdom
/**
 * Tester #327 (option A, human-approved): a group that waits on other groups shows them on its Progress region -- each
 * prerequisite's state, tasks done and work branch, the chain behind it indented under it, "Landed" once the server says
 * its dependents stop waiting, and a click that opens that group. A group with no prerequisite has no card at all.
 * Every assertion reads the rendered page after the render under test.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/ControlPanel.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { ControlSummaryV1, GroupSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const summaryOf = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "r", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  branch: `orca/${groupId}`, ...over,
});
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

/** The open group `g` (waiting on `dependsOn`) inside the Tasks page, with `others` as the page's other summaries. */
function showPanel(dependsOn: string[] | undefined, others: GroupSummaryV1[]) {
  const base = view([workItem({ taskId: "a" })]);
  const own = { ...base.summary, groupId: "g", state: "ready" as const, ...(dependsOn === undefined ? {} : { dependsOn }) };
  const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [own, ...others] };
  const onSelect = vi.fn();
  render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{ g: { ...base, summary: own } }} selected="g"
    drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={onSelect} onCommand={vi.fn()} onDraft={vi.fn()} />);
  return { onSelect };
}

const stateOf = (groupId: string) => screen.getByTestId(`dependency-state-${groupId}`);

describe("the group's Dependencies card (tester #327)", () => {
  it("lists each direct prerequisite with its state, tasks done and branch, the chain behind it indented, and opens it on click", () => {
    const { onSelect } = showPanel(["p"], [
      summaryOf("p", { state: "running", counts: { idle: 8, running: 1, waiting: 0, blocked: 0, done: 3 }, completion: { done: 3, total: 12 }, dependsOn: ["q"] }),
      summaryOf("q", { state: "done", completion: { done: 2, total: 2 }, landed: true }),
    ]);
    const card = screen.getByTestId("group-dependencies");
    expect(within(card).getByRole("heading").textContent).toBe("Dependencies");
    // mutation: ControlPanel passes no groupOf -> no card at all, red
    const p = screen.getByTestId("dependency-p");
    expect(stateOf("p").textContent).toBe("Running");
    expect(stateOf("p").getAttribute("data-tone")).toBe("info");
    expect(screen.getByTestId("dependency-tasks-p").textContent).toBe("3/12 tasks done");
    expect(p.textContent).toContain("branch orca/p");
    // The prerequisite's own prerequisite sits under it, not beside it: the chain reads q -> p -> g.
    // mutation: never expand a prerequisite's dependsOn -> no q row, red
    const behind = screen.getByTestId("dependency-behind-p");
    expect(within(behind).getByTestId("dependency-q")).toBeTruthy();
    expect(screen.getByTestId("group-dependencies").querySelectorAll(":scope > ul > li").length).toBe(1);
    // mutation: drop the landed branch -> "Done", red
    expect(stateOf("q").textContent).toBe("Landed");
    expect(stateOf("q").getAttribute("data-tone")).toBe("ok");
    // The status light rides inside the id, so a long id that wraps at 320 px never strands it on a line of its own;
    // it is decorative, so the button's name is the id alone.
    // mutation: render the light beside the button again -> null, red
    const open = within(p).getByRole("button", { name: "p" });
    expect(open.querySelector(".led")?.getAttribute("data-led")).toBe("running");
    expect(within(screen.getByTestId("dependency-q")).getByRole("button", { name: "q" }).querySelector(".led")?.getAttribute("data-led")).toBe("idle");
    // mutation: the id is plain text (no onSelectGroup) -> no button, red
    fireEvent.click(open);
    expect(onSelect).toHaveBeenCalledWith("p");
  });

  it("says a prerequisite whose tasks are done but whose dependents still wait is not landed yet", () => {
    showPanel(["p"], [summaryOf("p", { state: "done", completion: { done: 4, total: 4 } })]);
    expect(stateOf("p").textContent).toBe("Done");
    expect(stateOf("p").getAttribute("data-tone")).toBeNull();
    // mutation: drop the not-landed note -> absent, red
    expect(screen.getByTestId("dependency-p").textContent).toContain("tasks done, not landed yet");
  });

  it("names a queued prerequisite as waiting, and one needing a person as such", () => {
    showPanel(["p", "s"], [
      summaryOf("p", { state: "ready", orchestration: { mode: "run", state: "waiting-slot", waitingFor: [], refusal: null } }),
      summaryOf("s", { state: "blocked" }),
    ]);
    expect(stateOf("p").textContent).toBe("Queued");
    expect(stateOf("p").getAttribute("data-tone")).toBe("warn");
    expect(stateOf("s").textContent).toBe("Needs you");
    expect(stateOf("s").getAttribute("data-tone")).toBe("danger");
  });

  it("names a prerequisite the page has not read, instead of dropping it", () => {
    showPanel(["gone"], []);
    // mutation: skip unknown ids -> no row, red
    expect(screen.getByTestId("dependency-gone").textContent).toContain("not in the groups this page has read");
  });

  it("stops at a group already on the chain, so a cycle cannot recurse", () => {
    // The server refuses cycles; a page reading two summaries at different times could still see one.
    // mutation: drop the path check -> unbounded recursion (the test worker runs out of memory), red
    showPanel(["p"], [summaryOf("p", { dependsOn: ["g"] })]);
    const behind = screen.getByTestId("dependency-behind-p");
    expect(within(behind).getByTestId("dependency-g")).toBeTruthy();
    expect(screen.queryByTestId("dependency-behind-g")).toBeNull();
  });

  it("takes no space for a group with no prerequisite", () => {
    showPanel(undefined, [summaryOf("p")]);
    // mutation: render the card whatever dependsOn is -> present, red
    expect(screen.queryByTestId("group-dependencies")).toBeNull();
  });

  it("keeps the one-line waiting text in the group view beside the card", () => {
    const base = view([workItem({ taskId: "a" })]);
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: null, runId: null }}
      view={{ ...base, summary: { ...base.summary, state: "ready", dependsOn: ["p"], orchestration: { mode: "run", state: "waiting-prerequisite", waitingFor: ["p"], refusal: null } } }}
      groupOf={(id) => (id === "p" ? summaryOf("p", { state: "running" }) : undefined)}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("orchestration-line").textContent).toBe("Confirmed: waiting for p to land first.");
    expect(stateOf("p").textContent).toBe("Running");
  });
});
