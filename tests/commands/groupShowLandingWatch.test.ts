// Tester follow-up G §6.2 (#269): `orca group show` names each regression the landing watch recorded on the group branch:
// its problem code, the tasks that landed, how it exited and where, the output tail, and what answers it.
import { describe, expect, it } from "vitest";
import { landingWatchLines } from "../../src/commands/domains/verbs.js";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const TIP = "c".repeat(40);
const REGRESSION = { command: "npm test", landedTaskIds: ["b", "c"], tip: TIP, exit: "1", tail: "AssertionError: 3 !== 1", since: 1, problem: "landing-regression:npm test" };

describe("group show names a landing regression (tester follow-up G §6.2)", () => {
  it("group show names a landing regression with its command, tasks and tail", () => {
    expect(landingWatchLines("g", { regressions: [REGRESSION] })).toEqual([
      "problem: landing-regression:npm test (after b, c landed; exited 1 on orca/g at cccccccccccc)",
      "  AssertionError: 3 !== 1",
      "next: add a task that fixes it, or wait for the task that owns it; the watch runs again on the next landing",
    ]);
    expect(landingWatchLines("g", { regressions: [] })).toEqual([]);
    expect(landingWatchLines("g", undefined)).toEqual([]);
  });

  it("the lines reach the group show output", async () => {
    const summary = { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5, landingWatch: { tip: TIP, at: 1, commands: [], regressions: [REGRESSION] } };
    const p = await fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [summary] } },
      "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary, workItems: [], runs: [] } },
    });
    const out = await cli(["group", "show", "g-alpha"], p.dir);
    expect(out.code).toBe(0);
    expect(out.stdout.split("\n")).toContain("problem: landing-regression:npm test (after b, c landed; exited 1 on orca/g-alpha at cccccccccccc)");
  });

  // Follow-up K seat K2 noticed formatWithUnestimated spread landingWatchLines twice: each regression printed twice.
  it("group show prints each landing regression once", async () => {
    const summary = { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5, landingWatch: { tip: TIP, at: 1, commands: [], regressions: [REGRESSION] } };
    const p = await fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [summary] } },
      "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary, workItems: [], runs: [] } },
    });
    const out = await cli(["group", "show", "g-alpha"], p.dir);
    expect(out.code).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines.filter((line) => line.startsWith("problem: landing-regression:npm test"))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("next: add a task that fixes it"))).toHaveLength(1);
  });
});
