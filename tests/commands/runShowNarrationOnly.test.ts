// Tester #347: `run show` of a run ccloop stopped as `narration-only` says in words that the agent stopped after a short
// message without doing the task (not that a finished answer was badly formatted), and that a later run is told so.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const DETAIL = "the call ended after a 98-byte final message that is not an execute answer; no tool, command or file change was observed";

async function show(cause: string): Promise<string[]> {
  const run = { runId: "run-1", taskId: "t1", state: "blocked", stopReason: "ExecutionFormatFailure: SyntaxError: Unexpected token 'I'",
    failureCause: { cause, phase: "execute", retries: 0, detail: DETAIL } };
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [run] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
  expect(out.code).toBe(0);
  return out.stdout.split("\n");
}

describe("run show names a narration-only run (#347)", () => {
  it("prints the cause, its detail and a hint line after them", async () => {
    const lines = await show("narration-only");
    const cause = lines.indexOf("failureCause: narration-only (phase execute)");
    expect(cause).toBeGreaterThan(-1);
    expect(lines).toContain(`detail: ${DETAIL}`);
    // mutation N3 (no narration-only hint line) -> -1, red here.
    const hint = lines.findIndex((line) => line.startsWith("hint: the agent ended its turn after a short message without doing the task"));
    expect(hint).toBeGreaterThan(cause);
    expect(lines[hint]).toContain("A later run of this task is told so");
  });

  it("prints no such hint for the sibling causes", async () => {
    for (const cause of ["execution-not-json", "execution-shape"]) {
      const lines = await show(cause);
      expect(lines).toContain(`failureCause: ${cause} (phase execute)`);
      expect(lines.join("\n")).not.toContain("without doing the task");
    }
  });
});
