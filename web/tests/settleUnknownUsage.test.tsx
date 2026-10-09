// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunActivity } from "../src/TaskDetail.js";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath, commandEnvelope } from "../src/controlApi.js";
import { config, run, view } from "./usageRecoveryFixture.js";
afterEach(cleanup);
const remaining = { work: { tokens: 91, activeMs: 920, attempts: 3, sessions: 4 }, handoff: { tokens: 51, activeMs: 520, attempts: 5, sessions: 6 } };
const failed = () => run({ state: "blocked", outcome: "failed", stopReason: "Error: codex-event-error", unknownUsageSettlement: { generation: 7, highWater: 2, remaining, allowed: true, refusalReason: null } });
const show = (roles: ("owner" | "member")[], r = failed()) => { const onCommand = vi.fn(); const result = render(<ControlGroupView view={view([r])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={roles} />); return { ...result, onCommand }; };
describe("owner conservative usage settlement", () => {
  it("requires explicit confirmation of all dimensions of both buckets and sends identity only", () => {
    const { onCommand } = show(["owner"]);
    fireEvent.click(screen.getByRole("button", { name: "Settle unknown usage" }));
    const confirm = screen.getByRole("button", { name: "Confirm irreversible settlement" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not actual usage reported by the model/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Remaining grant to charge" });
    expect(within(table).getAllByRole("row").map(row => row.textContent)).toEqual(["BucketTokensActive time (ms)AttemptsSessions", "Work9192034", "Handoff5152056"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and approve this charge" }));
    fireEvent.click(confirm);
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ verb: "settle-unknown-usage", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", generation: 7, acknowledge: "charge-remaining-grant" } });
    const action = onCommand.mock.calls[0]![0];
    expect(controlCommandPath(action)).toBe("/api/control/groups/g/settle-unknown-usage");
    expect(commandEnvelope("intent", action)).toEqual({ commandId: "intent", expectedRevision: 6, payload: action.payload });
  });
  it.each([["member"], []] as ("owner" | "member")[][])("does not authorize a member or an absent account: %j", (role) => {
    show([role].filter(Boolean) as ("owner" | "member")[]);
    expect(screen.queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
    expect(screen.getByText(/Contact an owner/)).toBeTruthy();
  });
  it("uses server refusal instead of claiming isolation proof and keeps failure visible", () => {
    const r = failed(); r.unknownUsageSettlement!.allowed = false; r.unknownUsageSettlement!.refusalReason = "run-stop-proof-required";
    show(["owner"], r);
    expect(screen.queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
    expect(screen.getByText(/complete isolated stop proof/)).toBeTruthy();
    expect(screen.getByText(/reported an error/)).toBeTruthy();
  });
  it("drops confirmation when the server preview changes", () => {
    const { rerender, onCommand } = show(["owner"]);
    fireEvent.click(screen.getByRole("button", { name: "Settle unknown usage" }));
    fireEvent.click(screen.getByRole("checkbox"));
    const r = failed(); r.unknownUsageSettlement = { ...r.unknownUsageSettlement!, highWater: 3 };
    rerender(<ControlGroupView view={view([r])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={["owner"]} />);
    expect(screen.queryByRole("button", { name: "Confirm irreversible settlement" })).toBeNull();
  });
});

it("activity names conservative method and all charged dimensions rather than implying actual model usage", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ schema: "orca-run-activity-v1", runId: "run-a", entries: [{ seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: 1234, kind: "usage-settled", body: { method: "remaining-grant", charged: remaining } }] })));
  try {
    render(<RunActivity runId="run-a" changeSeq={1} />);
    const line = (await screen.findByRole("listitem")).textContent!;
    expect(line).toContain("remaining grant (conservative accounting)");
    expect(line).toContain("Work: 91 tokens, 920 ms, 3 attempts, 4 sessions");
    expect(line).toContain("Handoff: 51 tokens, 520 ms, 5 attempts, 6 sessions");
  } finally { vi.unstubAllGlobals(); }
});
it("renders Chinese settlement and recovery guidance", async () => {
  await i18n.changeLanguage("zh");
  try { show(["owner"]); fireEvent.click(screen.getByRole("button", { name: "结清未知用量" })); expect(screen.getByText(/不是模型报告的实际用量/)).toBeTruthy(); expect(screen.getByRole("table", { name: "将记入的剩余额度" })).toBeTruthy(); }
  finally { await i18n.changeLanguage("en"); }
});
