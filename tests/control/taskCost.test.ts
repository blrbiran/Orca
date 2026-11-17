// Tester #321 part C: in an unlimited group one task ran 3 times, ~56 minutes and 14.5M tokens (39% of the group) and
// nothing told the person. Each task's cost over all its runs is set against the group median over comparable tasks, so a
// person (and an orchestrating agent) can judge at a failure whether another run is worth it. These criteria pin when a
// task is flagged, and when it is not -- a notice that fires on ordinary variation would be ignored, and one that needs a
// median it cannot have would say something false.
import { describe, expect, it } from "vitest";
import { COST_LONG_RUNNING_MS, COST_MIN_COMPARABLE_TASKS, COST_OUTLIER_MULTIPLE, costOutliers, costRunOfView, runMs, taskCosts, viewTaskCost, type CostRun } from "../../src/control/taskCost.js";
import { costOutliersOf } from "../../src/control/runUsageView.js";

const NOW = Date.UTC(2026, 10, 16, 4, 0, 0);
const MIN = 60_000;
/** An ended run: `tokens`, `minutes` of booked active time. */
const ended = (taskId: string, tokens: number, minutes: number): CostRun => ({ taskId, tokens, activeMs: minutes * MIN, startedAt: NOW - 120 * MIN, endedAt: NOW - 100 * MIN, underWay: false });

/** The reported group, cut down: five ordinary one-run tasks of 1.3M-5.0M tokens and ~10 minutes, and T8's three runs. */
const GROUP: CostRun[] = [
  ended("T1", 1_300_000, 8), ended("T2", 2_000_000, 9), ended("T3", 3_000_000, 10), ended("T4", 4_000_000, 11), ended("T5", 5_000_000, 12),
  ended("T8", 7_287_387, 29.7), ended("T8", 3_463_512, 13.4), ended("T8", 3_752_184, 12.3),
];

describe("a task's cost against its group (#321 C)", () => {
  it("sums a task's runs and flags T8 by tokens and by time; the ordinary tasks are not flagged", () => {
    const costs = taskCosts(GROUP, NOW);
    const t8 = costs.find((cost) => cost.taskId === "T8")!;
    expect(t8).toMatchObject({ runs: 3, tokens: 14_503_083, comparable: 5, medianTokens: 3_000_000, medianMs: 10 * MIN, underWay: false });
    expect(t8.ms).toBeCloseTo(55.4 * MIN, -3);
    expect(t8.tokensMultiple).toBeCloseTo(4.83, 2);
    // mutation: drop the "long-running" branch -> T8's reasons lose it (55 min is over 30)
    // mutation: drop the "time-multiple" branch -> T8's reasons lose it (5.5x the 10-minute median)
    expect(t8.reasons).toEqual(["tokens-multiple", "time-multiple", "long-running"]);
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
    // The absolute line needs no median: 31 minutes is past it.
    expect(c.reasons).toEqual(["long-running"]);
    expect(COST_LONG_RUNNING_MS).toBe(30 * MIN);
  });

  it(`flags at ${COST_OUTLIER_MULTIPLE}x the median and not below`, () => {
    const base = [ended("A", 1_000_000, 1), ended("B", 1_000_000, 1), ended("C", 1_000_000, 1)];
    expect(taskCosts([...base, ended("X", 2_990_000, 1)], NOW).find((cost) => cost.taskId === "X")!.reasons).toEqual([]);
    // mutation: COST_OUTLIER_MULTIPLE = 4 -> red
    expect(taskCosts([...base, ended("X", 3_000_000, 1)], NOW).find((cost) => cost.taskId === "X")!.reasons).toEqual(["tokens-multiple"]);
  });

  it("leaves a task with a run under way out of the others' median, and counts its time since it started", () => {
    const runs = [ended("A", 1_000_000, 11), ended("B", 1_000_000, 11), ended("C", 1_000_000, 11),
      { taskId: "R", tokens: 2_526_911, activeMs: 2 * MIN, startedAt: NOW - 28 * MIN, endedAt: null, underWay: true }];
    const costs = taskCosts(runs, NOW);
    // mutation: count under-way tasks as comparable -> A's comparable is 3 -> red
    expect(costs.find((cost) => cost.taskId === "A")!.comparable).toBe(2);
    // The review-fix task of the report, 27.7 minutes in: its booked 2 minutes lag, the wall clock does not.
    // mutation: drop the under-way branch of runMs -> 2 minutes -> red
    expect(costs.find((cost) => cost.taskId === "R")).toMatchObject({ underWay: true, ms: 28 * MIN, comparable: 3, reasons: [] });
    expect(taskCosts(runs, NOW + 2 * MIN).find((cost) => cost.taskId === "R")!.reasons).toEqual(["long-running"]);
  });

  it("reads an ended run's booked time, or its wall-clock span only when none was booked", () => {
    expect(runMs({ taskId: "a", tokens: 0, activeMs: 5 * MIN, startedAt: 0, endedAt: 60 * MIN, underWay: false }, NOW)).toBe(5 * MIN);
    // mutation: drop the wall-clock fallback -> 0 -> red
    expect(runMs({ taskId: "a", tokens: 0, activeMs: 0, startedAt: 0, endedAt: 7 * MIN, underWay: false }, NOW)).toBe(7 * MIN);
  });

  it("has no multiple against a zero median, and leaves runs without a task out", () => {
    // No booked time and no times known: these tasks took 0 ms, so the median time is 0 too.
    const zero = (taskId: string): CostRun => ({ taskId, tokens: 0, activeMs: 0, startedAt: null, endedAt: null, underWay: false });
    const runs = [zero("A"), zero("B"), zero("C"), ended("X", 5_000, 1), { ...ended("e", 9_000_000, 99), taskId: null }];
    const costs = taskCosts(runs, NOW);
    // mutation: drop `medianTokens === 0` -> Infinity -> red
    expect(costs.find((cost) => cost.taskId === "X")).toMatchObject({ medianTokens: 0, tokensMultiple: null, timeMultiple: null, reasons: [] });
    expect(costs.map((cost) => cost.taskId)).toEqual(["A", "B", "C", "X"]);
  });

  it("reads the panel's run view, and gives no task-show cost for a view whose runs carry no usage", () => {
    expect(costRunOfView({ taskId: "a", state: "running", startedAt: 5, used: { tokens: 1, activeMs: 2 } })).toEqual({ taskId: "a", tokens: 1, activeMs: 2, startedAt: 5, endedAt: null, underWay: true });
    expect(costRunOfView({ taskId: "a", state: "blocked", startedAt: 5, used: { tokens: 1, activeMs: 2 } }).underWay).toBe(false);
    expect(viewTaskCost([{ taskId: "a", state: "landed", used: { tokens: 1, activeMs: 2 } }], "a", NOW)).toMatchObject({ taskId: "a", runs: 1, tokens: 1 });
    // mutation: drop the missing-`used` guard -> a TypeError reading `tokens` -> red
    expect(viewTaskCost([{ taskId: "a", state: "landed", used: { tokens: 1, activeMs: 2 } }, { used: undefined }], "a", NOW)).toBeNull();
    expect(viewTaskCost([{ taskId: "a", state: "landed", used: { tokens: 1, activeMs: 2 } }], "b", NOW)).toBeNull();
  });
});

describe("group brief's costOutliers from stored runs (#321 C)", () => {
  /** A stored run body as the runs table holds it: each phase books into its own bucket. */
  const body = (taskId: string | null, tokens: number, minutes: number, over: Record<string, unknown> = {}) => ({ body: JSON.stringify({
    taskId, phase: "work", state: "settled", startedAt: NOW - 200 * MIN, endedAt: NOW - 100 * MIN,
    cumulative: { work: { tokens, activeMs: minutes * MIN, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, ...over }) });
  const store = (rows: Array<{ body: string }>) => ({ db: { prepare: () => ({ all: () => rows }) } }) as never;

  it("names the flagged tasks, reading a handoff run's own bucket, and is null when none is flagged", () => {
    const rows = [body("A", 1_000_000, 5), body("B", 1_000_000, 5), body("C", 1_000_000, 5), body("X", 1_000_000, 5),
      // mutation: read cumulative.work for a handoff run -> X stays at 1M and is not flagged -> red
      body("X", 0, 0, { phase: "handoff", cumulative: { work: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 2_500_000, activeMs: MIN, attempts: 1, sessions: 1 } } })];
    expect(costOutliersOf(store(rows), "g", NOW)).toMatchObject([{ taskId: "X", runs: 2, tokens: 3_500_000, reasons: ["tokens-multiple"] }]);
    expect(costOutliersOf(store(rows.slice(0, 4)), "g", NOW)).toBeNull();
  });

  it("counts a stored run under way from when it started", () => {
    const rows = [body("A", 1, 1), body("B", 1, 1), body("C", 1, 1), body("R", 1, 0, { state: "running", endedAt: undefined, startedAt: NOW - 31 * MIN })];
    // mutation: underWay false for every stored run -> R reads 0 minutes -> null -> red
    expect(costOutliersOf(store(rows), "g", NOW)).toMatchObject([{ taskId: "R", underWay: true, reasons: ["time-multiple", "long-running"] }]);
  });
});
