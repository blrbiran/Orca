// @vitest-environment jsdom
/**
 * Tester round 2 spec §7.4 (C27, C28): one function, confirmBlockers, decides both the checklist above the confirm buttons
 * and whether they are disabled; an unlimited-token group Orca confirms on its own says so instead of the starts note, with
 * what still holds it (a running estimate, a person's own default agent, an earlier refusal). The static "Review task
 * plan" lines -- among them the false "Start is a separate action" -- are gone from the page.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { BudgetEditor, confirmBlockers } from "../src/BudgetEditor.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { ControlConfigV1, EstimateViewV1, GroupViewV1 } from "../src/controlTypes.js";
import { amount, config, view as boardView } from "./fixtures/board.js";

afterEach(cleanup);

const HASH = "9".repeat(64);
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const draft = (over: Partial<GroupViewV1> = {}): GroupViewV1 => {
  const base = boardView([]);
  return {
    ...base, summary: { ...base.summary, state: "draft" },
    proposal: { ...base.proposal, state: "editable", profiles: null, budgetMode: null, executionSnapshotHash: null },
    // board.ts's amount(0) has attempts/sessions 1; a ledger with no deficit has 0 in every dimension.
    ledger: { ...base.ledger, groupLimit: amount(9_000_000), budgetDeficit: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, ...over,
  };
};
const unlimited = (over: Partial<GroupViewV1> = {}): GroupViewV1 => {
  const base = draft(over);
  return { ...base, ledger: { ...base.ledger, groupLimit: { ...base.ledger.groupLimit, tokens: null } }, autoConfirm: { eligible: true, refusedCode: null }, ...over };
};
const integration = { scheme: { delivery: "github-pr", trigger: "task", target: "main", remote: "origin" }, schemeHash: "7".repeat(64), frozen: false, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null } as unknown as NonNullable<GroupViewV1["integration"]>;
const estimate = (state: EstimateViewV1["state"]): EstimateViewV1 => ({ estimateId: "e1", estimateVersion: 1, state, profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft", requestHash: null, outputHash: null, output: null, reasonCode: null });

function editor(v: GroupViewV1, options: { config?: ControlConfigV1; hash?: string | null; drafts?: Record<string, string>; me?: Me; ownAgent?: boolean } = {}): ReturnType<typeof vi.fn> {
  const onCommand = vi.fn();
  const node: JSX.Element = <BudgetEditor view={v} config={options.config ?? config} drafts={options.drafts ?? {}} onDraft={() => {}} onCommand={onCommand}
    selectionsHash={options.hash === undefined ? HASH : options.hash} ownAgent={options.ownAgent} />;
  render(options.me === undefined ? node : <AccountContext.Provider value={options.me}>{node}</AccountContext.Provider>);
  return onCommand;
}
const buttons = (): HTMLButtonElement[] => [screen.getByRole("button", { name: "Confirm task plan" }), screen.getByRole("button", { name: "Confirm only, don't run yet" })] as HTMLButtonElement[];
const reactOnClick = (element: Element): (() => void) => {
  const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"))!;
  return (element as unknown as Record<string, { onClick: () => void }>)[key]!.onClick;
};
const checklist = (): HTMLElement => screen.getByRole("list", { name: "Before confirming" });
// An empty checklist is not rendered at all (review minor 7).
const blockerLines = (): string[] => screen.queryByRole("list", { name: "Before confirming" }) === null ? [] : within(checklist()).queryAllByRole("listitem").map((li) => li.getAttribute("data-blocker") ?? "").filter((name) => name !== "");

describe("the confirm checklist (C27)", () => {
  it.each([
    ["profiles", { config: { ...config, defaults: null } }, "Choose a budget mode and agent profiles, or set the defaults in Global settings."],
    ["selections", { hash: null }, "Every agent slot must resolve; see Agent selection below, or check installation and defaults in Global settings"],
    ["owner", { me: member, view: { integration } }, "This group has a delivery scheme (push or PR); only an owner can confirm it."],
    ["draft", { drafts: { "g:group-limit:tokens": "invalid" } }, "Fix the highlighted values first."],
    // Spec §21 (review I1): a limited group over its limit; the server refuses confirm until the limit is raised.
    ["deficit", { view: { ledger: { ...draft().ledger, budgetDeficit: { tokens: 5_000, activeMs: 0, attempts: 0, sessions: 0 } } } }, "This group is over its limit; raise the group limit before confirming. Go to the group limit"],
  ] as const)("the %s blocker alone shows its line and disables both buttons", (name, options, text) => {
    const v = draft("view" in options ? options.view : {});
    const onCommand = editor(v, options as Parameters<typeof editor>[1]);
    expect(blockerLines()).toEqual([name]);
    const line = within(checklist()).getAllByRole("listitem").find((li) => li.getAttribute("data-blocker") === name)!;
    expect(line.textContent).toBe(text);
    expect(buttons().map((button) => button.disabled)).toEqual([true, true]);
    for (const button of buttons()) fireEvent.click(button);
    // A disabled button's click never reaches React, so submitConfirm's own guard is driven directly through each
    // button's onClick (review minor 12): one function decides both the buttons and the send.
    for (const button of buttons()) reactOnClick(button)();
    expect(onCommand).not.toHaveBeenCalled();
    expect(confirmBlockers(v, "config" in options ? options.config : config, "hash" in options ? options.hash : HASH, !("me" in options), "drafts" in options ? options.drafts : {}, { mode: "", profiles: { worker: "", handoff: "", goalReview: "" } })).toEqual([name]);
  });

  it("the deficit blocker's button moves focus to the group limit field", () => {
    editor(draft({ ledger: { ...draft().ledger, budgetDeficit: { tokens: 5_000, activeMs: 0, attempts: 0, sessions: 0 } } }));
    fireEvent.click(within(checklist()).getByRole("button", { name: "Go to the group limit" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "tokens" }));
  });

  it("an unlimited group's token figures never raise the deficit blocker", () => {
    const v = unlimited({ autoConfirm: { eligible: false, refusedCode: null } });
    expect(confirmBlockers({ ...v, ledger: { ...v.ledger, budgetDeficit: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } } }, config, HASH, true, {}, { mode: "", profiles: { worker: "", handoff: "", goalReview: "" } })).toEqual([]);
  });

  it("links the selections blocker to Global settings", () => {
    editor(draft(), { hash: null });
    expect(within(checklist()).getByRole("link", { name: "Global settings" }).getAttribute("href")).toBe("#global-settings");
  });

  it("with nothing blocking a limited group: one status line, the starts note, and both buttons enabled", () => {
    const onCommand = editor(draft());
    expect(blockerLines()).toEqual([]);
    expect(screen.getByTestId("blocker-none").textContent).toBe("Nothing blocks confirming.");
    expect(screen.getByTestId("blocker-none").getAttribute("role")).toBe("status");
    expect(screen.queryByRole("list", { name: "Before confirming" })).toBeNull();
    expect(screen.getByTestId("confirm-starts-note")).toBeTruthy();
    expect(buttons().map((button) => button.disabled)).toEqual([false, false]);
    fireEvent.click(buttons()[0]!);
    expect(onCommand).toHaveBeenCalledTimes(1);
  });
});

describe("unlimited-token groups (C28)", () => {
  it("an eligible group: the pending line replaces the starts note; the buttons stay", () => {
    editor(unlimited());
    expect(screen.getByTestId("auto-confirm-pending").textContent).toBe("Token use is unlimited, so Orca confirms and starts this group on its own once nothing above blocks it.");
    expect(screen.queryByTestId("confirm-starts-note")).toBeNull();
    expect(screen.queryByTestId("blocker-none")).toBeNull();
    expect(buttons().map((button) => button.disabled)).toEqual([false, false]);
  });

  it("names a running estimate, the person's own default agent and an earlier refusal, each on its condition", () => {
    editor(unlimited({ estimates: [estimate("queued")] }));
    expect(screen.queryByTestId("auto-estimate")).toBeNull();
    expect(screen.queryByTestId("auto-own-agent")).toBeNull();
    expect(screen.queryByTestId("auto-refused")).toBeNull();
    cleanup();
    editor(unlimited({ estimates: [estimate("running")] }), { ownAgent: true });
    expect(screen.getByTestId("auto-estimate").textContent).toBe("Waiting for the running estimate to finish.");
    expect(screen.getByTestId("auto-own-agent").textContent).toContain("your personal default agent does not count");
    cleanup();
    editor(unlimited({ estimates: [estimate("start-unknown")], autoConfirm: { eligible: true, refusedCode: "auto-confirm-selections-unresolved" } }));
    expect(screen.getByTestId("auto-estimate")).toBeTruthy();
    expect(screen.getByTestId("auto-refused").textContent).toBe("Orca's automatic confirm was refused: Orca could not resolve every agent slot with the group's own choices. Fix it and edit the proposal to try again, or confirm by hand.");
  });

  it("a group with a delivery scheme says it is not confirmed automatically; an absent autoConfirm is not eligible", () => {
    editor(unlimited({ integration, autoConfirm: { eligible: false, refusedCode: null } }));
    expect(screen.getByTestId("auto-integration").textContent).toBe("A group with a delivery scheme needs an owner's confirm, so it is not confirmed automatically.");
    expect(screen.queryByTestId("auto-confirm-pending")).toBeNull();
    cleanup();
    const older = unlimited(); delete older.autoConfirm;
    editor(older);
    expect(screen.queryByTestId("auto-confirm-pending")).toBeNull();
    expect(screen.getByTestId("confirm-starts-note")).toBeTruthy();
  });

  it("a limited group never shows the automatic lines, even when the server calls it eligible", () => {
    editor(draft({ autoConfirm: { eligible: true, refusedCode: "x" }, estimates: [estimate("running")] }), { ownAgent: true });
    expect(screen.queryByTestId("auto-confirm-pending")).toBeNull();
    expect(screen.queryByTestId("auto-estimate")).toBeNull();
    expect(screen.queryByTestId("auto-refused")).toBeNull();
  });
});

describe("the static review lines are gone (C28, §7.4 item 5)", () => {
  it("renders no sequence, agent-review, integration-review or token-policy copy on the group page", () => {
    render(<ControlGroupView view={draft()} config={config} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={() => {}} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Goal: Ship");
    for (const gone of ["Start is a separate action", "Review the effective Agent", "Review the integration target", "Review the optional token policy"]) expect(text).not.toContain(gone);
  });
});
