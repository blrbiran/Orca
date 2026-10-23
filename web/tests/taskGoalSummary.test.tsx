// @vitest-environment jsdom
/**
 * Tester round 2 spec §8 (ruling H5, C29; tester #5/#16): a task says what it is for -- in the task table a one-line
 * summary of its goal beside the id, and in the graph a goal line under the id -- with the whole goal on hover; a task
 * with no objective shows its id alone, as before.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { goalSummary } from "../src/CardGoal.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { DependencyGraph } from "../src/DependencyGraph.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const LONG = "Make the login page accept a second factor.\nKeep the old flow working for accounts without one, and record which accounts used which flow so support can answer questions about it later on.";
const items = [workItem({ taskId: "a", objective: { goal: LONG, successCondition: "tests pass" } }), workItem({ taskId: "b" })];

describe("task goal summary (C29)", () => {
  it("the table shows goalSummary(goal) beside the id, the full goal in title; no objective shows the id alone", () => {
    render(<ControlGroupView view={view(items)} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} />);
    const rows = screen.getAllByRole("row").slice(1);
    const cellA = rows[0]!.querySelector("td")!;
    const goal = cellA.querySelector(".task-goal")!;
    expect(goalSummary(LONG).endsWith("…")).toBe(true);
    expect(goal.textContent).toBe(goalSummary(LONG));
    expect(goal.getAttribute("title")).toBe(LONG);
    expect(rows[1]!.querySelector("td")!.querySelector(".task-goal")).toBeNull();
    expect(rows[1]!.querySelector("td")!.textContent).toBe("b");
  });

  it("the graph node has the goal line, clipped, with the whole goal in an SVG <title>; every node is 104 px high", () => {
    const { container } = render(<DependencyGraph items={items} runs={[]} openTask={null} onOpen={() => {}} now={0} />);
    const [nodeA, nodeB] = [...container.querySelectorAll("g.dep-node")];
    expect(nodeA!.querySelector(":scope > title")!.textContent).toBe(LONG);
    const line = nodeA!.querySelector("text.dep-goal")!;
    expect(line.textContent).toBe(goalSummary(LONG));
    expect(line.getAttribute("y")).toBe("32");
    expect(container.querySelector(line.getAttribute("clip-path")!.replace(/^url\((.*)\)$/, "$1"))).not.toBeNull();
    expect(nodeA!.querySelector("text.dep-status")!.getAttribute("y")).toBe("48");
    expect(nodeB!.querySelector("title")).toBeNull();
    expect(nodeB!.querySelector("text.dep-goal")).toBeNull();
    for (const node of [nodeA!, nodeB!]) expect(node.querySelector("rect")!.getAttribute("height")).toBe("104");
  });

  it("two graphs on one page never share a clip id (review minor 10)", () => {
    const { container } = render(<><DependencyGraph items={items} runs={[]} openTask={null} onOpen={() => {}} now={0} /><DependencyGraph items={items} runs={[]} openTask={null} onOpen={() => {}} now={0} /></>);
    const ids = [...container.querySelectorAll("clipPath")].map((clip) => clip.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const line of container.querySelectorAll("text.dep-goal")) expect(container.querySelector(line.getAttribute("clip-path")!.replace(/^url\((.*)\)$/, "$1"))).not.toBeNull();
  });
});
