// Tester #173 / #224 / #266 (follow-up L; human, round K: "at confirm, use the median actual spend of this repo's past
// tasks as a reference, computed by code, and show the estimate/history ratio"): `proposal show` and `group confirm` print
// the group view's `estimateHistory` (src/control/estimateHistory.ts) under their human output, and carry it in --json.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { groupView, world } from "./fixtures/world.js";

useFakePanels();

const HISTORY = { medianTokens: 2_100_000, sampleCount: 14, minimumSample: 3, tasks: [
  { taskId: "t1", estimateTokens: 28_000, ratio: 0.013 }, { taskId: "t2", estimateTokens: null, ratio: null },
] };
const withHistory = (history: unknown) => ({ "GET groups/g-alpha": { status: 200, body: { ...groupView(), estimateHistory: history } } });
const MEDIAN = "history: finished tasks of other groups in this repository used a median of 2100000 tokens each (n=14; every run of a task, ledger units)";
const T1 = "  task t1: estimate 28000 tokens, 0.013x that median";
const T2 = "  task t2: not estimated";

describe("the repository's history beside the estimate (#173/#224/#266)", () => {
  it("proposal show prints the median and each task's multiple, and --json carries it", async () => {
    const w = await world({}, withHistory(HISTORY));
    const shown = await cli(["proposal", "show", "g-alpha"], w.dir);
    expect(shown.code).toBe(0);
    // mutation L-cli-lines: historyLines answers [] -> no line, red
    expect(shown.stdout).toContain(`${MEDIAN}\n${T1}\n${T2}`);
    const json = await cli(["proposal", "show", "g-alpha", "--json"], w.dir);
    // mutation L-cli-json: proposal show's JSON without it -> red
    expect(JSON.parse(json.stdout).body.estimateHistory).toEqual(HISTORY);
    expect(json.stdout).not.toContain("history: ");
  });

  it("group confirm prints the same lines, and --json carries it", async () => {
    const w = await world({}, withHistory(HISTORY));
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code).toBe(0);
    // mutation L-confirm-lines: confirm's note without them -> red
    expect(confirmed.stdout).toContain(`${MEDIAN}\n${T1}\n${T2}`);
    const json = await cli(["group", "confirm", "g-alpha", "--json"], (await world({}, withHistory(HISTORY))).dir);
    // mutation L-confirm-json: confirm's JSON without it -> red
    expect(JSON.parse(json.stdout).body.estimateHistory).toEqual(HISTORY);
  });

  it("says when there are too few finished tasks, and gives no number", async () => {
    const w = await world({}, withHistory({ medianTokens: null, sampleCount: 2, minimumSample: 3, tasks: [{ taskId: "t1", estimateTokens: 28_000, ratio: null }] }));
    const out = (await cli(["proposal", "show", "g-alpha"], w.dir)).stdout;
    // mutation L-cli-toofew: the too-few branch prints the median line -> "median of null", red
    expect(out).toContain("history: too few finished tasks in this repository to compare the estimates with (2; at least 3 needed)");
    expect(out).not.toContain("median");
  });

  it("prints nothing and adds no key when the view has none (a confirmed proposal, an older panel)", async () => {
    const w = await world();
    expect((await cli(["proposal", "show", "g-alpha"], w.dir)).stdout).not.toContain("history:");
    expect(JSON.parse((await cli(["proposal", "show", "g-alpha", "--json"], w.dir)).stdout).body).not.toHaveProperty("estimateHistory");
    expect(JSON.parse((await cli(["group", "confirm", "g-alpha", "--json"], (await world()).dir)).stdout).body).not.toHaveProperty("estimateHistory");
  });
});
