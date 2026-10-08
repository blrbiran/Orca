// @vitest-environment jsdom
/**
 * Accounts spec §3.5, §7 (Task 11 fix round, review Important 2): set-limit and requirement-open.limit are human-only,
 * so a member logged in to the page is offered no control the server would answer 403 -- no Set limit, no Raise the
 * limit form, no limit field on a new requirement -- and a member's requirement-open carries no `limit` at all, so a
 * member can still open a requirement (with the server's default limit). An owner keeps every control (positive
 * control for each assertion).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlAction } from "../src/controlApi.js";
import type { ControlSummaryV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config as boardConfig, view as boardView, workItem } from "./fixtures/board.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
afterEach(cleanup);

const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;

function openRequirement(me: Me): ControlAction {
  const onCommand = vi.fn();
  const view = requirementView("answered");
  render(as(me, <RequirementsPanel config={config} summary={summaryWith(view)} views={{}} selected={null} agents={null} language="en" onSelect={() => {}} onCommand={onCommand} />));
  const form = screen.getByRole("form", { name: "New requirement" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Idea" }), { target: { value: "Let people print a page." } });
  fireEvent.click(within(form).getByRole("button", { name: "Start clarifying" }));
  return onCommand.mock.calls[0]![0] as ControlAction;
}

describe("human-only controls follow the account (spec §3.5)", () => {
  it("opens a member's requirement without a limit field or a limit, and an owner's with both", () => {
    const fromMember = openRequirement(member);
    expect(fromMember.verb).toBe("requirement-open");
    expect(Object.hasOwn(fromMember.payload, "limit")).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Token limit" })).toBeNull();
    cleanup();
    const fromOwner = openRequirement(owner);
    expect((fromOwner.payload as { limit?: { tokens: number } }).limit?.tokens).toBe(10_000_000);
  });

  it("tells a member who raises an exhausted requirement limit instead of offering the form", () => {
    const base = requirementView("answered");
    const view: RequirementViewV1 = { ...base, summary: { ...base.summary, requirement: { ...base.summary.requirement!, waiting: "requirement-budget-exhausted" } } };
    const mount = (me: Me): void => {
      render(as(me, <RequirementsPanel config={config} summary={summaryWith(view) as ControlSummaryV1} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={vi.fn()} />));
    };
    mount(member);
    expect(screen.queryByRole("form", { name: "Raise the limit" })).toBeNull();
    expect(screen.getByText("Only an owner can raise this limit; ask one to.")).toBeTruthy();
    cleanup();
    mount(owner);
    expect(screen.getByRole("form", { name: "Raise the limit" })).toBeTruthy();
  });

  it("shows a member the group limit read-only without Set limit, and gives an owner the button", () => {
    const group = boardView([workItem({ taskId: "a" })]);
    const mount = (me: Me): void => {
      render(as(me, <BudgetEditor view={group} config={boardConfig} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />));
    };
    mount(member);
    expect(screen.queryByRole("button", { name: "Set limit" })).toBeNull();
    expect(screen.getByText("Only an owner can change the group limit.")).toBeTruthy();
    const limits = within(screen.getByRole("group", { name: "Group limit" })).getAllByRole("textbox") as HTMLInputElement[];
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((input) => input.readOnly)).toBe(true);
    cleanup();
    mount(owner);
    expect(screen.getByRole("button", { name: "Set limit" })).toBeTruthy();
  });
});
