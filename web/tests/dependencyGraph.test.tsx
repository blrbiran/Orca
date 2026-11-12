// @vitest-environment jsdom
/**
 * Board spec 2026-10-03 B1, D1, D2: where each task sits (longest dependency path, ties by id), what is not drawn and is
 * counted instead (a missing task, an edge closing a cycle), and the drawn graph as buttons that open the task detail.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { GroupGraph } from "../src/GroupGraph.js";
import { layoutDependencies } from "../src/dependencyLayout.js";
import { edgePath, graphGeometry, nodeLines, runNumber, sampleEdge } from "../src/DependencyGraph.js";
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

// #232 residual: inside a layer tasks were ordered by id alone, so two edges between the same pair of layers could cross
// although swapping two tasks would uncross them. A downward barycenter pass (mean row of a task's dependencies, ties by
// id) orders every layer after the first.
describe("ordering a layer to cross fewer edges (#232)", () => {
  /** Pairs of edges between the same two layers that cross, by the rows the layout gives their ends. */
  const crossings = (layout: ReturnType<typeof layoutDependencies>): string[] => {
    const at = new Map(layout.nodes.map((node) => [node.taskId, node]));
    const adjacent = layout.edges.filter((edge) => at.get(edge.to)!.layer === at.get(edge.from)!.layer + 1);
    const found: string[] = [];
    adjacent.forEach((left, i) => adjacent.slice(i + 1).forEach((right) => {
      if (at.get(left.from)!.layer !== at.get(right.from)!.layer) return;
      const order = (at.get(left.from)!.index - at.get(right.from)!.index) * (at.get(left.to)!.index - at.get(right.to)!.index);
      if (order < 0) found.push(`${left.from}->${left.to} x ${right.from}->${right.to}`);
    }));
    return found;
  };
  const rows = (layout: ReturnType<typeof layoutDependencies>, layer: number): string[] =>
    layout.nodes.filter((node) => node.layer === layer).sort((left, right) => left.index - right.index).map((node) => node.taskId);

  // mutation: the barycenter sort is dropped (id order only) -> x above y, one crossing -> red
  it("puts a task beside the row of what it depends on, so id order does not cross the two edges", () => {
    const layout = layoutDependencies([deps("a"), deps("b"), deps("x", "b"), deps("y", "a")]);
    expect(rows(layout, 1)).toEqual(["y", "x"]);
    expect(crossings(layout)).toEqual([]);
  });

  it("orders each later layer from the one before it, through three layers", () => {
    const layout = layoutDependencies([deps("a"), deps("b"), deps("c"), deps("x", "c"), deps("y", "b"), deps("z", "a"), deps("m", "x"), deps("n", "z")]);
    expect([rows(layout, 1), rows(layout, 2)]).toEqual([["z", "y", "x"], ["n", "m"]]);
    expect(crossings(layout)).toEqual([]);
  });

  // mutation: ties broken by reverse id -> q above p -> red
  it("breaks a tie by task id, whatever order the view sent the tasks in", () => {
    const items = [deps("a"), deps("q", "a"), deps("p", "a"), deps("b"), deps("r", "b")];
    const layout = layoutDependencies(items);
    expect(rows(layout, 1)).toEqual(["p", "q", "r"]);
    expect(layoutDependencies([...items].reverse())).toEqual(layout);
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
      // Tester #117: the word follows the colour; a blocked category no longer reads "active".
      expect(screen.getByRole("button", { name: `${taskId} · ${category === "blocked" ? "blocked" : "active"}` }).getAttribute("class")).toBe(`dep-node dep-${category}`);
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

// #232 (plan 2026-11-10-tester-followup-b T7): an edge that skips a layer was one curve straight across it, so it ran
// through the tasks drawn there and read as a dependency on them. Each edge is sampled from the geometry the graph draws.
describe("edge routing (#232)", () => {
  const sixTasks = [deps("T1"), deps("T2", "T1"), deps("T3", "T1"), deps("T4", "T1"), deps("T5", "T2", "T3", "T4"), deps("T6", "T1", "T2", "T3", "T4", "T5")];
  const throughB = [deps("c", "a", "b"), deps("b", "a"), deps("a"), deps("d")];

  it.each([["T1..T6", sixTasks], ["a->c past b", throughB]] as const)("%s: no edge passes through a task it does not join, and every edge is inside the drawing", (_name, items) => {
    const geometry = graphGeometry(layoutDependencies(items));
    const crossings = new Set<string>();
    const outside = new Set<string>();
    for (const edge of geometry.edges) {
      for (const point of sampleEdge(edge.segments)) {
        for (const node of geometry.nodes) {
          if (node.taskId === edge.from || node.taskId === edge.to) continue;
          if (point.x > node.x && point.x < node.x + node.w && point.y > node.y && point.y < node.y + node.h) crossings.add(`${edge.from}->${edge.to} through ${node.taskId}`);
        }
        if (point.x < 0 || point.x > geometry.width || point.y < 0 || point.y > geometry.height) outside.add(`${edge.from}->${edge.to}`);
      }
    }
    expect([...crossings]).toEqual([]);
    expect([...outside]).toEqual([]);
  });

  it("draws each edge and the drawing's size from that same geometry", () => {
    const items = sixTasks.map((task) => workItem({ taskId: task.taskId, dependencyTaskIds: [...task.dependencyTaskIds] }));
    render(<ControlGroupView view={view(items)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const geometry = graphGeometry(layoutDependencies(items));
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    const drawn = Object.fromEntries([...graph.querySelectorAll("path[data-edge]")].map((path) => [path.getAttribute("data-edge"), path.getAttribute("d")]));
    expect(drawn).toEqual(Object.fromEntries(geometry.edges.map((edge) => [`${edge.from}->${edge.to}`, edgePath(edge.segments)])));
    expect(graph.querySelector("svg")!.getAttribute("height")).toBe(String(geometry.height));
  });
});

// #271: the graph drew every declared edge, so A->C beside A->B->C doubled what the drawing says. The drawing is the
// transitive reduction: an edge whose source already reaches its target through another drawn path is not drawn, and the
// page says how many such implied dependencies it hid. The data is untouched, and the board's group graph, whose edges
// are each removable, keeps them all (reduce: false).
describe("implied dependencies are not drawn (#271)", () => {
  // mutation: the reduction is skipped (every edge drawn) -> a->d drawn, implied 0 -> red
  it("hides an edge another path implies, through one step or several, and counts it", () => {
    const diamond = layoutDependencies([deps("a"), deps("b", "a"), deps("c", "a"), deps("d", "a", "b", "c")]);
    expect(diamond.edges).toEqual([{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }]);
    expect(diamond.implied).toBe(1);
    // mutation: only a direct successor is looked through (no deeper walk) -> a->d stays drawn here -> red
    const chain = layoutDependencies([deps("a"), deps("b", "a"), deps("c", "b"), deps("d", "c", "a")]);
    expect(chain.edges).toEqual([{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }]);
    expect(chain.implied).toBe(1);
  });

  it("keeps an edge that skips a layer when no other path implies it", () => {
    const layout = layoutDependencies([deps("x"), deps("a"), deps("b", "a"), deps("c", "x", "b")]);
    expect(layout.edges).toContainEqual({ from: "x", to: "c" });
    expect(layout.implied).toBe(0);
  });

  it("keeps every edge when asked not to reduce", () => {
    const layout = layoutDependencies([deps("a"), deps("b", "a"), deps("c", "a", "b")], { reduce: false });
    expect(layout.edges).toEqual([{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "c" }]);
    expect(layout.implied).toBe(0);
  });

  // mutation: the note is not rendered -> red
  it("draws no path for the implied edge and says one implied dependency is hidden", () => {
    const items = [workItem({ taskId: "a" }), workItem({ taskId: "b", dependencyTaskIds: ["a"] }), workItem({ taskId: "c", dependencyTaskIds: ["a", "b"] })];
    render(<ControlGroupView view={view(items)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    expect([...graph.querySelectorAll("path[data-edge]")].map((path) => path.getAttribute("data-edge"))).toEqual(["a->b", "b->c"]);
    expect(within(graph).getByTestId("dep-implied").textContent).toBe("1 implied dependency hidden: another drawn path already orders these tasks");
  });

  // mutation: GroupGraph reduces too -> the board lists two edges, and a->c cannot be removed -> red
  it("lists every edge on the board's group graph, each removable", () => {
    const summary = view([]).summary;
    const groups = [{ ...summary, groupId: "a" }, { ...summary, groupId: "b", dependsOn: ["a"] }, { ...summary, groupId: "c", dependsOn: ["a", "b"] }];
    render(<GroupGraph groups={groups as never} onCommand={vi.fn()} />);
    expect(within(screen.getByRole("list", { name: "Dependencies" })).getAllByRole("listitem").map((li) => li.firstChild?.textContent))
      .toEqual(["b waits for a", "c waits for a", "c waits for b"]);
  });
});
