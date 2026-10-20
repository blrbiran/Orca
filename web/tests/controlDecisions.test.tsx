// @vitest-environment jsdom
/**
 * Control run decisions plan Task 11: a group's decisions in the panel. A refused decision waits for a person (需要人确认
 * on the task and on the group); Approve sends the agent's undo.how as prefilled and then edited (goal.md §1.1); Reject
 * sends no `because` when the person wrote no line; 纠正 opens the correction only for a decision in the working tree
 * of a known project; a blocked run's entries are listed under 未落地的决定; a settled run that reported nothing says so.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RunDecisions } from "../src/RunDecisions.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupDecisionsViewV1 } from "../src/controlTypes.js";
import i18n from "../src/i18n.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

type DecisionRun = GroupDecisionsViewV1["tasks"][number]["runs"][number];
const UNDO = `git revert --no-edit ${"a".repeat(40)}`;
const EDITED = `git revert --no-edit ${"b".repeat(40)}`;
const decisionRun = (over: Partial<DecisionRun> = {}): DecisionRun => ({
  runId: "run-a", settled: true, reported: "array", decisions: [], pending: [], unlanded: [], ...over,
});
const pendingItem = (over: Partial<DecisionRun["pending"][number]> = {}): DecisionRun["pending"][number] => ({
  pendingId: "pending-run-a-0", reason: 'kind-unknown:"opinion"', question: "Which store?", chose: "sqlite", undoHow: UNDO, state: "pending", ...over,
});
const decision = (where: DecisionRun["decisions"][number]["where"]): DecisionRun["decisions"][number] => ({
  id: "run-a/agent-1", where, question: "Which port?", chose: "8080", kind: "interface", scope: "task",
});
const groupDecisions = (runs: DecisionRun[], projectKey: string | null = "github.com/example/orca"): GroupDecisionsViewV1 => ({
  schema: "orca-group-decisions-v1", groupId: "g", projectKey,
  pendingCount: runs.flatMap((r) => r.pending).filter((p) => p.state === "pending").length,
  tasks: [{ taskId: "a", runs }],
});

const showRun = (r: DecisionRun, over: { projectKey?: string | null; archived?: boolean; onCorrect?: (projectKey: string, decisionId: string) => void } = {}) => {
  const onCommand = vi.fn<(action: ControlAction) => void>();
  render(<RunDecisions groupId="g" revision={6} run={r} projectKey={over.projectKey === undefined ? "github.com/example/orca" : over.projectKey}
    onCommand={onCommand} onCorrect={over.onCorrect} archived={over.archived === true} />);
  return onCommand;
};

const showGroup = (decisions: GroupDecisionsViewV1, onCorrectDecision = vi.fn()) => {
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: null, runId: null }}
    view={view([workItem({ taskId: "a", currentRunId: "run-a" })], [run({ runId: "run-a", state: "settled-recoverable" })])}
    config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} decisions={decisions} onCorrectDecision={onCorrectDecision} />);
  return onCorrectDecision;
};

describe("pending decisions (control run decisions Task 11)", () => {
  it("shows 需要人确认 on the task and on the group when an item is pending", async () => {
    await i18n.changeLanguage("zh");
    showGroup(groupDecisions([decisionRun({ pending: [pendingItem()] })]));
    expect(screen.getByTestId("group-needs-human").textContent).toBe("需要人确认");
    const taskRow = screen.getByRole("button", { name: "a", expanded: false }).closest("tr")!;
    expect(within(taskRow).getByText("需要人确认")).toBeTruthy();
    cleanup();
    // An item a person already settled no longer asks for one.
    showGroup(groupDecisions([decisionRun({ pending: [pendingItem({ state: "approved" })] })]));
    expect(screen.queryByText("需要人确认")).toBeNull();
  });

  it("Approve sends the prefilled undo.how, edited", () => {
    const onCommand = showRun(decisionRun({ pending: [pendingItem()] }));
    const item = screen.getByRole("listitem", { name: "pending-run-a-0" });
    expect(item.textContent).toContain("Which store?");
    expect(item.textContent).toContain("sqlite");
    expect(item.textContent).toContain('kind-unknown:"opinion"');
    // The person edits what the field shows; without the agent's undo.how prefilled there is nothing to edit.
    const field = within(item).getByLabelText("undo.how") as HTMLInputElement;
    fireEvent.change(field, { target: { value: field.value.replace("a".repeat(40), "b".repeat(40)) } });
    fireEvent.click(within(item).getByRole("button", { name: "Approve" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "approve-pending-decision", groupId: "g", expectedRevision: 6, payload: { pendingId: "pending-run-a-0", undoHow: EDITED } }]]);
  });

  it("Reject without a line omits because", () => {
    const onCommand = showRun(decisionRun({ pending: [pendingItem()] }));
    const item = screen.getByRole("listitem", { name: "pending-run-a-0" });
    fireEvent.click(within(item).getByRole("button", { name: "Reject" }));
    fireEvent.change(within(item).getByLabelText("Why (optional)"), { target: { value: "the premise was false" } });
    fireEvent.click(within(item).getByRole("button", { name: "Reject" }));
    // toStrictEqual: a `because: undefined` or `because: ""` key is a different payload from no key.
    expect(onCommand.mock.calls).toStrictEqual([
      [{ verb: "reject-pending-decision", groupId: "g", expectedRevision: 6, payload: { pendingId: "pending-run-a-0" } }],
      [{ verb: "reject-pending-decision", groupId: "g", expectedRevision: 6, payload: { pendingId: "pending-run-a-0", because: "the premise was false" } }],
    ]);
  });

  it("offers neither Approve nor Reject on an archived group", () => {
    const onCommand = showRun(decisionRun({ pending: [pendingItem()] }), { archived: true });
    const item = screen.getByRole("listitem", { name: "pending-run-a-0" });
    expect([within(item).getByRole("button", { name: "Approve" }), within(item).getByRole("button", { name: "Reject" })].map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, true]);
    fireEvent.click(within(item).getByRole("button", { name: "Approve" }));
    expect(onCommand).not.toHaveBeenCalled();
  });
});

describe("decision rows (control run decisions Task 11)", () => {
  it("the 纠正 action opens the correction for a working-tree decision", async () => {
    await i18n.changeLanguage("zh");
    const onCorrect = showGroup(groupDecisions([decisionRun({ decisions: [decision("working-tree")] })]));
    fireEvent.click(screen.getByRole("button", { name: "a", expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "纠正" }));
    expect(onCorrect.mock.calls).toEqual([["github.com/example/orca", "run-a/agent-1"]]);
  });

  it("the 纠正 action is disabled, with a note, for a not-yet-integrated decision", () => {
    const onCorrect = vi.fn();
    showRun(decisionRun({ decisions: [decision("group-branch")] }), { onCorrect });
    const row = screen.getByRole("listitem", { name: "run-a/agent-1" });
    const button = within(row).getByRole("button", { name: "Correct" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(row.textContent).toContain("Not yet integrated");
    expect(row.textContent).toContain("Correcting needs the decision in the checked-out working tree of a known project.");
    fireEvent.click(button);
    expect(onCorrect).not.toHaveBeenCalled();
    cleanup();
    // On the target branch but not checked out: no correction, and it is integrated, so no "not yet integrated".
    showRun(decisionRun({ decisions: [decision("target")] }), { onCorrect });
    const onTarget = screen.getByRole("listitem", { name: "run-a/agent-1" });
    expect([(within(onTarget).getByRole("button", { name: "Correct" }) as HTMLButtonElement).disabled, onTarget.textContent?.includes("Not yet integrated")]).toEqual([true, false]);
    cleanup();
    // In the working tree, but the project is not known: still no correction.
    showRun(decisionRun({ decisions: [decision("working-tree")] }), { onCorrect, projectKey: null });
    expect((screen.getByRole("button", { name: "Correct" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("what a run reported (control run decisions Task 11)", () => {
  it("lists a blocked run's entries under 未落地的决定", async () => {
    await i18n.changeLanguage("zh");
    showRun(decisionRun({ unlanded: [{ entryIndex: 0, question: "first", chose: "c" }, { entryIndex: 1, question: null, chose: "second" }] }));
    const list = screen.getByRole("list", { name: "未落地的决定" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["first → c", "— → second"]);
  });

  it("says the run reported no decisions", () => {
    showRun(decisionRun({ reported: "absent" }));
    expect(screen.getByRole("region", { name: "Decisions of run-a" }).textContent).toContain("This run reported no decisions");
    cleanup();
    // A run that has not settled may still report: it says nothing of the kind yet.
    showRun(decisionRun({ reported: "absent", settled: false }));
    expect(screen.getByRole("region", { name: "Decisions of run-a" }).textContent).not.toContain("This run reported no decisions");
    cleanup();
    showRun(decisionRun({ reported: "malformed" }));
    expect(screen.getByRole("region", { name: "Decisions of run-a" }).textContent).toContain("This run's decisions were not a list");
    cleanup();
    showRun(decisionRun({ reported: "unreadable" }));
    expect(screen.getByRole("region", { name: "Decisions of run-a" }).textContent).toContain("This run's saved report could not be read");
  });
});

// Kanban spec 2026-10-20 §9a (session 9ec98639): a landed decision Orca flagged is red until a person ratifies or corrects it.
describe("flagged decisions (kanban spec §9a)", () => {
  const flagged = (state: "flagged" | "ratified" | "corrected"): DecisionRun["decisions"][number] => ({
    ...decision("working-tree"), flag: { state, source: "reconcile", reason: "merged both sides", evidence: [] },
  });

  it("shows a flagged decision red with its reason, and Ratify sends ratify-flagged-decision for it", () => {
    const onCommand = showRun(decisionRun({ decisions: [flagged("flagged")] }));
    const item = screen.getByRole("listitem", { name: "run-a/agent-1" });
    expect(within(item).getByTestId("decision-flagged").getAttribute("data-tone")).toBe("danger");
    expect(item.textContent).toContain("Landed, flagged by reconcile: merged both sides");
    // Disagreeing is the existing correction, still offered beside it.
    expect(within(item).getByRole("button", { name: "Correct" })).toBeTruthy();
    fireEvent.click(within(item).getByRole("button", { name: "Ratify" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "ratify-flagged-decision", groupId: "g", expectedRevision: 6, payload: { decisionId: "run-a/agent-1" } }]]);
  });

  it("a ratified or corrected flag is a plain note with no Ratify", () => {
    showRun(decisionRun({ decisions: [flagged("ratified")] }));
    expect(screen.queryByTestId("decision-flagged")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ratify" })).toBeNull();
    expect(screen.getByText("Ratified")).toBeTruthy();
    cleanup();
    showRun(decisionRun({ decisions: [flagged("corrected")] }));
    expect(screen.queryByRole("button", { name: "Ratify" })).toBeNull();
    expect(screen.getByText("Corrected")).toBeTruthy();
  });

  it("the group says how many landed decisions are flagged, and says nothing when none is", () => {
    showGroup({ ...groupDecisions([decisionRun({ decisions: [flagged("flagged")] })]), flaggedCount: 1 });
    expect(screen.getByTestId("group-flagged").textContent).toBe("1 landed decision flagged for review");
    cleanup();
    showGroup({ ...groupDecisions([decisionRun({ decisions: [flagged("ratified")] })]), flaggedCount: 0 });
    expect(screen.queryByTestId("group-flagged")).toBeNull();
  });
});
