import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

/**
 * Tester follow-up G spec §1.2, §1.4, §10.1: `group show` and `task show` name a task that completed with no change
 * (who decided; a second time says so) with the command that revokes it, and a task stopped as a provable no change
 * with the two commands that answer it. `--json` is the view unchanged.
 */
useFakePanels();

const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };
const group = (workItems: unknown[], runs: unknown[]) => ({
  schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 }, workItems, runs,
});
const panel = (workItems: unknown[], runs: unknown[]) => fakePanel({ "GET summary": SUMMARY, "GET groups/g-alpha": { status: 200, body: group(workItems, runs) } });

describe("no change in words (tester follow-up G §1.2)", () => {
  it("group show names a no-change task, the 2nd time, and the revoke command", async () => {
    const p = await panel([
      { taskId: "t1", status: "completed", currentRunId: "run-1", noChangeCompletion: { runId: "run-1", ordinal: 1, decidedBy: "agent-verifier", at: 1 } },
      { taskId: "t2", status: "completed", currentRunId: "run-2", noChangeCompletion: { runId: "run-2", ordinal: 2, decidedBy: "judge", at: 2 } },
    ], [{ runId: "run-1", taskId: "t1", state: "settled" }, { runId: "run-2", taskId: "t2", state: "settled" }]);
    for (const argv of [["group", "show", "g-alpha"], ["task", "show", "g-alpha", "t2"]]) {
      const lines = (await cli(argv, p.dir)).stdout.split("\n");
      // mutation M6a: drop the ordinal suffix -> red
      expect(lines, argv.join(" ")).toContain("task t2: no change (judge, 2nd time) in run run-2");
      expect(lines).toContain("  revoke: orca task reopen g-alpha t2 --note '<what to change>'");
    }
    expect((await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n")).toContain("task t1: no change (agent-verifier) in run run-1");
  });

  it("a no-change-twice run names accept-no-change and reopen", async () => {
    const p = await panel([{ taskId: "t1", status: "blocked", currentRunId: "run-2" }],
      [{ runId: "run-2", taskId: "t1", state: "settled", blockedReason: "no-change-twice" }]);
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    expect(lines).toContain("task t1: no-change-twice: run run-2 changed nothing and waits for a decision");
    expect(lines).toContain("next: orca task accept-no-change g-alpha t1 --note '<why>'");
    expect(lines).toContain("  or: orca task reopen g-alpha t1 --note '<what to change>'");
  });

  it("--json is unchanged: no added field", async () => {
    const p = await panel([{ taskId: "t1", status: "completed", currentRunId: "run-1", noChangeCompletion: { runId: "run-1", ordinal: 1, decidedBy: "judge", at: 1 } }], []);
    expect((await cli(["group", "show", "g-alpha", "--json"], p.dir)).stdout).not.toContain("revoke: orca task reopen");
  });
});
