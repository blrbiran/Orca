// Session 3cfc2e73, issue #140: the human formatter printed `key: undefined` and hid why a run failed inside one
// 160-character line. The shortening itself stays (orca-control skill Rule 7); absent fields are left out and run show
// gives the failure cause its own whole lines.
import { describe, expect, it } from "vitest";
import { text } from "../../src/commands/domains/format.js";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const DETAIL = `codex-result-invalid: /runs/run-1/attempt-1/execute-result.json ${"x".repeat(240)} END`;
const RUN = {
  runId: "run-1", taskId: "t1", state: "settled-failed", stopReason: "Error: codex-result-invalid",
  failureCause: { cause: "codex-result-invalid", phase: "execute", retries: 2, detail: DETAIL },
  grant: { work: { tokens: 1_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 }, handoff: { tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 } },
};
const GROUP = {
  schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
  workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [RUN],
};
const ENTRY = "pl-0123456789abcdef";
const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };

describe("human output (#140)", () => {
  it("text() leaves out an undefined field and keeps null ones", () => {
    expect(text({ a: 1, gone: undefined, empty: null })).toBe("a: 1\nempty: null");
  });

  it("run show prints state, stopReason, the failure cause with its phase, and the whole detail on their own lines", async () => {
    const p = await fakePanel({
      "GET summary": SUMMARY,
      "GET groups/g-alpha": { status: 200, body: GROUP },
      "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
      "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    });
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
    expect(out.code).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines).toContain("state: settled-failed");
    expect(lines).toContain("stopReason: Error: codex-result-invalid");
    expect(lines).toContain("failureCause: codex-result-invalid (phase execute), 2 retries");
    expect(lines).toContain(`detail: ${DETAIL}`);
    // The one-line run summary keeps its deliberate shortening.
    expect(lines.find((line) => line.startsWith("run "))!.endsWith("…")).toBe(true);
  });

  it("run show of a run with no failure cause prints no failureCause or detail line", async () => {
    const { failureCause: _gone, stopReason: _none, ...plain } = RUN;
    const p = await fakePanel({
      "GET summary": SUMMARY,
      "GET groups/g-alpha": { status: 200, body: { ...GROUP, runs: [{ ...plain, state: "running" }] } },
      "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
      "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    });
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
    expect(out.stdout).toContain("state: running");
    expect(out.stdout).not.toMatch(/failureCause|detail:|stopReason|undefined/);
  });

  it("plan show without --version prints no `document: undefined`", async () => {
    const p = await fakePanel({ [`GET plan-library/${ENTRY}`]: { status: 200, body: { entryId: ENTRY, projectId: "repo-1", head: null, versions: [] } } });
    const out = await cli(["plan", "show", ENTRY], p.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(`entryId: ${ENTRY}`);
    expect(out.stdout).not.toContain("undefined");
  });
});
