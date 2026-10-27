// @vitest-environment jsdom
/**
 * Tester #15 (issue-20261023.md): the dispatch controls follow the group's state. A done group dispatches nothing more,
 * so it offers neither pause nor a handoff stop; a draft keeps both (a pause there holds the start that confirming would
 * bring: start refuses every stop intent), as does a running group.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupViewV1 } from "../src/controlTypes.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const inState = (state: GroupViewV1["summary"]["state"]): GroupViewV1 => {
  const base = view([workItem({ taskId: "a" })]);
  return { ...base, summary: { ...base.summary, state } };
};
const show = (state: GroupViewV1["summary"]["state"]): void => {
  render(<ControlGroupView view={inState(state)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
};
const offered = (name: string): boolean => screen.queryByRole("button", { name }) !== null;

describe("pause and handoff stop by group state (tester #15)", () => {
  it.each(["draft", "running"] as const)("offers both on a %s group", (state) => {
    show(state);
    expect(offered("Pause new tasks")).toBe(true);
    expect(offered("Save progress and stop")).toBe(true);
  });

  it("offers neither on a done group", () => {
    show("done");
    expect(offered("Pause new tasks")).toBe(false);
    expect(offered("Save progress and stop")).toBe(false);
  });
});
