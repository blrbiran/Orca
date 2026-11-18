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
import type { ControlAction } from "../src/controlApi.js";
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
    // #378 review M-9. mutation: the node ignores Space -> only two opens -> red
    fireEvent.keyDown(screen.getByRole("button", { name: "b · ready · 1/2 tasks done" }), { key: " " });
    expect(onOpen.mock.calls.map(([group]) => group.groupId)).toEqual(["b", "a", "b"]);
  });

  // #378 review I-2. mutation: GroupGraph ignores layout.missing (no note, no listed line) -> red
  it("names a dependency on a group it cannot draw (archived), lists it with its Remove, and never says there are none", () => {
    const onCommand = vi.fn<(action: ControlAction) => void>();
    render(<GroupGraph groups={[g({ groupId: "a", dependsOn: ["old"], commandRevision: 4 }), g({ groupId: "old", archived: true })]} onCommand={onCommand} onOpen={vi.fn()} />);
    const figure = screen.getByRole("figure", { name: "Group graph" });
    expect(within(figure).getByRole("note").textContent).toBe("1 dependency names a group that is archived or not on this board; it is not drawn");
    expect(within(figure).queryByText(/^No dependencies/)).toBeNull();
    const list = within(figure).getByRole("list", { name: "Dependencies" });
    expect(within(list).getAllByRole("listitem").map((li) => li.firstChild?.textContent)).toEqual(["a waits for old (not drawn: archived or not on this board)"]);
    fireEvent.click(within(list).getByRole("button", { name: "Remove" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "remove-group-dependency", groupId: "a", expectedRevision: 4, payload: { dependsOn: "old" } }]]);
  });

  // #378 review I-2. mutation: GroupGraph ignores layout.cycleEdges -> no alert -> red
  it("says when a dependency would close a cycle and is not drawn", () => {
    render(<GroupGraph groups={[g({ groupId: "a", dependsOn: ["b"] }), g({ groupId: "b", dependsOn: ["a"] })]} onCommand={vi.fn()} onOpen={vi.fn()} />);
    expect(within(screen.getByRole("figure", { name: "Group graph" })).getByRole("alert").textContent).toBe("1 dependency would close a cycle; it is not drawn");
  });

  // #378 review M-4. mutation: a done group keeps the idle fill (groupLed alone) -> red
  it("has a legend in group meanings, and a done group is filled as done", () => {
    render(<GroupGraph groups={[g({ groupId: "d", state: "done", completion: { done: 2, total: 2 } })]} onCommand={vi.fn()} onOpen={vi.fn()} />);
    const figure = screen.getByRole("figure", { name: "Group graph" });
    expect(within(within(figure).getByRole("list", { name: "Legend" })).getAllByRole("listitem").map((li) => li.textContent))
      .toEqual(["not started", "queued or waiting", "running", "needs you", "done"]);
    expect(figure.querySelector("g.dep-node")?.getAttribute("class")).toBe("dep-node dep-done");
  });

  // #378 review M-7. mutation: the summary says "Dependencies" again -> two things share one name -> red
  it("names the folded text fallback and its list differently", () => {
    render(<GroupGraph groups={[g({ groupId: "a" }), g({ groupId: "b", dependsOn: ["a"] })]} onCommand={vi.fn()} onOpen={vi.fn()} />);
    const figure = screen.getByRole("figure", { name: "Group graph" });
    expect(figure.querySelector("details > summary")?.textContent).toBe("Dependencies as text");
    expect(within(figure).getByRole("list", { name: "Dependencies" })).toBeTruthy();
  });

  // #378 review M-8. mutation: the label is joined in code, not from board.graph.node -> the zh label keeps " · " -> red
  it("words a node's accessible label from the locale", async () => {
    const i18n = (await import("../src/i18n.js")).default;
    await i18n.changeLanguage("zh");
    render(<GroupGraph groups={[g({ groupId: "a" })]} onCommand={vi.fn()} onOpen={vi.fn()} />);
    expect(document.querySelector("g.dep-node")?.getAttribute("aria-label")).toBe("a：就绪，已完成 1/2 个任务");
  });
});
