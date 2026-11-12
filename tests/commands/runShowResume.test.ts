// Tester #267: `orca run show` of a work run blocked before ccloop stated an outcome names the command that resumes it
// where it stopped; a run ccloop ended failed (task retry's) and a run that is not blocked do not get that line.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };

async function show(run: Record<string, unknown>): Promise<string[]> {
  const full = { runId: "run-1", taskId: "t1", phase: "work", grant: { work: { tokens: null, activeMs: null, attempts: 3, sessions: 3 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, ...run };
  const p = await fakePanel({
    "GET summary": SUMMARY,
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 }, workItems: [{ taskId: "t1", status: "running", currentRunId: "run-1" }], runs: [full] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
  expect(out.code).toBe(0);
  return out.stdout.split("\n");
}

const LINE = "To resume it where it stopped: orca recovery retry --run run-1";

describe("run show names recovery retry --run for a run blocked with no outcome (#267)", () => {
  it("blocked, no outcome: the line", async () => {
    expect(await show({ state: "blocked", outcome: null, blockedReason: "control-peer-timeout" })).toContain(LINE);
  });
  it("blocked by a ccloop failure, or not blocked: no line", async () => {
    expect(await show({ state: "blocked", outcome: "failed", blockedReason: "terminal:failed" })).not.toContain(LINE);
    expect(await show({ state: "running", outcome: null })).not.toContain(LINE);
  });
});
