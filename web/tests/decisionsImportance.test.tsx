// @vitest-environment jsdom
/**
 * Reported-decisions spec 2026-10-20 §6 (criterion 16; goal.md §1.3): every decision list shows major decisions by
 * default and offers the minor ones one click away, where they open and are correctable like the rest. A row without a
 * grade is major (the server already resolves a bad grade on a refused entry to major, so it is never hidden).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionsView, NO_FILTER } from "../src/DecisionsView.js";
import { RunDecisions } from "../src/RunDecisions.js";
import { runNeedsHuman } from "../src/RunDecisions.js";
import type { GroupDecisionsViewV1 } from "../src/controlTypes.js";
import i18n from "../src/i18n.js";
import type { DecisionListRow } from "../src/types.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

type DecisionRun = GroupDecisionsViewV1["tasks"][number]["runs"][number];
const UNDO = `git revert --no-edit ${"a".repeat(40)}`;
const row = (id: string, importance?: "major" | "minor"): DecisionListRow => ({
  projectKey: "proj", id, at: "2026-09-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", question: `q ${id}`,
  ...(importance === undefined ? {} : { importance }),
});
const written = (id: string, importance?: "major" | "minor"): DecisionRun["decisions"][number] => ({
  id, where: "working-tree", question: `q ${id}`, chose: "c", kind: "interface", scope: "task", ...(importance === undefined ? {} : { importance }),
});
const pending = (id: string, importance?: "major" | "minor"): DecisionRun["pending"][number] => ({
  pendingId: id, reason: "r", question: `q ${id}`, chose: "c", undoHow: UNDO, state: "pending", ...(importance === undefined ? {} : { importance }),
});
const unlanded = (entryIndex: number, importance?: "major" | "minor"): DecisionRun["unlanded"][number] => ({
  entryIndex, question: `q u${entryIndex}`, chose: "c", ...(importance === undefined ? {} : { importance }),
});
const decisionRun = (over: Partial<DecisionRun>): DecisionRun => ({
  runId: "run-a", settled: true, reported: "array", decisions: [], pending: [], unlanded: [], ...over,
});
const showRun = (r: DecisionRun, onCorrect = vi.fn()) => {
  render(<RunDecisions groupId="g" revision={1} run={r} projectKey="github.com/example/orca" onCommand={vi.fn()} onCorrect={onCorrect} archived={false} />);
  return onCorrect;
};

describe("the Decisions page shows major decisions and offers the minor ones", () => {
  it("lists one major of three and reveals the two minor ones on request", () => {
    render(<DecisionsView rows={[row("run/1"), row("run/2", "minor"), row("run/3", "minor")]} filter={NO_FILTER} />);
    const list = () => screen.getAllByRole("listitem").map((li) => within(li).getByText(/^run\//).textContent);
    expect(list()).toEqual(["run/1"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 minor" }));
    expect(list()).toEqual(["run/1", "run/2", "run/3"]);
    fireEvent.click(screen.getByRole("button", { name: "Hide minor" }));
    expect(list()).toEqual(["run/1"]);
  });

  it("says so when every matching decision is minor, and still offers them", () => {
    render(<DecisionsView rows={[row("run/1", "minor")]} filter={NO_FILTER} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Only minor decisions match.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 minor" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("offers no control when there is no minor decision", () => {
    render(<DecisionsView rows={[row("run/1"), row("run/2", "major")]} filter={NO_FILTER} />);
    expect(screen.queryByRole("button", { name: /minor/ })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens a revealed minor row like any other", () => {
    const onOpen = vi.fn();
    render(<DecisionsView rows={[row("run/1"), row("run/2", "minor")]} filter={NO_FILTER} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 minor" }));
    fireEvent.click(screen.getByText("q run/2"));
    expect(onOpen.mock.calls.map(([r]) => (r as DecisionListRow).id)).toEqual(["run/2"]);
  });
});

describe("a run's three decision lists each show major decisions and offer the minor ones", () => {
  const ids = (label: RegExp) => screen.queryAllByRole("listitem").map((li) => li.textContent ?? "").filter((t) => label.test(t));

  it("written: one shown, the two minor revealed, and a minor one stays correctable", () => {
    const onCorrect = showRun(decisionRun({ decisions: [written("run-a/agent-0"), written("run-a/agent-1", "minor"), written("run-a/agent-2", "minor")] }));
    expect(ids(/run-a\/agent/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 minor" }));
    expect(ids(/run-a\/agent/)).toHaveLength(3);
    fireEvent.click(within(screen.getByRole("listitem", { name: "run-a/agent-2" })).getByRole("button", { name: "Correct" }));
    expect(onCorrect).toHaveBeenCalledWith("github.com/example/orca", "run-a/agent-2");
  });

  it("pending: one shown, the two minor revealed and still confirmable", () => {
    showRun(decisionRun({ pending: [pending("p-0"), pending("p-1", "minor"), pending("p-2", "minor")] }));
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["p-0"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 minor" }));
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["p-0", "p-1", "p-2"]);
    expect(within(screen.getByRole("listitem", { name: "p-2" })).getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("unlanded: one shown, the two minor revealed", () => {
    showRun(decisionRun({ settled: true, unlanded: [unlanded(0), unlanded(1, "minor"), unlanded(2, "minor")] }));
    expect(ids(/q u\d/)).toEqual(["q u0 → c"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 minor" }));
    expect(ids(/q u\d/)).toEqual(["q u0 → c", "q u1 → c", "q u2 → c"]);
  });

  it("a pending entry the server graded major (absent or invalid on the raw entry) shows by default", () => {
    showRun(decisionRun({ pending: [pending("p-0", "major"), pending("p-1")] }));
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["p-0", "p-1"]);
    expect(screen.queryByRole("button", { name: /minor/ })).toBeNull();
  });

  it("a run whose only pending entries are minor does not ask for a person", () => {
    expect(runNeedsHuman(decisionRun({ pending: [pending("p-0", "minor")] }))).toBe(false);
    expect(runNeedsHuman(decisionRun({ pending: [pending("p-0", "minor"), pending("p-1")] }))).toBe(true);
  });
});

describe("the minor-decision control in Chinese", () => {
  it("shows zh words, never a raw key, on both pages", async () => {
    await i18n.changeLanguage("zh");
    render(<DecisionsView rows={[row("run/1"), row("run/2", "minor")]} filter={NO_FILTER} />);
    const page = screen.getByRole("button", { name: /次要/ });
    expect(page.textContent).toBe("显示 1 条次要决策");
    fireEvent.click(page);
    expect(screen.getByRole("button", { name: /次要/ }).textContent).toBe("收起次要决策");
    cleanup();
    showRun(decisionRun({ unlanded: [unlanded(0), unlanded(1, "minor")] }));
    const group = screen.getByRole("button", { name: /次要/ });
    expect(group.textContent).toBe("显示 1 条次要决定");
    fireEvent.click(group);
    expect(screen.getByRole("button", { name: /次要/ }).textContent).toBe("收起次要决定");
    expect(document.body.textContent).not.toMatch(/decisions\.(show|hide)Minor/);
  });
});
