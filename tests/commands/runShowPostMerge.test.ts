// Tester follow-up E §4 (#245): `orca run show` says in one line what the landing's post-merge check did -- passed with
// its command count and time, not needed and why, or failed with the command and its output tail -- so a person can tell a
// re-checked merge from one that needed no check without reading the drive record.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const SHA = (c: string) => c.repeat(40);
const RUN = { runId: "run-1", taskId: "t1", state: "landed", grant: { work: { tokens: null, activeMs: null, attempts: 3, sessions: 3 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } } };
const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };

async function show(postMergeCheck: unknown): Promise<string[]> {
  const run = { ...RUN, ...(postMergeCheck === undefined ? {} : { postMergeCheck }) };
  const p = await fakePanel({
    "GET summary": SUMMARY,
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 }, workItems: [{ taskId: "t1", status: "done", currentRunId: "run-1" }], runs: [run] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
  expect(out.code).toBe(0);
  return out.stdout.split("\n");
}

const BASE = { attemptSha: SHA("a"), mergedSha: SHA("b"), oldTip: SHA("c") };

describe("run show names the post-merge check (tester follow-up E §4)", () => {
  it("a passed check: its command count and total time", async () => {
    const lines = await show({ ...BASE, result: "passed", commands: [{ command: "npm ci", exit: "0", ms: 30_400 }, { command: "npm test", exit: "0", ms: 10_700 }] });
    expect(lines).toContain("post-merge check: passed (2 commands, 41 s)");
  });

  it("a check that was not needed: why", async () => {
    const lines = await show({ ...BASE, result: "not-needed", why: "fast-forward", commands: [] });
    expect(lines).toContain("post-merge check: not needed (fast-forward)");
  });

  it("a failed check: the command, its exit, then its output tail on indented lines", async () => {
    const lines = await show({ ...BASE, result: "failed", commands: [{ command: "setup: npm ci", exit: "0", ms: 2_000 }, { command: "npm test", exit: "1", ms: 1_000 }], tail: "FAIL a.test.ts\n2 failed" });
    const at = lines.indexOf("post-merge check: failed: npm test exited 1 (2 commands, 3 s)");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 3)).toEqual(["  FAIL a.test.ts", "  2 failed"]);
  });

  it("a run with no record prints no post-merge line", async () => {
    expect((await show(undefined)).some((line) => line.startsWith("post-merge check"))).toBe(false);
  });
});
