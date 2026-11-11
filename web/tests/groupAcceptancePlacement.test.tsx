// @vitest-environment jsdom
/**
 * Tester follow-up F §5 (round E §5, #241, left unwitnessed): where the failed group acceptance shows in the group view and
 * what it adds to the tab row. It is a problem of the group, so it lives in the Problems region only -- once, after the
 * group's recovery blockers and before the problem runs -- and the Problems tab's count includes it, so a group whose
 * every task is done but whose final tree failed still says on its tab that something needs looking at. An acceptance
 * that did not fail shows nothing and counts nothing.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupAcceptanceV1, GroupViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";
afterEach(cleanup);

const FAILED: GroupAcceptanceV1 = { tip: "c".repeat(40), result: "failed", commands: [{ command: "npm test", exit: "1", ms: 5 }], tail: "FAIL a.test.ts", at: 1, problem: "group-acceptance-failed:npm test" };

const withAcceptance = (value: GroupViewV1, acceptance: GroupAcceptanceV1 | undefined): GroupViewV1 =>
  ({ ...value, summary: { ...value.summary, ...(acceptance === undefined ? {} : { acceptance }) } });
const quiet = (acceptance?: GroupAcceptanceV1): GroupViewV1 =>
  withAcceptance(view([workItem({ taskId: "a", status: "completed", category: "done" }), workItem({ taskId: "b", status: "completed", category: "done" })]), acceptance);
const troubled = (acceptance?: GroupAcceptanceV1): GroupViewV1 => withAcceptance({
  ...view([workItem({ taskId: "b", status: "blocked", category: "blocked", currentRunId: "run-b", lineageRunIds: ["run-b"] })],
    [run({ runId: "run-b", taskId: "b", state: "blocked", outcome: "failed" })]),
  recoveryBlockers: [{ scope: "group", code: "recovery-needed", runId: null, evidenceIds: [] }],
}, acceptance);

const mount = (value: GroupViewV1) =>
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} refusal={null} roles={["owner"]} />);
const problemHint = (): string | null => screen.getByRole("tab", { name: "Problems" }).querySelector("[data-tab-hint]")?.textContent ?? null;
const rows = (): Element[] => [...document.querySelectorAll("[data-problem-acceptance]")];

describe("the failed group acceptance in the group view (tester follow-up F §5; E §5, #241)", () => {
  // mutation: the `+ (acceptance failed ? 1 : 0)` term leaves the Problems hint -> no hint on a quiet group -> red
  it("a group with every task done but its acceptance failed shows 1 on its Problems tab", () => {
    mount(quiet(FAILED));
    expect(problemHint()).toBe("1");
  });

  // mutation: the hint counts any recorded acceptance (`acceptance !== undefined`) -> 1 on a passed one -> red
  it.each([["passed"], ["waived"], ["not-needed"], ["not-run"]] as const)("a %s acceptance shows nothing and counts nothing", (result) => {
    mount(quiet({ ...FAILED, result, problem: undefined, tail: undefined }));
    expect(problemHint()).toBeNull();
    expect(rows()).toEqual([]);
  });

  // mutation: the hint leaves out the blockers or the problem runs once the acceptance is counted -> not 3 -> red
  it("adds one to what the Problems tab already counts", () => {
    mount(troubled());
    expect(problemHint()).toBe("2");
    cleanup();
    mount(troubled(FAILED));
    expect(problemHint()).toBe("3");
  });

  // mutation: GroupAcceptanceProblem rendered in the Progress region (or in both) -> not inside the problem panel once -> red
  // mutation: rendered after the problem runs -> order -> red
  it("lives in the Problems region only, once, after the recovery blockers and before the problem runs", () => {
    mount(troubled(FAILED));
    expect(rows()).toHaveLength(1);
    const row = rows()[0]!;
    const panel = row.closest("[role=tabpanel]");
    expect(panel?.getAttribute("data-overview-region")).toBe("problem");
    const blocker = [...panel!.querySelectorAll("p")].find((p) => p.textContent === "recovery-needed")!;
    const problemRun = panel!.querySelector("[data-problem-run-id='run-b']")!;
    expect(blocker.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(problemRun) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.querySelector("code")?.textContent).toBe("group-acceptance-failed:npm test");
  });
});
