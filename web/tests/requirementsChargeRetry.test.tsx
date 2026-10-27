// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlConfigV1, ControlSummaryV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

// Spec 2026-10-27 single-call unknown usage (tester #62) §9 R1, R6: a requirement call blocked on unknown usage is retried
// only by charging its remaining grant -- the button names the amount, the confirm says the retry reserves another grant,
// and the command carries the acknowledgement. A plain "Retry this call" there would only block again.
afterEach(cleanup);
const mount = (view: RequirementViewV1, onCommand = vi.fn(), me: unknown = null) => {
  render(<AccountContext.Provider value={me as never}>
    <RequirementsPanel config={config as ControlConfigV1} summary={summaryWith(view) as ControlSummaryV1} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={onCommand} />
  </AccountContext.Provider>);
  return onCommand;
};
const blocked = (charge: { tokens: number; usageLowerBound: number | null } | undefined): RequirementViewV1 => {
  const view = requirementView("answered");
  const drafting = { ...view, rounds: [...view.rounds, { ...view.rounds[0]!, roundNo: 2, state: "drafting" as const, result: null, answers: null }] };
  return { ...drafting, summary: { ...drafting.summary, requirement: { ...drafting.summary.requirement!, roundNo: 2, roundState: "drafting",
    blockedRun: { runId: "run-7", reason: "requirement-usage-unknown:omp-stalled" }, ...(charge === undefined ? {} : { blockedRunCharge: charge }) } } };
};

describe("a requirement call blocked on unknown usage (§9 R1, R6)", () => {
  it("offers the charge with its amount and the lower bound, confirms, and sends the acknowledgement on the run", () => {
    const onCommand = mount(blocked({ tokens: 1_000_000, usageLowerBound: 1_234 }));
    // O4: the next step names the settlement, not a plain retry.
    expect(document.body.textContent).toContain("a call stopped without reporting its usage; charge its grant, then it retries.");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("At least 1,234 tokens were observed");
    expect(within(alert).queryByRole("button", { name: "Retry this call" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Charge the call's grant (1,000,000 tokens) and retry" }));
    expect(onCommand).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: "Charge the call's grant (1,000,000 tokens) and retry" });
    expect(confirm.textContent).toMatch(/1,000,000 tokens, as spent .* The retry reserves another grant/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Charge 1,000,000 tokens and retry" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "r", expectedRevision: 3, payload: { scope: "run", runId: "run-7", acknowledge: "charge-remaining-grant" } });
  });

  it("names no lower bound when ccloop observed none, and Cancel sends nothing", () => {
    const onCommand = mount(blocked({ tokens: 1_000_000, usageLowerBound: null }));
    expect(screen.getByRole("alert").textContent).not.toContain("At least");
    fireEvent.click(screen.getByRole("button", { name: "Charge the call's grant (1,000,000 tokens) and retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("tells a member that an owner charges it, with no control that would be refused", () => {
    mount(blocked({ tokens: 1_000_000, usageLowerBound: null }), vi.fn(), { user: { id: "u-m", name: "m", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 1 });
    expect(screen.queryByRole("button", { name: /Charge the call's grant/ })).toBeNull();
    expect(within(screen.getByRole("alert")).getByRole("note").textContent).toBe("Only an owner can charge the call's grant and retry it.");
  });

  it("keeps the plain run retry when the server offers no charge (another block)", () => {
    const onCommand = mount(blocked(undefined));
    fireEvent.click(screen.getByRole("button", { name: "Retry this call" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "r", expectedRevision: 3, payload: { scope: "run", runId: "run-7" } });
  });
});
