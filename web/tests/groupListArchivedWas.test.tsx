// @vitest-environment jsdom
// Tester #370 (plan 2026-11-18 tester batch D, V3): an archived group's card said `running` -- its stored state, frozen by
// the archive -- next to the Archived chip. It now reads `archived (was running)`; a live group's card is unchanged.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { GroupList } from "../src/GroupList.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "orca", state: "running", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 1 }, counts: { ...zero, idle: 1 }, archived: false, ...over,
});
const nav = () => screen.getByRole("navigation", { name: "Control groups" });

afterEach(() => { cleanup(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("an archived group's card (#370)", () => {
  it("reads archived (was <state>); a live one keeps its state word", () => {
    render(<GroupList groups={[g("live"), g("old", { archived: true })]} selected={null} onSelect={vi.fn()} now={0} />);
    const name = () => nav().querySelector(".group-card-name")!.textContent ?? "";
    expect(name()).toContain("live · running");
    fireEvent.click(within(screen.getByRole("group", { name: "Show groups" })).getByRole("button", { name: "Archived" }));
    // mutation: show enumText(state) for an archived group again -> "old · running", red
    expect(name()).toContain("old · archived (was running)");
  });
});
