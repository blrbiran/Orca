// @vitest-environment jsdom
/**
 * Off-plan writes #346 W4 (plan Task 6): a run stopped on a parallel sibling's claim offers the retry its diagnosis names --
 * after that sibling -- where a blocked run's retry is offered (the Runs table and Problems row, the task detail), instead
 * of the observed-path widening, which answers allowlist stops only.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);
const item = workItem({ status: "blocked", currentRunId: "run-a", lineageRunIds: ["run-a"] });
const claimed = run({ state: "blocked", outcome: "blocked_waiting_human", stopReason: "denylist match: b",
  diagnosis: { phase: "work", step: null, cause: "parallel-claim", siblings: ["b", "c"], attempt: 1 } });
const sent = { verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", after: "b" } };

describe("parallel-claim retry", () => {
  it("offers Retry after the first sibling in the group view, and no path widening", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([item], [claimed])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    // mutation: the parallel-claim branch is removed -> no such button (the no-evidence line shows instead), red
    fireEvent.click(screen.getAllByRole("button", { name: "Retry after b" })[0]!);
    expect(onCommand).toHaveBeenCalledWith(sent);
    expect(screen.queryByText(/no typed path evidence/)).toBeNull();
  });

  it("offers the same action in task detail", () => {
    const onCommand = vi.fn();
    render(<TaskDetail view={view([item], [claimed])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    fireEvent.click(within(screen.getByRole("region", { name: "Task a" })).getByRole("button", { name: "Retry after b" }));
    expect(onCommand).toHaveBeenCalledWith(sent);
  });
});
