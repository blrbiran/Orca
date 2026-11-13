// Tester #263 (follow-up I): a run whose execute completed and then stopped on its budget before verification printed only
// `exhausted`, so people re-ran it from scratch although Orca can verify its saved result. `run show` says what happened
// and names the commands that verify it; a plain exhausted run prints nothing new, and --json only gains the view's field.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const KIND = "execution-complete-before-verification-v1";
const RUN = { runId: "run-1", taskId: "t1", state: "settled-failed", outcome: "exhausted", stopReason: "budget exhausted",
  failureCause: { cause: "budget-exhausted", phase: "execute", retries: 0, detail: null } };

async function show(run: Record<string, unknown>, json = false) {
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [run] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha", ...(json ? ["--json"] : [])], p.dir);
  expect(out.code, out.stderr).toBe(0);
  return out;
}

describe("run show of an exhausted run whose execute completed (#263)", () => {
  // mutation M-I2b: executionCompleteLines returns [] -> red
  it("prints that execute completed, verification did not run, the saved source, and the commands that verify it", async () => {
    const lines = (await show({ ...RUN, executionCompleteBeforeVerification: { sourceKind: KIND, attempt: 2 } })).stdout.split("\n");
    expect(lines).toContain(`execution: completed (attempt 2); verification: not run -- the run stopped on its budget after execute (saved source: ${KIND})`);
    expect(lines).toContain("To verify the saved result instead of re-running: orca run eligibility run-1, then orca task verify-saved-result g-alpha t1");
  });

  it("prints nothing new for a plain exhausted run", async () => {
    const out = (await show(RUN)).stdout;
    expect(out).toContain("failureCause: budget-exhausted (phase execute)");
    expect(out).not.toContain("execution: completed");
    expect(out).not.toContain("verify-saved-result");
  });

  it("--json carries the view's run entry as it is: the field when the view has it, nothing added otherwise", async () => {
    const complete = { ...RUN, executionCompleteBeforeVerification: { sourceKind: KIND, attempt: 2 } };
    expect((await show(complete, true)).json().body.run).toEqual(complete);
    expect((await show(RUN, true)).json().body.run).toEqual(RUN);
  });
});
