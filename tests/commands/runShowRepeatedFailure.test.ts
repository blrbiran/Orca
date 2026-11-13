// Tester #235 (follow-up K): ccloop stops a run whose failure repeats ("repeated failure pattern detected", outcome
// `exhausted`) while attempts remain. `run show` printed only the raw stop reason, which beside `exhausted` reads as the
// budget or attempts running out. It now says the same failure repeated, so it stopped. Wording only: the ladder is unchanged.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const RUN = { runId: "run-1", taskId: "t1", state: "blocked", phase: "work", outcome: "exhausted", agent: { installation: "claude-main", model: null } };

async function show(stopReason: string): Promise<string> {
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [{ ...RUN, stopReason }] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
  expect(out.code, out.stderr).toBe(0);
  return out.stdout;
}

describe("run show words a repeated-failure stop (#235)", () => {
  it("says the same failure repeated, so it stopped, under the raw reason", async () => {
    const text = await show("repeated failure pattern detected");
    expect(text).toContain("stopReason: repeated failure pattern detected");
    // mutation (no words for the repeated-failure stop) -> red here.
    expect(text).toContain("why: the same failure repeated, so it stopped (not a budget or attempt limit)");
  });
  it("gives another stop reason no such line", async () => {
    expect(await show("attempt budget exhausted")).not.toContain("same failure repeated");
  });
});
