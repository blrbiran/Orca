// Tester #349: `run show` of a run whose Codex session ccloop could not delete says so, with the command that deletes it.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const ID = "01a1e8f9-d197-7e41-83ee-d32888151bda";

async function show(extra: Record<string, unknown>): Promise<string[]> {
  const run = { runId: "run-1", taskId: "t1", state: "landed", ...extra };
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "completed", currentRunId: "run-1" }], runs: [run] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
  expect(out.code).toBe(0);
  return out.stdout.split("\n");
}

describe("run show names a Codex session that could not be deleted (#349)", () => {
  it("prints the session, its state and detail, and the manual command", async () => {
    const lines = await show({ sessionCleanup: [{ threadId: ID, home: "/c/codex-home", state: "retry-failed", detail: "exit 1: Error: failed to delete session" }] });
    // mutation: no sessionCleanupLines in run show -> red
    expect(lines).toContain(`session cleanup: Codex session ${ID} could not be deleted, and the automatic retry failed too (it is not retried again): exit 1: Error: failed to delete session`);
    expect(lines).toContain(`  delete it by hand: CODEX_HOME=/c/codex-home codex delete --force ${ID}`);
  });

  it("prints nothing for a run without one", async () => {
    expect((await show({})).join("\n")).not.toContain("session cleanup:");
  });
});
