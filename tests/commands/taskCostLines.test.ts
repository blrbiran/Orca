// Tester #321 part C: an orchestrating agent polls `group brief` and reads `task show`; a task costing a multiple of its
// group (or running past 30 minutes) must reach it there too, in words and in --json, and be said to be a notice only.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";
import { taskCostLine } from "../../src/commands/domains/usageLines.js";
import type { TaskCost } from "../../src/control/taskCost.js";

useFakePanels();

const MIN = 60_000;
const T8: TaskCost = { taskId: "T8", runs: 3, tokens: 14_503_083, ms: 55.4 * MIN, underWay: false, comparable: 5, medianTokens: 3_000_000, medianMs: 10 * MIN,
  tokensMultiple: 14_503_083 / 3_000_000, timeMultiple: 5.54, reasons: ["tokens-multiple", "time-multiple", "long-running"] };
const T8_LINE = "cost: task T8: 3 runs, 55 min, 14,503,083 tokens; group median over 5 finished other tasks: 3,000,000 tokens, 10 min; flagged: 4.8x the median tokens, 5.5x the median time, over 30 min (a notice: nothing was paused or stopped)";

describe("the cost line (#321 C)", () => {
  it("says what the task cost, against what, and why it is flagged", () => {
    expect(taskCostLine(T8)).toBe(T8_LINE);
  });

  it("says how many comparable tasks there are when there is no median, and nothing flagged for an ordinary task", () => {
    expect(taskCostLine({ ...T8, runs: 1, underWay: true, comparable: 2, medianTokens: null, medianMs: null, tokensMultiple: null, timeMultiple: null, reasons: [] }))
      .toBe("cost: task T8: 1 run, 55 min, 14,503,083 tokens so far; 2 finished other tasks to compare with, 3 needed for a median");
  });
});

const SUMMARY = { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 1, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7 }] };
const BRIEF = { schema: "orca-group-brief-v1", groupId: "g-alpha", state: "running", commandRevision: 7 };

describe("group brief (#321 C)", () => {
  it("prints a line per flagged task from costOutliers, and none without it", async () => {
    const flagged = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: { ...BRIEF, costOutliers: [T8] } } });
    const out = await cli(["group", "brief", "g-alpha"], flagged.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop `...costs.map(taskCostLine)` from the brief's format -> red
    expect(out.stdout.split("\n")).toContain(T8_LINE);
    const plain = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: BRIEF } });
    expect((await cli(["group", "brief", "g-alpha"], plain.dir)).stdout).not.toContain("cost: task");
  });
});

describe("task show (#321 C)", () => {
  const ended = (runId: string, taskId: string, tokens: number, minutes: number) => ({ runId, taskId, state: "landed", startedAt: 0, endedAt: minutes * MIN, used: { tokens, activeMs: minutes * MIN, attempts: 1, sessions: 1 } });
  const GROUP = {
    schema: "orca-control-group-v1", epoch: "e", changeSeq: 1, summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7 },
    workItems: ["a", "b", "c", "x"].map((taskId) => ({ taskId, status: "completed", currentRunId: `run-${taskId}` })),
    runs: [ended("run-a", "a", 1_000_000, 5), ended("run-b", "b", 1_000_000, 5), ended("run-c", "c", 1_000_000, 5), ended("run-x0", "x", 2_000_000, 5), ended("run-x", "x", 2_000_000, 5)],
  };

  it("adds the task's cost to --json and prints its line", async () => {
    const p = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha": { status: 200, body: GROUP } });
    const json = await cli(["task", "show", "g-alpha", "x", "--json"], p.dir);
    expect(json.code, json.stderr).toBe(0);
    // mutation: drop `...(cost === null ? {} : { cost })` from the compose -> red
    expect(json.json().body.cost).toMatchObject({ taskId: "x", runs: 2, tokens: 4_000_000, comparable: 3, medianTokens: 1_000_000, reasons: ["tokens-multiple"] });
    const human = await cli(["task", "show", "g-alpha", "x"], p.dir);
    // mutation: drop the cost line from the format -> red
    expect(human.stdout.split("\n")).toContain("cost: task x: 2 runs, 10 min, 4,000,000 tokens; group median over 3 finished other tasks: 1,000,000 tokens, 5 min; flagged: 4.0x the median tokens (a notice: nothing was paused or stopped)");
  });
});
