// Tester #321 part C: in an unlimited group one task ran 3 times, ~56 minutes and 14.5M tokens (39% of the group) and
// nothing told the person. Each task's cost over all its runs is set against the group median over its finished peers, so a
// person (and an orchestrating agent) can judge at a failure whether another run is worth it. These criteria pin when a
// task is flagged, and when it is not -- a notice that fires on ordinary variation would be ignored, and one that needs a
// median it cannot have would say something false.
import { describe, expect, it } from "vitest";
import { COST_LONG_RUNNING_MS, COST_MIN_COMPARABLE_TASKS, COST_OUTLIER_MULTIPLE, costFinished, costOutliers, costRunOfView, costUnderWay, runMs, taskCosts, viewTaskCost, type CostRun } from "../../src/control/taskCost.js";
import { costOutliersOf } from "../../src/control/runUsageView.js";

const NOW = Date.UTC(2026, 10, 16, 4, 0, 0);
const MIN = 60_000;
/** A finished run with known usage: `tokens`, `minutes` of booked active time. */
const ended = (taskId: string, tokens: number, minutes: number, over: Partial<CostRun> = {}): CostRun =>
  ({ taskId, tokens, usageKnown: true, activeMs: minutes * MIN, startedAt: NOW - 120 * MIN, endedAt: NOW - 100 * MIN, underWay: false, finished: true, ...over });

/** The reported group, cut down: five ordinary one-run tasks of 1.3M-5.0M tokens and ~10 minutes, and T8's three runs. */
const GROUP: CostRun[] = [
  ended("T1", 1_300_000, 8), ended("T2", 2_000_000, 9), ended("T3", 3_000_000, 10), ended("T4", 4_000_000, 11), ended("T5", 5_000_000, 12),
  ended("T8", 7_287_387, 29.7, { finished: false }), ended("T8", 3_463_512, 13.4, { finished: false }), ended("T8", 3_752_184, 12.3),
];

describe("a task's cost against its group (#321 C)", () => {
  it("sums a task's runs and flags T8 by tokens and by time; the ordinary tasks are not flagged", () => {
    const costs = taskCosts(GROUP, NOW);
    const t8 = costs.find((cost) => cost.taskId === "T8")!;
    expect(t8).toMatchObject({ runs: 3, tokens: 14_503_083, comparable: 5, medianTokens: 3_000_000, medianMs: 10 * MIN, underWay: false });
    expect(t8.ms).toBeCloseTo(55.4 * MIN, -3);
    expect(t8.tokensMultiple).toBeCloseTo(4.83, 2);
    // mutation: drop the "time-multiple" branch -> T8's reasons lose it (5.5x the 10-minute median)
    // T8's 55 minutes are past the 30-minute line, but T8 has a median, so only the multiples flag it.
    // mutation: drop the `!enough` gate of "long-running" -> it is added here -> red
    expect(t8.reasons).toEqual(["tokens-multiple", "time-multiple"]);
    expect(costs.filter((cost) => cost.taskId !== "T8").every((cost) => cost.reasons.length === 0)).toBe(true);
    expect(costOutliers(GROUP, NOW).map((cost) => cost.taskId)).toEqual(["T8"]);
  });

  it("compares a task with the others, not with itself", () => {
    // With T8 among its own comparables the median of six would be 3.5M, not 3.0M.
    // mutation: drop `other !== taskId` -> comparable 6, median 3.5M -> red
    expect(taskCosts(GROUP, NOW).find((cost) => cost.taskId === "T8")).toMatchObject({ comparable: 5, medianTokens: 3_000_000 });
  });

  it(`says nothing relative below ${COST_MIN_COMPARABLE_TASKS} comparable tasks, and flags a long task anyway`, () => {
    const few = [ended("A", 1_000_000, 5), ended("B", 1_000_000, 5), ended("C", 9_000_000, 31)];
    const c = taskCosts(few, NOW).find((cost) => cost.taskId === "C")!;
    // mutation: compare `others.length >= 1` -> a median of two tasks exists and C is flagged 9x -> red
    expect(c).toMatchObject({ comparable: 2, medianTokens: null, medianMs: null, tokensMultiple: null, timeMultiple: null });
    // With no median the absolute line applies: 31 minutes is past it.
    // mutation: drop the "long-running" branch -> [] -> red
    expect(c.reasons).toEqual(["long-running"]);
    expect(COST_LONG_RUNNING_MS).toBe(30 * MIN);
  });

  it("does not flag a long task in a group whose tasks all run long: with a median, only the multiple flags (controller ruling 2026-11-18)", () => {
    const slow = [ended("A", 1_000_000, 35), ended("B", 1_000_000, 35), ended("C", 1_000_000, 35), ended("X", 1_000_000, 40)];
    // 40 minutes is past the 30-minute line, but only 1.1x the 35-minute median.
    // mutation: drop the `!enough` gate of "long-running" -> ["long-running"] -> red
    expect(taskCosts(slow, NOW).find((cost) => cost.taskId === "X")).toMatchObject({ comparable: 3, medianMs: 35 * MIN, reasons: [] });
  });

  it(`flags at ${COST_OUTLIER_MULTIPLE}x the median and not below`, () => {
    const base = [ended("A", 1_000_000, 1), ended("B", 1_000_000, 1), ended("C", 1_000_000, 1)];
    expect(taskCosts([...base, ended("X", 2_990_000, 1)], NOW).find((cost) => cost.taskId === "X")!.reasons).toEqual([]);
    // mutation: COST_OUTLIER_MULTIPLE = 4 -> red
    expect(taskCosts([...base, ended("X", 3_000_000, 1)], NOW).find((cost) => cost.taskId === "X")!.reasons).toEqual(["tokens-multiple"]);
  });

  it("compares only with finished peers whose usage is known and not 0: peers of 0, 0, 2M, 2M give no 1M median (review ruling 2026-11-18)", () => {
    const peers = [ended("A", 0, 10, { usageKnown: false }), ended("B", 0, 10), ended("C", 2_000_000, 10), ended("D", 2_000_000, 10)];
    // mutation: drop `entry.tokens !== null && entry.tokens > 0` -> comparable 4 (A's unknown 0 read as 0), median 1M -> red
    expect(taskCosts([...peers, ended("X", 2_500_000, 10)], NOW).find((cost) => cost.taskId === "X")).toMatchObject({ comparable: 2, medianTokens: null });
    // With a third finished peer of 2M the median is 2M, not a figure pulled down by the zeros.
    expect(taskCosts([...peers, ended("E", 2_000_000, 10), ended("X", 2_500_000, 10)], NOW).find((cost) => cost.taskId === "X"))
      .toMatchObject({ comparable: 3, medianTokens: 2_000_000 });
    // An unfinished peer (its runs failed, or are collected and not landed) is not one either.
    // mutation: drop `entry.finished` -> comparable 3, median 2M -> red
    const unfinished = [ended("C", 2_000_000, 10), ended("D", 2_000_000, 10), ended("F", 2_000_000, 10, { finished: false })];
    expect(taskCosts([...unfinished, ended("X", 2_500_000, 10)], NOW).find((cost) => cost.taskId === "X")).toMatchObject({ comparable: 2, medianTokens: null });
  });

  it("says a task's tokens are unknown when any of its runs' usage is, and gives it no token multiple", () => {
    const base = [ended("A", 1_000_000, 1), ended("B", 1_000_000, 1), ended("C", 1_000_000, 1)];
    // mutation: sum an unknown run's tokens as a figure -> tokens 9M, multiple 9 -> red
    expect(taskCosts([...base, ended("X", 1_000_000, 1), ended("X", 8_000_000, 1, { usageKnown: false })], NOW).find((cost) => cost.taskId === "X"))
      .toMatchObject({ runs: 2, tokens: null, tokensMultiple: null, reasons: [] });
  });

  it("leaves a task with a run under way out of the others' median, and counts its time since it started", () => {
    const runs = [ended("A", 1_000_000, 11), ended("B", 1_000_000, 11), ended("C", 1_000_000, 11),
      ended("R", 2_526_911, 2, { startedAt: NOW - 28 * MIN, endedAt: null, underWay: true, finished: false })];
    const costs = taskCosts(runs, NOW);
    // The review-fix task of the report, 27.7 minutes in: its booked 2 minutes lag, the wall clock does not.
    // mutation: drop the under-way branch of runMs -> 2 minutes -> red
    expect(costs.find((cost) => cost.taskId === "R")).toMatchObject({ underWay: true, ms: 28 * MIN, comparable: 3, reasons: [] });
    // mutation: count under-way tasks as comparable (a task that also finished earlier, reopened) -> A's comparable is 3 -> red
    const reopened = [...runs.slice(0, 3), ended("R", 1_000_000, 1), runs[3]!];
    expect(taskCosts(reopened, NOW).find((cost) => cost.taskId === "A")!.comparable).toBe(2);
    // Its time keeps growing with the clock: two minutes on, in a group without a median (A left out), it crosses 30.
    expect(taskCosts(runs.slice(1), NOW + 2 * MIN).find((cost) => cost.taskId === "R")).toMatchObject({ comparable: 2, ms: 30 * MIN, reasons: ["long-running"] });
  });

  it("reads an ended run's booked time, or its wall-clock span only when none was booked", () => {
    expect(runMs(ended("a", 0, 5, { startedAt: 0, endedAt: 60 * MIN }), NOW)).toBe(5 * MIN);
    // mutation: drop the wall-clock fallback -> 0 -> red
    expect(runMs(ended("a", 0, 0, { startedAt: 0, endedAt: 7 * MIN }), NOW)).toBe(7 * MIN);
  });

  it("has no time multiple against a zero median time, and leaves runs without a task out", () => {
    // Peers with tokens but no booked time and no times known: they took 0 ms, so the median time is 0.
    const noTime = (taskId: string): CostRun => ended(taskId, 1_000_000, 0, { startedAt: null, endedAt: null });
    const runs = [noTime("A"), noTime("B"), noTime("C"), ended("X", 1_000_000, 1), { ...ended("e", 9_000_000, 99), taskId: null }];
    const costs = taskCosts(runs, NOW);
    // mutation: drop `medianMs === 0` -> Infinity -> red
    expect(costs.find((cost) => cost.taskId === "X")).toMatchObject({ medianMs: 0, timeMultiple: null, reasons: [] });
    expect(costs.map((cost) => cost.taskId)).toEqual(["A", "B", "C", "X"]);
  });

  it("calls a run under way only while its agent still spends: starting or running, in either the view's or the stored names (review ruling 2026-11-18)", () => {
    // mutation: add "collected" (or any waiting state) to the set -> red
    for (const state of ["starting", "running", "claimed", "start-pending", "accepted"]) expect(costUnderWay({ state }), state).toBe(true);
    for (const state of ["collected", "reconciling", "unknown", "attempt-unknown", "blocked", "landed", "settled", "settled-failed"]) expect(costUnderWay({ state }), state).toBe(false);
    // mutation: drop `run.endedAt == null` -> red
    expect(costUnderWay({ state: "running", endedAt: 5 })).toBe(false);
    // mutation: drop the `outcome === "succeeded"` arm -> red; drop the `landed` arm -> red
    expect(costFinished({ state: "settled", outcome: "succeeded" })).toBe(true);
    expect(costFinished({ state: "landed" })).toBe(true);
    expect(costFinished({ state: "collected", outcome: null })).toBe(false);
  });

  it("reads the panel's run view, and gives no task-show cost for a view whose runs carry no usage", () => {
    expect(costRunOfView({ taskId: "a", state: "running", startedAt: 5, used: { tokens: 1, activeMs: 2 } }))
      .toEqual({ taskId: "a", tokens: 1, usageKnown: true, activeMs: 2, startedAt: 5, endedAt: null, underWay: true, finished: false });
    // mutation: read usageKnown as true always -> red
    expect(costRunOfView({ taskId: "a", state: "landed", usageUnknown: true, used: { tokens: 0, activeMs: 2 } })).toMatchObject({ usageKnown: false, finished: true });
    expect(viewTaskCost([{ taskId: "a", state: "landed", used: { tokens: 1, activeMs: 2 } }], "a", NOW)).toMatchObject({ taskId: "a", runs: 1, tokens: 1 });
    // mutation: drop the missing-`used` guard -> a TypeError reading `tokens` -> red
    expect(viewTaskCost([{ taskId: "a", state: "landed", used: { tokens: 1, activeMs: 2 } }, { used: undefined }], "a", NOW)).toBeNull();
    expect(viewTaskCost([{ taskId: "a", state: "landed", used: { tokens: 1, activeMs: 2 } }], "b", NOW)).toBeNull();
  });
});

describe("group brief's costOutliers from stored runs (#321 C)", () => {
  /** A stored run body as the runs table holds it: a landed work run with known usage. */
  const body = (taskId: string | null, tokens: number, minutes: number, over: Record<string, unknown> = {}) => ({ body: JSON.stringify({
    taskId, phase: "work", state: "landed", startedAt: NOW - 200 * MIN, endedAt: NOW - 100 * MIN, unknown: { work: false, handoff: false },
    cumulative: { work: { tokens, activeMs: minutes * MIN, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, ...over }) });
  const store = (rows: Array<{ body: string }>) => ({ db: { prepare: () => ({ all: () => rows }) } }) as never;

  it("names the flagged tasks and is null when none is flagged", () => {
    const rows = [body("A", 1_000_000, 5), body("B", 1_000_000, 5), body("C", 1_000_000, 5), body("X", 3_500_000, 5)];
    expect(costOutliersOf(store(rows), "g", NOW)).toMatchObject([{ taskId: "X", runs: 1, tokens: 3_500_000, reasons: ["tokens-multiple"] }]);
    expect(costOutliersOf(store([...rows.slice(0, 3), body("X", 1_000_000, 5)]), "g", NOW)).toBeNull();
  });

  it("reads a stored run's unknown usage and its outcome as the view does", () => {
    // A finished-by-outcome peer counts; one whose usage is unknown does not (so no median, and X is not flagged).
    const rows = [body("A", 1_000_000, 5, { state: "settled", drive: { outcome: "succeeded" } }), body("B", 1_000_000, 5),
      body("C", 1_000_000, 5, { unknown: { work: true, handoff: false } }), body("X", 3_500_000, 5)];
    // mutation: read the stored unknown flag as known -> C counts, X flagged -> red
    expect(costOutliersOf(store(rows), "g", NOW)).toBeNull();
    // mutation: drop the stored outcome from costFinished's input -> A is unfinished, no median -> red
    expect(costOutliersOf(store([...rows.slice(0, 2), body("D", 1_000_000, 5), body("X", 3_500_000, 5)]), "g", NOW)).toMatchObject([{ taskId: "X", comparable: 3 }]);
  });

  it("counts a stored run under way from when it started", () => {
    const rows = [body("A", 1, 1), body("B", 1, 1), body("C", 1, 1), body("R", 1, 0, { state: "accepted", endedAt: undefined, startedAt: NOW - 31 * MIN })];
    // mutation: underWay false for every stored run -> R reads 0 minutes -> null -> red
    // R has a median (A, B, C), so its 31 minutes flag only as a multiple of their 1 minute.
    expect(costOutliersOf(store(rows), "g", NOW)).toMatchObject([{ taskId: "R", underWay: true, reasons: ["time-multiple"] }]);
  });
});

describe("the reviewer's probe: a landing wait does not make every task look long-running (review ruling 2026-11-18)", () => {
  // Four tasks collected (done working, waiting to land), 5 minutes booked each, started 40 minutes ago.
  const at = { startedAt: NOW - 40 * MIN, endedAt: null as number | null };
  const view = ["a", "b", "c", "d"].map((taskId) => ({ taskId, state: "collected", ...at, used: { tokens: 1_000_000, activeMs: 5 * MIN } }));
  const stored = ["a", "b", "c", "d"].map((taskId) => ({ body: JSON.stringify({ taskId, phase: "work", state: "collected", startedAt: at.startedAt,
    unknown: { work: false, handoff: false }, cumulative: { work: { tokens: 1_000_000, activeMs: 5 * MIN, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } } }) }));

  it("flags none of them on the panel and in task show (the view's runs) or in the brief (the stored runs)", () => {
    // mutation: count a collected run as under way (the brief's old runUnderWay) -> 40 minutes each, long-running -> red
    expect(taskCosts(view.map(costRunOfView), NOW).map((cost) => [cost.ms, cost.reasons])).toEqual(["a", "b", "c", "d"].map(() => [5 * MIN, []]));
    expect(viewTaskCost(view, "a", NOW)).toMatchObject({ ms: 5 * MIN, reasons: [] });
    expect(costOutliersOf({ db: { prepare: () => ({ all: () => stored }) } } as never, "g", NOW)).toBeNull();
  });
});
