// Worker-lost recovery spec 2026-11-12 §5.6 (#273): `orca run show` and `orca group show` say in words that a run lost its
// worker (the machine restarted or the process was killed) and what happens next, and name the command that checks an
// undetermined worker again.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const LOST = { runId: "run-1", taskId: "t1", state: "blocked", outcome: "failed", stopReason: "worker-lost: owner pid 123 does not exist",
  failureCause: { cause: "worker-lost", phase: "execute", retries: 0, detail: "owner pid 123 does not exist" } };
const UNDETERMINED = { runId: "run-2", taskId: "t2", state: "blocked", outcome: null, blockedReason: "worker-undetermined:owner start time unreadable" };
const GROUP = { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
  workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }, { taskId: "t2", status: "blocked", currentRunId: "run-2" }], runs: [LOST, UNDETERMINED] };
const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };
const panel = () => fakePanel({
  "GET summary": SUMMARY, "GET groups/g-alpha": { status: 200, body: GROUP },
  "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
  "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  "GET runs/run-2/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-2", entries: [] } },
  "GET runs/run-2/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-2", entries: [] } },
});

describe("a run that lost its worker, in words (#273)", () => {
  it("run show says worker lost and that Orca starts the task again", async () => {
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], (await panel()).dir);
    expect(out.code).toBe(0);
    // mutation: workerLostLines left out of run show -> red
    expect(out.stdout.split("\n")).toContain("task t1: worker lost (the machine restarted or the process was killed): run run-1");
  });

  it("run show of an undetermined worker names the command that checks again", async () => {
    const out = await cli(["run", "show", "run-2", "--group", "g-alpha"], (await panel()).dir);
    expect(out.stdout.split("\n")).toContain("  make sure no worker process of the run is left, then check again: orca recovery retry --run run-2");
  });

  it("group show says both for the tasks' current runs", async () => {
    const out = await cli(["group", "show", "g-alpha"], (await panel()).dir);
    expect(out.code).toBe(0);
    // mutation: workerLostLines left out of group show -> red
    expect(out.stdout).toContain("task t1: worker lost (the machine restarted or the process was killed): run run-1");
    expect(out.stdout).toContain("task t2: ccloop cannot tell whether run run-2's worker is alive");
  });
});
