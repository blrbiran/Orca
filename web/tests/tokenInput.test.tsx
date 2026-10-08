// @vitest-environment jsdom
/**
 * Integration + panel fixes spec §9.2 item 3: token amounts are typed and shown as grouped integers
 * ("10,000,000", grouped by the app language), parsed from `,` / space / U+00A0 / U+202F separators, refused in the
 * field (and never sent) when they are anything else, and hinted by magnitude ("≈ 10M" / "约 1000 万").
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import { TokenInput, formatTokens, parseTokens, shortTokens } from "../src/TokenInput.js";
import i18n from "../src/i18n.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupViewV1 } from "../src/controlTypes.js";
import { amount, config as boardConfig, view as boardView, workItem } from "./fixtures/board.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("parseTokens", () => {
  it.each([
    ["10,000,000"], ["10 000 000"], ["10 000 000"], ["10 000 000"], ["10000000"], ["  10,000,000  "],
  ])("reads %j as 10000000", (text) => { expect(parseTokens(text)).toBe(10_000_000); });
  it.each([["10.000.000"], ["1e7"], ["-5"], ["abc"], ["1.5"], [""], ["10_000"], ["9007199254740992"]])("refuses %j", (text) => {
    expect(parseTokens(text)).toBeNull();
  });
  it("reads the largest safe integer", () => { expect(parseTokens(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER); });
});

describe("formatTokens / shortTokens", () => {
  it("groups with a comma in both app languages", () => {
    expect(formatTokens(10_000_000, "en")).toBe("10,000,000");
    expect(formatTokens(10_000_000, "zh")).toBe("10,000,000");
  });
  it("writes the magnitude per language", () => {
    expect(shortTokens(10_000_000, "en")).toBe("10M");
    expect(shortTokens(1_500, "en")).toBe("1.5K");
    expect(shortTokens(2_300_000_000, "en")).toBe("2.3B");
    expect(shortTokens(10_000_000, "zh")).toBe("1000 万");
    expect(shortTokens(150_000_000, "zh")).toBe("1.5 亿");
    expect(shortTokens(999, "en")).toBe("999");
  });
});

function Harness(props: { start: number | null; min?: number; onChange: (n: number) => void; onInvalid?: () => void }): JSX.Element {
  const [value, setValue] = useState(props.start);
  return <TokenInput aria-label="amount" value={value} min={props.min} onInvalid={props.onInvalid} onChange={(n) => { setValue(n); props.onChange(n); }} />;
}
const box = (): HTMLInputElement => screen.getByRole("textbox", { name: "amount" }) as HTMLInputElement;

describe("TokenInput", () => {
  it("shows the grouped integer, re-formats on blur, and passes the integer on", () => {
    const onChange = vi.fn();
    render(<Harness start={10_000_000} onChange={onChange} />);
    expect(box().value).toBe("10,000,000");
    expect(box().inputMode).toBe("numeric");
    fireEvent.change(box(), { target: { value: "12345" } });
    expect(onChange).toHaveBeenLastCalledWith(12345);
    expect(box().value).toBe("12345");
    fireEvent.blur(box());
    expect(box().value).toBe("12,345");
  });
  it("keeps invalid text, shows the field error and never calls onChange", () => {
    const onChange = vi.fn(), onInvalid = vi.fn();
    render(<Harness start={1000} onChange={onChange} onInvalid={onInvalid} />);
    fireEvent.change(box(), { target: { value: "10.000.000" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(box().value).toBe("10.000.000");
    expect(screen.getByRole("alert").textContent).toContain("Enter a whole number");
    fireEvent.blur(box());
    expect(box().value).toBe("10.000.000");
  });
  it("refuses an amount under min", () => {
    const onChange = vi.fn();
    render(<Harness start={5} min={1} onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("hints the magnitude in the app language and none below a thousand", async () => {
    render(<Harness start={10_000_000} onChange={vi.fn()} />);
    expect(screen.getByText("≈ 10M")).toBeTruthy();
    cleanup();
    await i18n.changeLanguage("zh");
    render(<Harness start={10_000_000} onChange={vi.fn()} />);
    expect(screen.getByText("约 1000 万")).toBeTruthy();
    cleanup();
    render(<Harness start={999} onChange={vi.fn()} />);
    expect(screen.queryByText(/约/)).toBeNull();
  });
  it("takes a value changed from outside, but not a re-render with the value just typed", () => {
    const { rerender } = render(<TokenInput aria-label="amount" value={1000} onChange={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "2,5" } });
    rerender(<TokenInput aria-label="amount" value={25} onChange={vi.fn()} />);
    expect(box().value).toBe("2,5");
    rerender(<TokenInput aria-label="amount" value={77000} onChange={vi.fn()} />);
    expect(box().value).toBe("77,000");
  });
  it("shows an empty field without an error when the value is null", () => {
    render(<Harness start={null} onChange={vi.fn()} />);
    expect(box().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("RequirementsPanel limits", () => {
  const mount = (onCommand: (a: ControlAction) => void): void => {
    render(<AccountContext.Provider value={owner}><RequirementsPanel config={config} summary={summaryWith(requirementView("answered"))} views={{}} selected={null} agents={null} language="en" onSelect={() => {}} onCommand={onCommand} /></AccountContext.Provider>);
  };
  const form = (): HTMLElement => screen.getByRole("form", { name: "New requirement" });
  const start = (): void => {
    fireEvent.change(within(form()).getByRole("textbox", { name: "Idea" }), { target: { value: "Print a page." } });
  };
  it("shows the default limit grouped and sends the typed grouped amount as an integer", () => {
    const onCommand = vi.fn();
    mount(onCommand);
    const limit = within(form()).getByRole("textbox", { name: "Token limit" }) as HTMLInputElement;
    expect(limit.value).toBe("10,000,000");
    start();
    fireEvent.change(limit, { target: { value: "12,345" } });
    fireEvent.click(within(form()).getByRole("button", { name: "Start clarifying" }));
    expect((onCommand.mock.calls[0]![0] as ControlAction).payload).toMatchObject({ limit: { tokens: 12345 } });
  });
  it("sends nothing while the limit text is not an amount", () => {
    const onCommand = vi.fn();
    mount(onCommand);
    start();
    fireEvent.change(within(form()).getByRole("textbox", { name: "Token limit" }), { target: { value: "12x" } });
    const submit = within(form()).getByRole("button", { name: "Start clarifying" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.submit(form());
    expect(onCommand).not.toHaveBeenCalled();
  });
  it("raises a requirement's limit with the typed grouped amount, and not with invalid text", () => {
    const onCommand = vi.fn();
    const base = requirementView("answered");
    const view = { ...base, summary: { ...base.summary, requirement: { ...base.summary.requirement!, waiting: "requirement-budget-exhausted" as const } } };
    const Raise = (): JSX.Element => <AccountContext.Provider value={owner}><RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={onCommand} /></AccountContext.Provider>;
    render(<Raise />);
    const raise = screen.getByRole("form", { name: "Raise the limit" });
    const limit = within(raise).getByRole("textbox", { name: "Token limit" });
    fireEvent.change(limit, { target: { value: "20 000 000" } });
    fireEvent.submit(raise);
    expect((onCommand.mock.calls[0]![0] as ControlAction).payload).toMatchObject({ limit: { tokens: 20_000_000 } });
    fireEvent.change(limit, { target: { value: "2e7" } });
    fireEvent.submit(raise);
    expect(onCommand).toHaveBeenCalledTimes(1);
  });
});

describe("BudgetEditor token fields", () => {
  const editable = (): GroupViewV1 => ({
    ...boardView([workItem({ taskId: "a" })]),
    proposal: { ...boardView([]).proposal, state: "editable", profiles: null, budgetMode: null },
    allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000),
      fieldProvenance: { tokens: { provenance: "human", estimateId: null }, activeMs: { provenance: "human", estimateId: null }, attempts: { provenance: "human", estimateId: null }, sessions: { provenance: "human", estimateId: null } } }],
  });
  function Editor(props: { onCommand: (a: ControlAction) => void }): JSX.Element {
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    return <AccountContext.Provider value={owner}><BudgetEditor view={editable()} config={boardConfig} drafts={drafts} onCommand={props.onCommand}
      onDraft={(key, text) => setDrafts((d) => { const n = { ...d }; if (text === "") delete n[key]; else n[key] = text; return n; })} /></AccountContext.Provider>;
  }
  it("groups the allocation, group limit and handoff fields", () => {
    render(<Editor onCommand={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: /^a work tokens/ }) as HTMLInputElement).value).toBe("3,000,000");
    const limits = within(screen.getByRole("group", { name: "Group limit" })).getAllByRole("textbox") as HTMLInputElement[];
    expect(limits[0]!.value).toBe("9,000,000");
    expect((screen.getByRole("textbox", { name: /^Hand off at context tokens/ }) as HTMLInputElement).value).toBe("0");
  });
  it("saves a typed grouped allocation as an integer and refuses invalid text instead of sending the old value", () => {
    const onCommand = vi.fn();
    render(<Editor onCommand={onCommand} />);
    const field = screen.getByRole("textbox", { name: /^a work tokens/ });
    fireEvent.change(field, { target: { value: "4,000,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save proposal" }));
    expect(JSON.stringify((onCommand.mock.calls[0]![0] as ControlAction).payload)).toContain("4000000");
    fireEvent.change(field, { target: { value: "4.000.000" } });
    expect((screen.getByRole("button", { name: "Save proposal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Set limit" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
  });
  it("sends a typed grouped group limit", () => {
    const onCommand = vi.fn();
    render(<Editor onCommand={onCommand} />);
    const [tokens] = within(screen.getByRole("group", { name: "Group limit" })).getAllByRole("textbox");
    fireEvent.change(tokens!, { target: { value: "9 500 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Set limit" }));
    expect((onCommand.mock.calls[0]![0] as ControlAction).payload).toMatchObject({ limit: { tokens: 9_500_000 } });
  });
});
