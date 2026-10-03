// @vitest-environment jsdom
/**
 * Board spec 2026-10-03 B1, D1, D2: where each task sits (longest dependency path, ties by id), what is not drawn and is
 * counted instead (a missing task, an edge closing a cycle), and the drawn graph as buttons that open the task detail.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { layoutDependencies } from "../src/dependencyLayout.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const deps = (taskId: string, ...dependencyTaskIds: string[]) => ({ taskId, dependencyTaskIds });

describe("layoutDependencies (spec D1)", () => {
  it("puts a task one layer after its deepest dependency and orders a layer by task id", () => {
    const layout = layoutDependencies([deps("c", "a", "b"), deps("b", "a"), deps("a"), deps("d")]);
    expect(layout.nodes).toEqual([
      { taskId: "a", layer: 0, index: 0 }, { taskId: "b", layer: 1, index: 0 }, { taskId: "c", layer: 2, index: 0 }, { taskId: "d", layer: 0, index: 1 },
    ]);
    expect(layout.edges).toEqual([{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "c" }]);
    expect(layout.layers).toBe(3);
    expect([layout.missing, layout.cycleEdges]).toEqual([0, 0]);
  });

  it("counts a dependency on a task the view does not carry instead of drawing or dropping it silently", () => {
    const layout = layoutDependencies([deps("a", "gone"), deps("b", "a")]);
    expect(layout.missing).toBe(1);
    expect(layout.edges).toEqual([{ from: "a", to: "b" }]);
    expect(layout.nodes.map((node) => node.layer)).toEqual([0, 1]);
  });

  it("ends on a cycle, drops the edge that closes it and counts it", () => {
    const layout = layoutDependencies([deps("a", "b"), deps("b", "a")]);
    expect(layout.cycleEdges).toBe(1);
    expect(layout.edges).toHaveLength(1);
    expect(layout.nodes).toHaveLength(2);
  });
});

describe("the drawn graph (spec B1, D2)", () => {
  const render2 = (items: Parameters<typeof view>[0]) =>
    render(<ControlGroupView view={view(items)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);

  it("draws one button per task with its status, and an arrow per dependency", () => {
    render2([workItem({ taskId: "a", status: "completed" }), workItem({ taskId: "b", status: "blocked", dependencyTaskIds: ["a"] })]);
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    expect(screen.getByRole("button", { name: "a · completed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "b · blocked" })).toBeTruthy();
    expect([...graph.querySelectorAll("path[data-edge]")].map((edge) => edge.getAttribute("data-edge"))).toEqual(["a->b"]);
    expect(screen.getByRole("button", { name: "b · blocked" }).getAttribute("class")).toBe("dep-node dep-blocked");
  });

  it("opens the task detail from a node, by click and by Enter, and closes it again", () => {
    render2([workItem({ taskId: "a" }), workItem({ taskId: "b", dependencyTaskIds: ["a"] })]);
    fireEvent.click(screen.getByRole("button", { name: "b · active" }));
    expect(screen.getByRole("region", { name: "Task b" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "a · active" }), { key: "Enter" });
    expect(screen.getByRole("region", { name: "Task a" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Task b" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "a · active" }));
    expect(screen.queryByRole("region", { name: "Task a" })).toBeNull();
  });

  it("draws every task whatever the label filter, since the filter only narrows the table", () => {
    render2([workItem({ taskId: "a", labels: ["bug"] }), workItem({ taskId: "b", labels: ["perf"], dependencyTaskIds: ["a"] })]);
    fireEvent.click(screen.getByRole("checkbox", { name: "perf" }));
    expect(screen.getByRole("button", { name: "a · active" })).toBeTruthy();
  });

  it("says how many dependencies it did not draw", () => {
    render2([workItem({ taskId: "a", dependencyTaskIds: ["gone"] })]);
    expect(within(screen.getByRole("figure", { name: "Dependency graph" })).getByRole("note").textContent).toBe("1 dependency names a task this group does not have; it is not drawn");
  });

  it("draws nothing for a group without dependencies, where the table already says all there is", () => {
    render2([workItem({ taskId: "a" }), workItem({ taskId: "b" })]);
    expect(screen.queryByRole("figure", { name: "Dependency graph" })).toBeNull();
  });
});
