import { describe, expect, it } from "vitest";
import { GROUP_FILTER_KEY, groupCategory, matchesGroupFilter, needsAttention, readGroupFilter, writeGroupFilter } from "../src/groupCategory.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { requirementView } from "./fixtures/requirement.js";

const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId: "g", repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 2 }, counts: { ...zero, idle: 2 }, ...over,
});

/** Issue-fixes spec §6.4: a group's list category, first match wins: archived, attention, done, running, not started. */
describe("groupCategory (spec §6.4)", () => {
  it("1: archived", () => expect(groupCategory(g({ archived: true }))).toBe("archived"));
  // Ruling: human 2026-11-10 (session 9179cdad, #218/#221 question: 「两条都允许」) -- a plain pause was in the attention list;
  // a pause the person asked for is now a state, not a request for them, unless something else in the group needs them.
  it("2: needs attention -- a blocked task, a recovery blocker, a blocked claim, a blocked group, a stop still settling", () => {
    for (const over of [
      { counts: { ...zero, blocked: 1, idle: 1 } }, { recoveryBlockerCount: 1 }, { claimBlocked: true }, { state: "blocked" as const },
      { stopMode: "handoff" as const, stopState: "handoff-pending" as const },
      { stopMode: "pause" as const, stopState: "paused" as const, counts: { ...zero, blocked: 1, idle: 1 } },
      { stopMode: "pause" as const, stopState: "paused" as const, recoveryBlockerCount: 1 },
    ]) expect(groupCategory(g(over)), JSON.stringify(over)).toBe("attention");
    expect(groupCategory(g({ stopMode: "handoff", stopState: "handoff-complete" }))).toBe("not-started");
    // #218: mutation: put `paused` back in the stop clause -> attention, red
    expect(needsAttention(g({ stopMode: "pause", stopState: "paused" }))).toBe(false);
  });
  const requirement = requirementView("awaiting-review").summary.requirement!;
  it.each([
    ["unknown requirement usage", { state: "clarifying", requirement: { ...requirement, usageUnknown: true } }],
    ["a blocked requirement call", { state: "clarifying", requirement: { ...requirement, blockedRun: { runId: "run1", reason: "start-unknown" } } }],
    ["a requirement waiting on usage", { state: "clarifying", requirement: { ...requirement, waiting: "requirement-usage-unknown" } }],
    ["an export conflict", { state: "clarifying", requirement: { ...requirement, exportState: "conflict" } }],
    ["a failed review", { requirementReview: { state: "not-passed", why: "cannot-judge", rounds: [], autoFixRounds: 0, problem: "review-not-passed" } }],
    ["a pause waiting for a decision", { card: { budget: { usedTokens: 1, limitTokens: 10 }, pendingDecisions: 0, firstFailure: null,
      budgetAlerts: { overExpectation: 0, waitingDecision: 1, groupCapReached: 0 } } }],
  ] as Array<[string, Partial<GroupSummaryV1>]>) ("an older summary flags %s", (_name, over) => {
    expect(needsAttention(g(over))).toBe(true);
  });
  it("uses the server's explicit needsYou even if fallback facts disagree", () => {
    expect(needsAttention(g({ needsYou: false, state: "clarifying", requirement: { ...requirement, usageUnknown: true } }))).toBe(false);
  });
  it("3: done when every task is done", () => expect(groupCategory(g({ completion: { done: 2, total: 2 }, counts: { ...zero, done: 2 } }))).toBe("done"));
  it("4: running when a task runs or waits, or the group runs or is in review", () => {
    expect(groupCategory(g({ counts: { ...zero, running: 1, idle: 1 } }))).toBe("running");
    expect(groupCategory(g({ counts: { ...zero, waiting: 1, idle: 1 } }))).toBe("running");
    expect(groupCategory(g({ state: "running" }))).toBe("running");
    expect(groupCategory(g({ state: "review" }))).toBe("running");
  });
  it("5: otherwise not started (including a group with no plan tasks)", () => {
    expect(groupCategory(g())).toBe("not-started");
    expect(groupCategory(g({ completion: { done: 0, total: 0 }, counts: zero }))).toBe("not-started");
  });
  it("an older server's summary without counts, completion or stopState is not started, and does not throw", () => {
    const old = g();
    delete old.counts; delete old.completion; delete (old as { stopState?: unknown }).stopState;
    expect(groupCategory(old)).toBe("not-started");
  });
  it("takes the first match: archived beats attention, attention beats done, done beats running", () => {
    expect(groupCategory(g({ archived: true, claimBlocked: true }))).toBe("archived");
    expect(groupCategory(g({ claimBlocked: true, completion: { done: 2, total: 2 } }))).toBe("attention");
    expect(groupCategory(g({ state: "review", completion: { done: 2, total: 2 } }))).toBe("done");
    expect(needsAttention(g({ archived: true, claimBlocked: true }))).toBe(true);
  });
  it("All excludes archived; every other filter is its own category", () => {
    expect(matchesGroupFilter(g({ archived: true }), "all")).toBe(false);
    expect(matchesGroupFilter(g(), "all")).toBe(true);
    expect(matchesGroupFilter(g({ archived: true }), "archived")).toBe(true);
    expect(matchesGroupFilter(g(), "done")).toBe(false);
  });
});

describe("the remembered filter (spec §6.4: per viewer, storage may be missing or throw)", () => {
  const memory = (): Pick<Storage, "getItem" | "setItem"> => {
    const values = new Map<string, string>();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  };
  const throwing: Pick<Storage, "getItem" | "setItem"> = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

  it("reads back what was written, under its own key", () => {
    const storage = memory();
    writeGroupFilter(storage, "done");
    expect(storage.getItem(GROUP_FILTER_KEY)).toBe("done");
    expect(readGroupFilter(storage)).toBe("done");
  });
  it("answers All for nothing stored, an unknown value, missing storage and throwing storage", () => {
    const storage = memory();
    expect(readGroupFilter(storage)).toBe("all");
    storage.setItem(GROUP_FILTER_KEY, "everything");
    expect(readGroupFilter(storage)).toBe("all");
    expect(readGroupFilter(undefined)).toBe("all");
    expect(readGroupFilter(throwing)).toBe("all");
    expect(() => writeGroupFilter(throwing, "done")).not.toThrow();
  });
});
