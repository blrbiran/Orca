// @vitest-environment jsdom
/**
 * Multi-directory projects spec §13, criterion M16: every §13 code has English and Chinese text, and a multi group's
 * integration region shows each directory's landing state and the two answers to a stopped landing ("Retry the rest",
 * "Mark resolved") in both locales, in place of the scheme picker.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupMultiDirV1, GroupViewV1 } from "../src/controlTypes.js";
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { zhErrors } from "../src/locales/zh.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;

/** §13's table, plus the debug refusal this slice added (spec §12's row). */
const CODES = [
  "multi-dir-partially-landed", "multi-dir-precheck-failed", "multi-dir-precheck-conflict", "multi-dir-precheck-check-failed",
  "multi-dir-target-moved", "multi-dir-target-missing", "multi-dir-landing-conflict", "multi-dir-continuation-unsupported",
  "multi-dir-delivery-unsupported", "multi-dir-delivery-fixed", "multi-dir-project-setting-unsupported",
  "multi-dir-plan-import-unsupported", "flow-project-multi-dir-unsupported", "multi-dir-landing-not-pending",
  "multi-dir-too-few", "multi-dir-too-many", "multi-dir-member-unknown", "multi-dir-member-duplicate",
  "multi-dir-member-not-single", "multi-dir-member-nested", "folder-change-dir-mismatch", "debug-multi-dir-unsupported",
];

const multiDir = (over: Partial<GroupMultiDirV1> = {}): GroupMultiDirV1 => ({
  project: "multi",
  dirs: [
    { key: "main", kind: "repo", primary: true, delivery: "local", lastLanded: "a".repeat(40), landed: true, failed: false },
    { key: "alpha", kind: "repo", primary: false, delivery: "keep", lastLanded: null, landed: false, failed: true },
  ],
  landing: {
    state: "partial", landedKeys: ["main"], reason: "multi-dir-target-missing:alpha", detail: null, failedKey: "alpha",
    movedBeforeAny: 0, resolution: null, at: 1,
  },
  ...over,
});
const multiView = (over: Partial<GroupMultiDirV1> = {}): GroupViewV1 => {
  const base = view([workItem({})]);
  return { ...base, summary: { ...base.summary, multiDir: multiDir(over) } };
};

type Placement = NonNullable<GroupMultiDirV1["dirs"][number]["placement"]>;
/** A multi group whose second member is a folder, so the folder answers have somewhere to show (§9.4). */
const folderView = (placement: Placement): GroupViewV1 =>
  multiView({
    dirs: [
      { key: "main", kind: "repo", primary: true, delivery: "local", lastLanded: "a".repeat(40), landed: true, failed: false },
      { key: "alpha", kind: "dir", primary: false, delivery: "place", lastLanded: null, landed: false, failed: false, placement },
    ],
  });
const placement = (state: Placement["state"], changedTotal: number, unwritableTotal: number): Placement =>
  ({ state, detail: null, changedTotal, unwritableTotal });

describe("the copy for a multi-directory group (spec §13, M16)", () => {
  it("has an English and a Chinese entry for every §13 code", () => {
    for (const code of CODES) {
      expect(enErrors[code], `en ${code}`).toBeTruthy();
      expect(zhErrors[code], `zh ${code}`).toBeTruthy();
    }
  });

  it("keeps the two tables over the same multi-directory codes", () => {
    expect(CODES.filter((code) => !Object.hasOwn(zhErrors, code))).toEqual([]);
    expect(CODES.filter((code) => !Object.hasOwn(enErrors, code))).toEqual([]);
  });

  it.each([
    ["en", "Directories and landing", ["Retry the rest", "Mark resolved"], "alpha's target branch does not exist", "Updated in this landing: main"],
    ["zh", "目录与落地", ["重试剩余目录", "标记为已处理"], "alpha 的目标分支不存在", "这次落地已更新：main"],
  ] as const)("shows each directory's state and both answers in %s", async (lang, regionName, buttons, reason, updated) => {
    await i18n.changeLanguage(lang);
    const onCommand = vi.fn();
    const { container } = render(as(owner, <ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={multiView()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />));
    const block = screen.getByRole("region", { name: regionName });
    // The landing state, the reason in the reader's language, and the directories' own states.
    const state = container.querySelector("[data-multi-dir-state]")!;
    expect(state.getAttribute("data-multi-dir-state")).toBe("partial");
    expect(state.textContent).toBe(lang === "en" ? "Orca updated some directories and then stopped; nothing was undone." : "Orca 更新了部分目录后停了下来；已更新的没有回退。");
    expect(block.textContent).toContain(reason);
    expect(block.textContent).toContain(updated);
    const main = container.querySelector('[data-multi-dir-key="main"]')!;
    const alpha = container.querySelector('[data-multi-dir-key="alpha"]')!;
    expect([main.getAttribute("data-multi-dir-landed"), alpha.getAttribute("data-multi-dir-landed")]).toEqual(["landed", "failed"]);
    expect(main.textContent).toContain(lang === "en" ? "primary" : "主目录");
    expect(main.textContent).toContain(lang === "en" ? "local merge" : "本地合并");
    expect(alpha.textContent).toContain(lang === "en" ? "keep" : "保留");
    expect(alpha.textContent).toContain(lang === "en" ? "failed" : "失败");
    expect(main.textContent).toContain(lang === "en" ? "landed" : "已落地");
    // In place of the scheme picker.
    expect(screen.queryByRole("region", { name: "Git" })).toBeNull();
    for (const name of buttons) fireEvent.click(within(block).getByRole("button", { name }));
    expect(onCommand.mock.calls.map((call) => {
      const action = call[0] as { verb: string; payload: { action: string } };
      return [action.verb, action.payload.action];
    })).toEqual([["multi-dir-landing", "retry-rest"], ["multi-dir-landing", "mark-resolved"]]);
  });

  it("offers a folder member the answers its placement waits on, and sends the one clicked", () => {
    const onCommand = vi.fn();
    const { container } = render(as(owner, <ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={folderView(placement("folder-changed", 2, 0))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />));
    const alpha = container.querySelector<HTMLElement>('[data-multi-dir-key="alpha"]')!;
    expect(alpha.getAttribute("data-multi-dir-landed")).toBe("pending");
    expect(alpha.textContent).toContain("folder");
    expect(alpha.textContent).toContain("delivery: write into the folder");
    expect(alpha.textContent).toContain("Stopped: files this group's finished work would write were changed in the folder. Nothing in the folder was overwritten.");
    expect(within(alpha).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Keep my changes and continue", "Check again", "Leave these out"]);
    fireEvent.click(within(alpha).getByRole("button", { name: "Leave these out" }));
    fireEvent.click(within(alpha).getByRole("button", { name: "Check again" }));
    expect(onCommand.mock.calls.map((call) => {
      const action = call[0] as { verb: string; payload: { dir: string; action: string } };
      return [action.verb, action.payload.dir, action.payload.action];
    })).toEqual([["resolve-folder-change", "alpha", "withhold"], ["resolve-folder-change", "alpha", "recheck"]]);
  });

  it.each([
    ["changed but two files to set aside", "folder-changed", 2, 0, ["Keep my changes and continue", "Check again", "Leave these out"]],
    ["unwritable with files to leave out", "folder-unwritable", 0, 1, ["Check again", "Leave these out"]],
    ["unwritable with nothing to leave out", "folder-unwritable", 0, 0, ["Check again"]],
    ["missing with nothing to leave out", "folder-missing", 0, 0, ["Check again"]],
    ["failed, which waits on no answer", "failed", 2, 2, []],
  ] as const)("shows only the folder answers a %s placement accepts", (_label, state, changed, unwritable, names) => {
    const { container } = render(as(owner, <ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={folderView(placement(state, changed, unwritable))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />));
    const alpha = container.querySelector<HTMLElement>('[data-multi-dir-key="alpha"]')!;
    expect(within(alpha).queryAllByRole("button").map((button) => button.textContent)).toEqual(names);
  });

  it("keeps a member's view of a stopped landing read-only", () => {
    const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
    render(as(member, <ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={multiView()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />));
    const block = screen.getByRole("region", { name: "Directories and landing" });
    expect(within(block).queryAllByRole("button")).toEqual([]);
    expect(block.textContent).toContain("alpha's target branch does not exist");
  });
});
