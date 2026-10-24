// @vitest-environment jsdom
/**
 * Dir-requirements spec §9.3, criterion D11: every §9.3 code and the three reason words have English and Chinese text,
 * and a dir group's integration region shows the placement block (changed, unwritable and withheld paths, the three
 * answers) in place of the scheme picker, in both locales. The requirement page says a dir group's document stays in
 * Orca's store.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlConfigV1, ControlSummaryV1, GroupPlacementV1, GroupViewV1, RequirementViewV1 } from "../src/controlTypes.js";
import i18n from "../src/i18n.js";
import { en, enErrors } from "../src/locales/en.js";
import { zh, zhErrors } from "../src/locales/zh.js";
import { config, view, workItem } from "./fixtures/board.js";
import { requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;

const placement = (over: Partial<GroupPlacementV1> = {}): GroupPlacementV1 => ({
  workspaceKind: "dir", state: "folder-changed", tip: "1".repeat(40), landedTip: "1".repeat(40), pending: null,
  changed: ["notes/a.md"], changedTotal: 1, unwritable: [{ path: "docs", reason: "type-change" }], unwritableTotal: 1,
  withheld: [{ path: "secret.md", reason: "symlink", toEntry: "100644", by: "olga", at: 1 }], watch: "watch-1", detail: null,
  resolution: null, at: 1, ...over,
});
const dirView = (over: Partial<GroupPlacementV1> = {}): GroupViewV1 => {
  const base = view([workItem({})]);
  return { ...base, summary: { ...base.summary, placement: placement(over) } };
};

describe("the copy for a dir group's placement (spec §9.3, D11)", () => {
  const CODES = [
    "dir-folder-changed", "dir-folder-unwritable", "dir-folder-missing", "dir-placement-failed", "dir-base-missing",
    "dir-group-delivery-fixed", "dir-project-plan-import-unsupported", "folder-change-not-pending",
  ];

  it("has an English and a Chinese entry for every §9.3 code", () => {
    for (const code of CODES) {
      expect(enErrors[code], `en ${code}`).toBeTruthy();
      expect(zhErrors[code], `zh ${code}`).toBeTruthy();
    }
  });

  it("has English and Chinese words for the three reasons and the block's labels", () => {
    for (const reason of ["symlink", "type-change", "case-clash"] as const) {
      expect(en.control.placement.reason[reason], `en ${reason}`).toBeTruthy();
      expect(zh.control.placement.reason[reason], `zh ${reason}`).toBeTruthy();
    }
    expect([en.control.placement.region, en.control.placement.changed, en.control.placement.unwritable, en.control.placement.withheld, en.control.placement.more])
      .toEqual(["Folder placement", "Changed in the folder", "Cannot be written", "Kept in Orca's store, not written to the folder", "and {{n}} more"]);
    expect([zh.control.placement.region, zh.control.placement.changed, zh.control.placement.unwritable, zh.control.placement.withheld, zh.control.placement.more])
      .toEqual(["文件夹写入", "文件夹里被改动的文件", "不能写进去的文件", "保存在 Orca 内部，不写入文件夹", "另有 {{n}} 个"]);
    expect([en.control.placement.take, en.control.placement.recheck, en.control.placement.withhold]).toEqual(["Keep my changes and continue", "Check again", "Leave these out"]);
    expect([zh.control.placement.take, zh.control.placement.recheck, zh.control.placement.withhold]).toEqual(["保留我的改动并继续", "重新检查", "这些不写"]);
    expect([en.requirements.exportKept, zh.requirements.exportKept]).toEqual(["Kept in Orca's store (not written to the folder)", "保存在 Orca 内部（不写入文件夹）"]);
  });

  it.each([
    ["en", "Folder placement", ["Keep my changes and continue", "Check again", "Leave these out"]],
    ["zh", "文件夹写入", ["保留我的改动并继续", "重新检查", "这些不写"]],
  ] as const)("shows the changed, unwritable and withheld paths and the three answers in %s", async (lang, regionName, buttons) => {
    await i18n.changeLanguage(lang);
    const onCommand = vi.fn();
    render(as(owner, <ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={dirView()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />));
    const block = screen.getByRole("region", { name: regionName });
    expect(block.textContent).toContain("notes/a.md");
    expect(block.textContent).toContain("docs");
    expect(block.textContent).toContain("secret.md");
    expect(within(block).getByRole("heading", { name: lang === "en" ? "Changed in the folder" : "文件夹里被改动的文件" })).toBeTruthy();
    expect(within(block).getByRole("heading", { name: lang === "en" ? "Cannot be written" : "不能写进去的文件" })).toBeTruthy();
    expect(within(block).getByRole("heading", { name: lang === "en" ? "Kept in Orca's store, not written to the folder" : "保存在 Orca 内部，不写入文件夹" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Git" })).toBeNull();
    expect(screen.queryByRole("button", { name: lang === "en" ? "Save integration" : "保存集成方式" })).toBeNull();
    for (const name of buttons) fireEvent.click(within(block).getByRole("button", { name }));
    expect(onCommand.mock.calls.map((call) => (call[0] as { payload: { action: string } }).payload.action)).toEqual(["take-folder", "recheck", "withhold"]);
  });

  it("keeps a member's view of a stopped placement read-only", () => {
    const onCommand = vi.fn();
    const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
    render(as(member, <ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={dirView()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />));
    const block = screen.getByRole("region", { name: "Folder placement" });
    expect(block.textContent).toContain("notes/a.md");
    expect(within(block).queryAllByRole("button")).toEqual([]);
  });

  it("says a dir group's requirement document stays in Orca's store", () => {
    const base = requirementView("awaiting-answers");
    const dirRequirement: RequirementViewV1 = { ...base, summary: { ...base.summary, placement: placement() } };
    render(<RequirementsPanel config={config as ControlConfigV1} summary={summaryWith(dirRequirement) as ControlSummaryV1} views={{ r: dirRequirement }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={vi.fn()} />);
    expect(screen.getByText("Kept in Orca's store (not written to the folder)")).toBeTruthy();
    expect(screen.queryByText(/^Export:/)).toBeNull();
  });
});
