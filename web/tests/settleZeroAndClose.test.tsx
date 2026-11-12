// @vitest-environment jsdom
/**
 * #215: a failure the server proves used nothing (a 429 before the provider counted anything) settles at known zero
 * (the server picks `release-known-zero`), and only then can close-run end the run. That took two separate presses on two
 * pages. One press now sends the two existing calls in order -- settle-unknown-usage with the server's acknowledgement,
 * then close-run -- through the group's ordered sender (App's sendControlSequence stops at the first refusal). No new
 * server verb; any other acknowledgement offers no close.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath } from "../src/controlApi.js";
import type { SettleAcknowledgeV1 } from "../src/controlTypes.js";
import { config, run, view } from "./usageRecoveryFixture.js";
afterEach(cleanup);

const remaining = { work: { tokens: 91, activeMs: 920, attempts: 3, sessions: 4 }, handoff: { tokens: 51, activeMs: 520, attempts: 5, sessions: 6 } };
const failed = (acknowledge: SettleAcknowledgeV1) => run({ state: "blocked", outcome: "failed", stopReason: "rate-limited",
  unknownUsageSettlement: { generation: 7, highWater: 2, remaining, allowed: true, refusalReason: null, acknowledge } });
const show = (acknowledge: SettleAcknowledgeV1) => {
  const onCommand = vi.fn(), onCommands = vi.fn();
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([failed(acknowledge)])} config={config}
    uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} onCommands={onCommands} roles={["owner"]} />);
  return { onCommand, onCommands };
};

describe("settle at zero and close, in one press (#215)", () => {
  // mutation: the two actions are sent in the other order -> close-run first -> red
  // mutation: the close button calls onCommand with the settlement only -> onCommands never called -> red
  it("sends settle-unknown-usage with release-known-zero, then close-run for the same run, behind the same approval", () => {
    const { onCommand, onCommands } = show("release-known-zero");
    fireEvent.click(screen.getByRole("button", { name: "Release unknown usage unmetered" }));
    const both = screen.getByRole("button", { name: "Settle at zero and close the run" }) as HTMLButtonElement;
    expect(both.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and approve this release" }));
    fireEvent.click(both);
    expect(onCommand).not.toHaveBeenCalled();
    expect(onCommands).toHaveBeenCalledExactlyOnceWith([
      { verb: "settle-unknown-usage", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", generation: 7, acknowledge: "release-known-zero" } },
      { verb: "close-run", groupId: "g", expectedRevision: 6, payload: { runId: "run-a" } },
    ]);
    // The server's route (src/panel/controlApi.ts: /api/control/groups/:groupId/close-run).
    expect(controlCommandPath(onCommands.mock.calls[0]![0][1])).toBe("/api/control/groups/g/close-run");
  });

  // mutation: the acknowledgement test is dropped -> a charge or an unmetered release offers the close too -> red
  it.each([["charge-remaining-grant", "Settle unknown usage"], ["release-unmetered", "Release unknown usage unmetered"]] as const)(
    "offers no close beside %s, whose run the server has not proved used nothing", (acknowledge, open) => {
      show(acknowledge);
      fireEvent.click(screen.getByRole("button", { name: open }));
      expect(screen.queryByRole("button", { name: "Settle at zero and close the run" })).toBeNull();
    });
});
