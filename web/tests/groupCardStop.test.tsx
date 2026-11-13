// @vitest-environment jsdom
/**
 * Tester #288: after a stop, a Tasks card read "g · review · 1/2 done · handoff-pending" (zh 「交接待处理」, which reads
 * like work waiting for the person), so it did not say whether the stop was still in progress or done. The stop now leads
 * the card's state line as a state -- Pausing, Paused, Stopping, Stopped, Stopped (partial), Stop unresolved -- and the
 * group's own state follows it. "Needs you" stays a category chip, not a state.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { GroupList } from "../src/GroupList.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "orca", state: "review", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 1, total: 2 }, counts: { ...zero, done: 1, idle: 1 }, archived: false, ...over,
});
const line = (group: GroupSummaryV1): string => {
  render(<GroupList groups={[group]} selected={null} onSelect={vi.fn()} now={NOW} />);
  const name = screen.getByRole("button", { name: /^g · / }).getAttribute("aria-labelledby")!.split(" ")[0]!;
  const text = document.getElementById(name)!.textContent!;
  cleanup();
  return text;
};
afterEach(cleanup);

describe("tester #288: a stop leads the group card's state line", () => {
  it.each([
    [{ stopMode: "handoff", stopState: "handoff-pending" }, "g · Stopping · review · 1/2 done"],
    [{ stopMode: "handoff", stopState: "handoff-complete" }, "g · Stopped · review · 1/2 done"],
    [{ stopMode: "pause", stopState: "paused" }, "g · Paused · review · 1/2 done"],
    [{ stopMode: "handoff", stopState: "handoff-partial" }, "g · Stopped (partial) · review · 1/2 done"],
    [{ stopMode: "shutdown", stopState: "handoff-unresolved" }, "g · Stop unresolved · review · 1/2 done"],
    // The intent is recorded, its state not yet.
    [{ stopMode: "pause", stopState: null }, "g · Pausing · review · 1/2 done"],
    [{ stopMode: "handoff", stopState: null }, "g · Stopping · review · 1/2 done"],
  ] as const)("%o reads %s", (stop, expected) => {
    // mutation: drop the stop label from the line -> "g · review · 1/2 done", red
    // mutation: map handoff-pending to Stopped -> the in-progress stop reads as done, red
    expect(line(g(stop as Partial<GroupSummaryV1>))).toBe(expected);
  });

  it("adds nothing to a group with no stop", () => {
    // mutation: always print a stop label -> red
    expect(line(g({}))).toBe("g · review · 1/2 done");
  });

  it("keeps needs-you a category chip beside it, not a state", () => {
    render(<GroupList groups={[g({ stopMode: "handoff", stopState: "handoff-pending", recoveryBlockerCount: 1 })]} selected={null} onSelect={vi.fn()} now={NOW} />);
    const card = screen.getByRole("button", { name: /^g · Stopping · review/ });
    expect(card.querySelector(".group-chip")!.textContent).toBe("Needs attention");
  });

  it("says it as a state in Chinese, not a to-do", async () => {
    await i18n.changeLanguage("zh");
    try {
      const text = line(g({ stopMode: "handoff", stopState: "handoff-pending" }));
      // mutation: keep 「交接待处理」 -> red
      expect(text.startsWith("g · 正在停止 · ")).toBe(true);
      expect(text).not.toContain("待处理");
      expect(line(g({ stopMode: "handoff", stopState: "handoff-complete" })).startsWith("g · 已停止 · ")).toBe(true);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
