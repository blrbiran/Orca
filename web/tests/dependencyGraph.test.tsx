// @vitest-environment jsdom
/**
 * Board spec 2026-10-03 B1, D1, D2: where each task sits (longest dependency path, ties by id), what is not drawn and is
 * counted instead (a missing task, an edge closing a cycle), and the drawn graph as buttons that open the task detail.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { layoutDependencies } from "../src/dependencyLayout.js";
import { nodeLines, runNumber } from "../src/DependencyGraph.js";
import { config, run, view, workItem } from "./fixtures/board.js";

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
    render2([workItem({ taskId: "a", status: "completed", category: "done" }), workItem({ taskId: "b", status: "blocked", category: "blocked", dependencyTaskIds: ["a"] })]);
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

  it("draws every task even when no task depends on another (issue-fixes spec §6.5)", () => {
    render2([workItem({ taskId: "a" }), workItem({ taskId: "b" })]);
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    expect(within(graph).getAllByRole("button").map((node) => node.getAttribute("aria-label"))).toEqual(["a · active", "b · active"]);
    expect(graph.querySelectorAll("path[data-edge]")).toHaveLength(0);
  });
});

describe("category fill, legend and live node text (issue-fixes spec §6.5)", () => {
  const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
  const minutes = (n: number) => NOW - n * 60_000;
  const progress = { runId: "run-a", step: "execute" as const, attempt: { current: 2, max: 3 }, tokens: null, lastTransitionAt: null };
  const runningItem = workItem({ taskId: "a", category: "running", currentRunId: "run-a", lineageRunIds: ["run-0", "run-a"], progress });
  const runs = (lastActivityAt: number) => [run({ runId: "run-0", state: "settled-restartable" }), run({ runId: "run-a", startedAt: minutes(12), lastActivityAt })];

  it("classes each node by the server's category and draws a legend of all five", () => {
    render(<ControlGroupView view={view([workItem({ taskId: "i", category: "idle" }), workItem({ taskId: "w", category: "waiting" }), workItem({ taskId: "r", category: "running" }),
      workItem({ taskId: "b", category: "blocked" }), workItem({ taskId: "d", category: "done" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    for (const [taskId, category] of [["i", "idle"], ["w", "waiting"], ["r", "running"], ["b", "blocked"], ["d", "done"]] as const) {
      expect(screen.getByRole("button", { name: `${taskId} · active` }).getAttribute("class")).toBe(`dep-node dep-${category}`);
    }
    expect(within(screen.getByRole("list", { name: "Legend" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["idle", "running", "waiting", "blocked", "done"]);
  });

  it("shows a running task's step and attempt, its run number past 1 and the time since its run started", () => {
    expect(nodeLines(runningItem, runs(minutes(2)), NOW)).toEqual({ progress: "execute · attempt 2", run: "run 2 · 12 min", stalled: null });
    expect(runNumber(runningItem, [run({ runId: "run-0", state: "failed-before-provider" }), run({ runId: "run-a" })])).toBe(1);
    expect(nodeLines(workItem({ taskId: "z", category: "idle" }), runs(minutes(2)), NOW)).toEqual({ progress: null, run: null, stalled: null });
  });

  it("says 'no progress for N min' only once the current run has been quiet for more than 10 minutes", () => {
    expect(nodeLines(runningItem, runs(minutes(10)), NOW).stalled).toBeNull();
    expect(nodeLines(runningItem, runs(minutes(11)), NOW).stalled).toBe("no progress for 11 min");
    render(<ControlGroupView view={view([runningItem], runs(minutes(11)))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    const node = screen.getByRole("button", { name: "a · active" });
    expect(node.querySelector("text.dep-stall")?.textContent).toBe("no progress for 11 min");
  });

  it("opens the task detail from a node, the same task the table opens", () => {
    render(<ControlGroupView view={view([runningItem], runs(minutes(2)))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "a · active" }));
    expect(screen.getByRole("region", { name: "Task a" })).toBeTruthy();
  });
});
