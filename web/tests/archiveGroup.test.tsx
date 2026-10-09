// @vitest-environment jsdom
/** Issue-fixes spec §6.3, §6.5: the archived banner and its Unarchive, the Archive action, and the detail's order. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCommandPath } from "../src/controlApi.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const archived = (base: GroupViewV1): GroupViewV1 => ({ ...base, summary: { ...base.summary, state: "ready", archived: true } });

describe("archiving from the group view (spec §6.3)", () => {
  it("shows an archived group's banner with Unarchive, and offers no dispatch action", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={archived(view([workItem({ taskId: "a" })]))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByRole("status", { name: "Archived" }).textContent).toContain("This group is archived");
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "unarchive-group", groupId: "g", expectedRevision: 6, payload: {} });
    for (const name of ["Start", "Pause dispatch", "Handoff stop", "Archive group"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("offers no retry on an archived group, because the server refuses every command but Unarchive (group-archived)", () => {
    const failed = run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: x" });
    const held = run({ runId: "run-c", taskId: "c", state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded", stopReason: null });
    const base = view([workItem({ taskId: "a" })], [failed, held]);
    const open = render(<ControlGroupView view={base} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Retry (task|run)/ })).toHaveLength(2);
    open.unmount();
    render(<ControlGroupView view={archived(base)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryAllByRole("button", { name: /^Retry/ })).toHaveLength(0);
  });

  it("offers Archive group on a group that is not archived, and sends it under the view's revision", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([workItem({ taskId: "a" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("status", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "archive-group", groupId: "g", expectedRevision: 6, payload: {} });
  });

  it("serves both verbs on the group's own routes", () => {
    expect(controlCommandPath({ verb: "archive-group", groupId: "g 1", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g%201/archive");
    expect(controlCommandPath({ verb: "unarchive-group", groupId: "g", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g/unarchive");
  });
});

describe("the group detail's order (spec §6.5)", () => {
  it("puts the archived banner before the graph, the graph before the work-items table, the table before runs, and runs before the budget editor", () => {
    render(<ControlGroupView view={archived(view([workItem({ taskId: "a" })]))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const banner = screen.getByRole("status", { name: "Archived" });
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    const items = screen.getByRole("heading", { name: "Work items" });
    const runs = screen.getByRole("heading", { name: "Runs" });
    const budget = screen.getByRole("region", { name: "Budget proposal" });
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(banner, graph)).toBe(true);
    expect(follows(graph, items)).toBe(true);
    expect(follows(items, runs)).toBe(true);
    expect(follows(runs, budget)).toBe(true);
  });
});
