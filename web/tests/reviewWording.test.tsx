// @vitest-environment jsdom
/**
 * Tester #128: every settle moves a group to `review`, blocked tasks included, so "goal review" (zh 正在验收目标) is
 * said only when every task is done; a review group with a blocked task says its tasks are blocked instead, and one
 * with work still to run says neither.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { Overview } from "../src/Overview.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { config, view } from "./fixtures/board.js";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });
const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const CASES = [
  ["all done", { completion: { done: 2, total: 2 }, counts: { ...zero, done: 2 } }, "goal"],
  ["one blocked", { completion: { done: 0, total: 2 }, counts: { ...zero, blocked: 1, idle: 1 } }, "blocked"],
  ["work left, none blocked", { completion: { done: 1, total: 2 }, counts: { ...zero, done: 1, idle: 1 } }, "none"],
] as const;
const summary = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({ ...view([]).summary, state: "review", ...over });

it.each(CASES)("group detail of a review group, %s", (_name, over, expected) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const v = view([]); v.summary = summary(over);
  render(<ControlGroupView view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  const text = document.body.textContent ?? "";
  // mutation: reviewWording answers goal-review for every review group -> the blocked case shows goal review, red
  expect(text.includes("The group is in goal review")).toBe(expected === "goal");
  // mutation: drop the blocked branch of reviewWording -> the blocked case shows no blocked line, red
  expect(text.includes("Some of this group's tasks are blocked")).toBe(expected === "blocked");
  // Ruling (2026-11-11, session f958ec3f): human approved rewriting necessary criteria; this now encodes that no group page
  // carries the generic next-action line (#81); a group with work left and none blocked says neither line above.
  expect(text.includes("Review progress, preparation or problems")).toBe(false);
});

it.each(CASES)("overview row of a review group, %s (zh)", async (_name, over, expected) => {
  await i18n.changeLanguage("zh");
  const group = summary(over);
  render(<Overview model={{ progress: [{ group, owner: "Orca", ownerUnknown: false, target: { kind: "group", groupId: "g" } as never }], queue: [], issues: [], sources: [], scopeUnavailable: false, complete: true }}
    onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
  const text = screen.getByRole("region", { name: i18n.t("overview.progress") }).textContent ?? "";
  expect(text.includes("正在验收目标")).toBe(expected === "goal");
  expect(text.includes("有任务被阻塞")).toBe(expected === "blocked");
});
