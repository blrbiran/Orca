// @vitest-environment jsdom
/**
 * Tester #296: the work-items table listed tasks in plan order, and the canonical plan stores tasks sorted by task id, so
 * the table was alphabetical while the dependency graph above it read by layer. The table now reads in the graph's
 * order: dependency layer (left to right), then the task's row inside the layer. Web only; the plan is unchanged.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);
// Alphabetical (the plan's order) is the reverse of the dependency order here.
const ITEMS = [
  workItem({ taskId: "a-integration", dependencyTaskIds: ["m-doctor", "z-core"], labels: ["x"] }),
  workItem({ taskId: "b-readme", dependencyTaskIds: ["a-integration"] }),
  workItem({ taskId: "m-doctor", dependencyTaskIds: ["z-core"], labels: ["x"] }),
  workItem({ taskId: "y-digest", dependencyTaskIds: [] }),
  workItem({ taskId: "z-core", dependencyTaskIds: [], labels: ["x"] }),
];
const rows = (): string[] => within(screen.getByRole("table", { name: "Tasks" })).getAllByRole("row").slice(1)
  .map((row) => row.querySelector("td button")!.textContent!);

describe("tester #296: the work-items table follows the dependency order", () => {
  it("lists tasks by layer, then by row inside the layer, as the graph draws them", () => {
    const data = view(ITEMS);
    data.summary.state = "ready";
    render(<ControlGroupView view={data} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    // Layer 0 (no dependencies): y-digest, z-core, by id; layer 1: m-doctor; layer 2: a-integration; layer 3: b-readme.
    // mutation: drop orderByLayout -> the plan's alphabetical order, red
    // mutation: compare index before layer -> z-core/m-doctor/a-integration/b-readme (all index 0) interleave with y-digest, red
    expect(rows()).toEqual(["y-digest", "z-core", "m-doctor", "a-integration", "b-readme"]);
  });

  it("keeps that order when a label filter hides some rows", () => {
    const data = view(ITEMS);
    data.summary.state = "ready";
    render(<ControlGroupView view={data} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by label (0)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "x" }));
    // mutation: filter after an alphabetical sort (orderByLayout dropped) -> a-integration first, red
    expect(rows()).toEqual(["z-core", "m-doctor", "a-integration"]);
  });
});
