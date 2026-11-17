// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath } from "../src/controlApi.js";
import type { RunViewV1 } from "../src/controlTypes.js";
import { config, run, view } from "./usageRecoveryFixture.js";
import { workItem } from "./fixtures/board.js";

/**
 * Stuck-runs spec 2026-11-17 S2 (#344), the Web half: on a running run's row an owner may abandon the attempt with a note;
 * the payload sent is exactly the server's `{runId, note}` on the group's abandon-run route. A request already made, and one
 * ccloop did not act on within the grace (abandon-unresolved, a problem row), is said to everyone. Named mutations (each seen
 * red, Rule 9) are written beside the assertion they turn red.
 */
afterEach(cleanup);
const OPEN = "Abandon this attempt";
const SEND = "Abandon the attempt";
const NOTE = "Why this attempt cannot succeed";
const show = (roles: ("owner" | "member")[], r: RunViewV1 = run({ state: "running", outcome: null }), region: "progress" | "problem" = "progress") => {
  const onCommand = vi.fn();
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region, taskId: null, runId: null }} view={{ ...view([r]), workItems: [workItem({ taskId: "a", status: "active", currentRunId: "run-a" })] }}
    config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={roles} refusal={null} />);
  return { onCommand };
};

describe("abandon a running attempt (spec S2)", () => {
  it("an owner sends exactly {runId, note} to the group's abandon-run route, from a danger-toned form with a required note", () => {
    const { onCommand } = show(["owner"]);
    fireEvent.click(screen.getAllByRole("button", { name: OPEN })[0]!);
    const form = screen.getByRole("group", { name: OPEN });
    // mutation: drop data-tone="danger" from the form -> red
    expect(form.getAttribute("data-tone")).toBe("danger");
    const send = within(form).getByRole("button", { name: SEND }) as HTMLButtonElement;
    // mutation: drop the blank-note disable -> red
    expect(send.disabled).toBe(true);
    fireEvent.change(within(form).getByRole("textbox", { name: NOTE }), { target: { value: "   " } });
    expect(send.disabled).toBe(true);
    fireEvent.change(within(form).getByRole("textbox", { name: NOTE }), { target: { value: "the criterion is about the plan" } });
    fireEvent.click(send);
    // mutation: send the task id too -> red
    expect(onCommand.mock.calls).toEqual([[{ verb: "abandon-run", groupId: "g", expectedRevision: 6, payload: { runId: "run-a", note: "the criterion is about the plan" } }]]);
    expect(controlCommandPath(onCommand.mock.calls[0]![0])).toBe("/api/control/groups/g/abandon-run");
  });

  it.each([
    ["a member", ["member"] as ("owner" | "member")[], run({ state: "running", outcome: null })],
    ["a run that already failed", ["owner"] as ("owner" | "member")[], run({ state: "settled-failed", outcome: "failed" })],
  ])("is not offered to %s", (_name, roles, r) => {
    show(roles, r);
    // mutation: offer it in any state (or to any role) -> red
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
  });

  it("a request already made is said instead; past the grace it is a problem row, said in danger", () => {
    show(["owner"], run({ state: "running", outcome: null, abandon: { by: "user:owner", note: "stop paying", at: 1, unresolvedAt: 2 } }), "problem");
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
    // mutation: drop abandonUnresolved from isProblemRun -> no problem row, red
    const row = document.querySelector<HTMLElement>('[data-problem-run-id="run-a"]')!;
    expect(row).not.toBeNull();
    const status = within(row).getByRole("status");
    expect(status.getAttribute("data-tone")).toBe("danger");
    expect(status.textContent).toContain("has not stopped within the grace");
  });
});
