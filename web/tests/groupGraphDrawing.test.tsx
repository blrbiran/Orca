// @vitest-environment jsdom
/**
 * #378 (tester 2026-11-18): the Board's group graph is drawn with the task graph's renderer -- an SVG of group nodes and
 * one curved edge per dependency -- and a node opens its group. The text list of edges stays as a folded fallback
 * (board.test.tsx and dependencyGraph.test.tsx keep reading it).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import { goalSummary } from "../src/CardGoal.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { GroupGraph } from "../src/GroupGraph.js";

afterEach(cleanup);

const g = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "ready", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 1, total: 2 }, counts: { idle: 1, running: 0, waiting: 0, blocked: 0, done: 1 }, executionPending: false, ...over,
});
const LONG = `${"Build the widget pipeline. ".repeat(10)}\nSecond paragraph.`;

describe("the Board's group graph (#378)", () => {
  // mutation: GroupGraph goes back to the <ol> layers (no DependencyDrawing) -> no svg, no paths -> red
  it("draws an svg with one node per live group and one edge per dependency, unreduced", () => {
    const groups = [g({ groupId: "a", goal: LONG }), g({ groupId: "b", dependsOn: ["a"] }), g({ groupId: "c", dependsOn: ["a", "b"] }), g({ groupId: "z", archived: true })];
    render(<GroupGraph groups={groups} onCommand={vi.fn()} onOpen={vi.fn()} />);
    const figure = screen.getByRole("figure", { name: "Group graph" });
    const svg = figure.querySelector("svg");
    expect(svg).not.toBeNull();
    expect([...svg!.querySelectorAll("path[data-edge]")].map((path) => path.getAttribute("data-edge"))).toEqual(["a->b", "a->c", "b->c"]);
    const nodes = [...svg!.querySelectorAll("g.dep-node")];
    expect(nodes.map((node) => node.getAttribute("aria-label"))).toEqual(["a · ready · 1/2 tasks done", "b · ready · 1/2 tasks done", "c · ready · 1/2 tasks done"]);
    // The node says the summary, not the whole goal; the whole goal is its <title>.
    const a = nodes[0]!;
    expect(a.querySelector("text.dep-goal")?.textContent).toBe(goalSummary(LONG));
    expect(goalSummary(LONG)).not.toBe(LONG);
    expect(a.querySelector("title")?.textContent).toBe(LONG);
    expect(a.querySelector("text.dep-status")?.textContent).toBe("ready");
    expect(a.querySelector("text.dep-detail")?.textContent).toBe("1/2 tasks done");
  });

  it("draws the groups even with no dependency, and says there is none", () => {
    render(<GroupGraph groups={[g({ groupId: "a" }), g({ groupId: "b" })]} onCommand={vi.fn()} onOpen={vi.fn()} />);
    const figure = screen.getByRole("figure", { name: "Group graph" });
    expect(figure.querySelectorAll("svg g.dep-node")).toHaveLength(2);
    expect(figure.querySelectorAll("path[data-edge]")).toHaveLength(0);
    expect(within(figure).getByText("No dependencies: groups run in parallel and conflicts are resolved when they land.")).toBeTruthy();
  });

  it("draws nothing (and does not throw) when every group is archived", () => {
    render(<GroupGraph groups={[g({ groupId: "z", archived: true })]} onCommand={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByRole("figure", { name: "Group graph" }).querySelector("svg")).toBeNull();
  });

  // mutation: BoardView does not pass onOpen to GroupGraph (or the node ignores click/Enter) -> onOpen never called -> red
  it("opens a group from its node on the Board, by click and by Enter", () => {
    const onOpen = vi.fn<(group: GroupSummaryV1) => void>();
    const groups = [g({ groupId: "a" }), g({ groupId: "b", dependsOn: ["a"] })];
    render(<BoardView groups={groups} scope={{ kind: "all" }} onOpen={onOpen} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Group graph" }));
    fireEvent.click(screen.getByRole("button", { name: "b · ready · 1/2 tasks done" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "a · ready · 1/2 tasks done" }), { key: "Enter" });
    expect(onOpen.mock.calls.map(([group]) => group.groupId)).toEqual(["b", "a"]);
  });
});
