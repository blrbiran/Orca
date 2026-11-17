import { describe, expect, it } from "vitest";
import { cli, fakePanel } from "./fixtures/fakePanel.js";

/**
 * Tester #348 review (minor): the views name a run the read schema cannot decode (`unreadableRuns`) and a quota probe's
 * verdict (`probeVerdict`), but the CLI's generic text squeezed both into a 160-char compact line that cut them off. Each
 * now gets a whole line: `task show` and `group brief` one per unreadable run, `run show` a `verdict:` line for a probe.
 */
const PROBE = "run-probe-1", BAD = "run-bad-1", REASON = "run-invalid:run-bad-1:Unrecognized key(s) in object: 'futureKey'";
const SUMMARY = { groupId: "g", repoId: "repo-1", state: "running", commandRevision: 7 };
const VIEW = {
  schema: "orca-control-group-v1", summary: SUMMARY,
  workItems: [
    { taskId: "a", status: "blocked", currentRunId: BAD, lineageRunIds: [BAD], unreadableRuns: [{ runId: BAD, reason: REASON }] },
    { taskId: "b", status: "ready", currentRunId: null, lineageRunIds: [] },
  ],
  runs: [{ runId: PROBE, taskId: null, estimateId: null, state: "settled-restartable", phase: "single-call", purpose: "quota-probe",
    probeVerdict: { verdict: "quota", cause: "quota", detail: "You've hit your usage limit", errorCode: "codex-exit-error" } }],
  unreadableRuns: [{ runId: BAD, workItemId: "a", taskId: "a", reason: REASON }],
};
const routes = {
  "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 1, resetRequired: false, groups: [SUMMARY] } },
  "GET groups/g": { status: 200, body: VIEW },
  "GET groups/g/brief": { status: 200, body: { schema: "orca-group-brief-v1", ...SUMMARY, unreadableRuns: VIEW.unreadableRuns } },
  [`GET runs/${PROBE}/activity`]: { status: 200, body: { entries: [] } },
  [`GET runs/${PROBE}/evidence`]: { status: 200, body: { entries: [] } },
};
const lineOf = `run ${BAD} (task a) is unreadable: ${REASON}`;

describe("CLI lines for unreadable runs and a probe's verdict (#348 review)", () => {
  it("task show names the task's unreadable run on a whole line; another task's show does not", async () => {
    const p = await fakePanel(routes);
    const a = await cli(["task", "show", "g", "a"], p.dir);
    expect(a.code, a.stderr).toBe(0);
    // mutation: drop the unreadable lines from task show's format -> no such line, red
    expect(a.stdout.split("\n")).toContain(`run ${BAD} is unreadable: ${REASON}`);
    const b = await cli(["task", "show", "g", "b"], p.dir);
    expect(b.code, b.stderr).toBe(0);
    expect(b.stdout).not.toContain("is unreadable");
  });

  it("group brief names each unreadable run with its task on a whole line", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["group", "brief", "g"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the unreadable lines from group brief's format -> no such line, red
    expect(out.stdout.split("\n")).toContain(lineOf);
  });

  it("run show of a probe run says its purpose and verdict on whole lines", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["run", "show", PROBE, "--group", "g"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the verdict line from run show's format -> no such line, red
    expect(out.stdout.split("\n")).toContain("verdict: quota (quota-probe), cause quota, error codex-exit-error, detail: You've hit your usage limit");
  });
});
