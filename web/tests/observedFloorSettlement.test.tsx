// @vitest-environment jsdom
// Tester follow-up F §2 (#116; human 「要改」, ledger C3): next to the existing settle action, a finite run whose floor ccloop
// observed offers "charge observed usage (N tokens, approximate)" -- the floor and its admission come from the server
// (`observedFloor`), the browser only shows them -- and its receipt names the floor and who booked it. A single call
// blocked on unknown usage offers the same choice beside its charge-and-retry.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ChargeRetry } from "../src/ChargeRetry.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RunActivity } from "../src/TaskDetail.js";
import { config, run, view } from "./usageRecoveryFixture.js";
afterEach(cleanup);

const remaining = { work: { tokens: 91_000, activeMs: 920, attempts: 3, sessions: 4 }, handoff: { tokens: 51, activeMs: 520, attempts: 5, sessions: 6 } };
const preview = (observedFloor?: { tokens: number; allowed: boolean; refusalReason: string | null }, allowed = true) =>
  ({ generation: 7, highWater: 2, remaining, allowed, refusalReason: allowed ? null : "group-reserve-insufficient", acknowledge: "charge-remaining-grant" as const, ...(observedFloor ? { observedFloor } : {}) });
const failed = (p = preview({ tokens: 1_234, allowed: true, refusalReason: null })) => run({ state: "blocked", outcome: "failed", stopReason: "Error: codex-event-error", usageLowerBound: 1_234, unknownUsageSettlement: p });
const show = (roles: ("owner" | "member")[], r = failed()) => {
  const onCommand = vi.fn();
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([r])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={roles} />);
  return { onCommand };
};

describe("charge observed usage beside the settle action", () => {
  it("shows the floor, asks for consent, and sends charge-observed-floor for the run", () => {
    const { onCommand } = show(["owner"]);
    // The existing settle action stays offered beside it.
    expect(screen.getByRole("button", { name: "Settle unknown usage" })).toBeTruthy();
    // mutation: drop floorChoice from UsageSettlement -> no such button, red
    fireEvent.click(screen.getByRole("button", { name: "Charge observed usage (1,234 tokens, approximate)" }));
    expect(screen.getByText(/charges only the 1,234 work tokens ccloop observed/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm approximate charge of 1,234 tokens" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and approve this approximate charge" }));
    fireEvent.click(confirm);
    // mutation: send preview.acknowledge from the floor confirm -> charge-remaining-grant, red
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ verb: "settle-unknown-usage", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", generation: 7, acknowledge: "charge-observed-floor" } });
  });

  it("is offered on the server's own answer: not without observedFloor, not when it is refused, and still when only the grant form is refused", () => {
    show(["owner"], failed(preview(undefined)));
    expect(screen.queryByRole("button", { name: /Charge observed usage/ })).toBeNull();
    cleanup();
    // mutation: gate the floor button on preview.allowed (the grant form's answer) -> offered here, red
    show(["owner"], failed(preview({ tokens: 1_234, allowed: false, refusalReason: "group-reserve-insufficient" })));
    expect(screen.queryByRole("button", { name: /Charge observed usage/ })).toBeNull();
    cleanup();
    // mutation: gate the floor button on preview.allowed -> missing here, red
    show(["owner"], failed(preview({ tokens: 1_234, allowed: true, refusalReason: null }, false)));
    expect(screen.queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
    expect(screen.getByRole("button", { name: "Charge observed usage (1,234 tokens, approximate)" })).toBeTruthy();
    cleanup();
    show(["member"]);
    expect(screen.queryByRole("button", { name: /Charge observed usage/ })).toBeNull();
  });

  it("the receipt and the activity name the observed floor as approximate", async () => {
    const settled = failed({ ...preview(), allowed: false, refusalReason: "run-usage-settled",
      settlement: { method: "observed-floor", floorTokens: 1_234, reason: "terminal:failed", charged: { work: { tokens: 1_234, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, principal: "agent:cli", at: 1234, reservationDisposition: "committed" } } as never);
    show(["owner"], settled);
    // mutation: drop the observed-floor receipt branch -> the conservative receipt, red
    expect(screen.getByTestId("observed-floor-receipt").textContent).toBe("Settled by agent:cli at 1970-01-01T00:00:01.234Z: at least 1,234 work tokens (observed usage, approximate)");
    cleanup();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ schema: "orca-run-activity-v1", runId: "run-a", entries: [{ seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: 1234, kind: "usage-settled", body: { method: "observed-floor", floorTokens: 1_234 } }] })));
    try {
      render(<RunActivity runId="run-a" changeSeq={1} />);
      expect((await screen.findByRole("listitem")).textContent).toContain("observed usage, approximate · 1234");
    } finally { vi.unstubAllGlobals(); }
  });

  it("in Chinese", async () => {
    await i18n.changeLanguage("zh");
    try { show(["owner"]); expect(screen.getByRole("button", { name: "按观测用量记账（1,234 个 token，近似）" })).toBeTruthy(); }
    finally { await i18n.changeLanguage("en"); }
  });
});

describe("a single call's charge-and-retry offers the observed floor", () => {
  it("sends the floor form only from its own confirm, and offers it only with a floor and a handler", () => {
    const onCharge = vi.fn(), onChargeFloor = vi.fn();
    render(<ChargeRetry charge={{ tokens: 1_000_000, usageLowerBound: 1_234 }} onCharge={onCharge} onChargeFloor={onChargeFloor} />);
    // mutation: drop the floor button from ChargeRetry -> red
    fireEvent.click(screen.getByRole("button", { name: "Charge observed usage (1,234 tokens, approximate) and retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Charge 1,234 tokens (approximate) and retry" }));
    expect(onChargeFloor).toHaveBeenCalledOnce();
    expect(onCharge).not.toHaveBeenCalled();
    cleanup();
    render(<ChargeRetry charge={{ tokens: 1_000_000, usageLowerBound: null }} onCharge={onCharge} onChargeFloor={onChargeFloor} />);
    expect(screen.queryByRole("button", { name: /observed usage/ })).toBeNull();
    cleanup();
    // A flow call passes no handler: its forms are unchanged.
    render(<ChargeRetry charge={{ tokens: 1_000_000, usageLowerBound: 1_234 }} onCharge={onCharge} />);
    expect(screen.queryByRole("button", { name: /observed usage/ })).toBeNull();
  });
});
