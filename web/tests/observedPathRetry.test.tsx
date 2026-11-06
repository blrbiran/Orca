// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import { config, run, view, workItem } from "./fixtures/board.js";
import type { RunViewV1 } from "../src/controlTypes.js";

afterEach(cleanup);
const item = workItem({ status: "blocked", currentRunId: "run-a", lineageRunIds: ["run-a"] });
const missed = run({ state: "blocked", outcome: "blocked_waiting_human", stopReason: "path-allowlist-miss", pathPolicyMisses: [{ repoKey: null, path: "tests/login.test.ts" }, { repoKey: "docs", path: "notes/login.md" }] });
const show = (candidate: RunViewV1) => {
  const onCommand = vi.fn();
  const group = view([item], [candidate]);
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={group} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
  return onCommand;
};

describe("observed path retry", () => {
  it("lists exact paths before the Runs-table action and sends only the opt-in flag", () => {
    const onCommand = show(missed);
    expect(screen.getByText("tests/login.test.ts")).toBeTruthy();
    expect(screen.getByText("docs:notes/login.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow reported paths and retry" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", allowObservedPaths: true } });
    expect(screen.getByText(/keeps the current allowed paths/)).toBeTruthy();
  });

  it("offers no path expansion for an old peer with no typed evidence", () => {
    show(run({ state: "blocked", outcome: "blocked_waiting_human", stopReason: "path-allowlist-miss" }));
    expect(screen.queryByRole("button", { name: "Allow reported paths and retry" })).toBeNull();
    expect(screen.getByText(/no typed path evidence/)).toBeTruthy();
  });

  it("lists the same paths and action in task detail", () => {
    const onCommand = vi.fn();
    const group = view([item], [missed]);
    render(<TaskDetail view={group} item={item} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByText("docs:notes/login.md")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Task a" })).getByRole("button", { name: "Allow reported paths and retry" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", allowObservedPaths: true } });
  });
});
