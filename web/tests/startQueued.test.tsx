// @vitest-environment jsdom
/**
 * Review-exit spec 2026-11-05 §3.4 (D4), criterion 20: a start answered `queued-for-slot` says so beside Start -- how many
 * groups go first -- until a later success of the group; any other answer adds no line.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { initialControlState, reduceControlState, startQueuedEvent } from "../src/controlState.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);
const success = (result: unknown) => ({ schema: "orca-command-success-v1", result });

describe("a start queued at the cap (review-exit spec §3.4)", () => {
  it("the answer becomes the group's queued line, and a later success of the group clears it", () => {
    // mutation: startQueuedEvent ignores the result kind (always null) -> no line, red
    const event = startQueuedEvent("g", 202, success({ kind: "queued-for-slot", operation: "start", ahead: 2 }));
    expect(event).toEqual({ type: "start-queued", groupId: "g", ahead: 2 });
    expect(startQueuedEvent("g", 202, success({ kind: "scheduled", operation: "start", wakeId: "w" }))).toBeNull();
    expect(startQueuedEvent("g", 409, { error: { code: "group-state-invalid" } })).toBeNull();
    const queued = reduceControlState(initialControlState(), event!);
    expect(queued.startQueued).toEqual({ g: 2 });
    expect(reduceControlState(queued, { type: "command-succeeded", place: "group", groupId: "g" }).startQueued).toEqual({});
  });

  it("the group view shows it beside Start while the group is not executing", () => {
    const base = view([workItem({ taskId: "a" })]);
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: null, runId: null }}
      view={{ ...base, summary: { ...base.summary, state: "ready" } }} startQueued={1}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the line from ControlGroupView -> null, red
    expect(screen.getByTestId("start-queued").textContent).toBe("Queued: 1 ahead; it starts when a slot frees.");
    expect(screen.getByTestId("start-queued").getAttribute("role")).toBe("status");
  });
});
