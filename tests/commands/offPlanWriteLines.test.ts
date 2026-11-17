// Off-plan writes spec W3 (#346, plan Task 4): `run show` names a landed run's off-plan writes beside where it names a
// run's path-policy misses, and `task show` names them for the task's current run -- capped paths, then how many more.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const RUN = { runId: "run-1", taskId: "t1", state: "landed", outcome: "succeeded",
  grant: { work: { tokens: 1_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 }, handoff: { tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 } } };
const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };

async function panel(run: Record<string, unknown>) {
  return fakePanel({
    "GET summary": SUMMARY,
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "completed", currentRunId: "run-1" }], runs: [run] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });
}

describe("off-plan writes in run show and task show (#346 W3)", () => {
  it("names the paths, and how many more there were than the record keeps", async () => {
    const p = await panel({ ...RUN, offPlanWrites: { paths: ["README.md", "src/board/cli.js"], count: 5 } });
    for (const argv of [["run", "show", "run-1", "--group", "g-alpha"], ["task", "show", "g-alpha", "t1"]]) {
      const out = await cli(argv, p.dir);
      expect(out.code, argv.join(" ")).toBe(0);
      // mutation: drop offPlanWriteLines from that formatter -> red for that command
      expect(out.stdout.split("\n"), argv.join(" ")).toContain("off-plan writes: README.md, src/board/cli.js (+3 more)");
    }
  });

  it("all paths kept: no count suffix; no record: no line", async () => {
    const kept = await panel({ ...RUN, offPlanWrites: { paths: ["README.md"], count: 1 } });
    expect((await cli(["run", "show", "run-1", "--group", "g-alpha"], kept.dir)).stdout.split("\n")).toContain("off-plan writes: README.md");
    const none = await panel(RUN);
    for (const argv of [["run", "show", "run-1", "--group", "g-alpha"], ["task", "show", "g-alpha", "t1"]]) {
      expect((await cli(argv, none.dir)).stdout, argv.join(" ")).not.toContain("off-plan writes");
    }
  });
});
