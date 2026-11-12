// Tester #285: during a codex execute `run show` printed `used.tokens=9544` and an unmoving lastActivityAt for nine
// minutes, and `group brief` a group cost of a few hundred thousand, while the run was producing output and spending
// millions. Orca cannot see live codex usage; the CLI now says what the figure is (the last phase end's, at what time),
// that the transcript is still being written, and, once the run has ended, its usage by kind.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";
import { findCommand } from "../../src/commands/registry.js";

useFakePanels();

const BOOKED = Date.UTC(2026, 10, 12, 2, 43, 0), WRITTEN = Date.UTC(2026, 10, 12, 2, 51, 7);
const UNDER_WAY = { runId: "run-1", taskId: "t1", state: "accepted", phase: "work", endedAt: null, used: { tokens: 9544 }, usageObservation: "phase-end", usageAt: BOOKED };
const ENDED = { ...UNDER_WAY, state: "landed", endedAt: BOOKED + 1, usageBreakdown: { input: 211_395, output: 122_592, cacheRead: 6_563_840, cacheWrite: 0 } };

async function show(run: Record<string, unknown>, transcripts: Record<string, unknown> | null): Promise<{ lines: string[]; json: unknown }> {
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "active", currentRunId: "run-1" }], runs: [run] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    ...(transcripts === null ? {} : { "GET runs/run-1/transcripts": { status: 200, body: { schema: "orca-run-transcripts-v1", runId: "run-1", available: true, calls: [], ...transcripts } } }),
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
  expect(out.code, out.stderr).toBe(0);
  const json = await cli(["run", "show", "run-1", "--group", "g-alpha", "--json"], p.dir);
  return { lines: out.stdout.split("\n"), json: json.json().body };
}

describe("run show of a run whose agent reports usage at phase end (#285)", () => {
  it("says the used figure is the last phase end's, and that the transcript is still being written", async () => {
    const { lines, json } = await show(UNDER_WAY, { lastTranscriptAt: WRITTEN });
    // mutation: drop runUsageLines from run show -> red
    expect(lines).toContain("used: 9,544 tokens (as of the last phase end at 02:43Z; this agent reports usage only when a phase ends)");
    // mutation: drop the transcripts read from run show's compose -> red
    expect(lines).toContain("transcript: producing output, last at 02:51:07Z");
    expect(json).toMatchObject({ lastTranscriptAt: WRITTEN });
  });

  it("before any phase ended, says so; a listing that cannot be read adds nothing and fails nothing", async () => {
    const { lines, json } = await show({ ...UNDER_WAY, usageAt: undefined }, null);
    expect(lines).toContain("used: 9,544 tokens (no phase has ended yet; this agent reports usage only when a phase ends)");
    expect(lines.some((line) => line.startsWith("transcript:"))).toBe(false);
    expect(json).not.toHaveProperty("lastTranscriptAt");
  });

  it("an agent that observes usage live gets no such line", async () => {
    // mutation: runUsageLines ignores usageObservation -> red
    expect((await show({ ...UNDER_WAY, usageObservation: "realtime" }, null)).lines.join("\n")).not.toContain("phase end");
  });

  it("an ended run shows its usage by kind and no producing line", async () => {
    const { lines } = await show(ENDED, { lastTranscriptAt: WRITTEN });
    // mutation: drop the by-kind line -> red
    expect(lines).toContain("usage by kind: input 211,395 / output 122,592 / cacheRead 6,563,840");
    expect(lines.join("\n")).not.toContain("producing output");
    expect(lines.join("\n")).not.toContain("as of the last phase end");
    const { lines: written } = await show({ ...ENDED, usageBreakdown: { ...ENDED.usageBreakdown, cacheWrite: 12 } }, null);
    expect(written).toContain("usage by kind: input 211,395 / output 122,592 / cacheRead 6,563,840 / cacheWrite 12");
  });
});

describe("group brief and group show say the group's used figure lags (#285)", () => {
  const def = (argv: string[]) => { const found = findCommand(argv); if (!("def" in found)) throw new Error(argv.join(" ")); return found.def; };
  const LINE = "budget: used is as of the last phase end at 02:43Z for 1 run under way (run-1); this agent reports usage only when a phase ends";

  it("group brief prints the brief's phaseEndUsage as a sentence", () => {
    // mutation: drop the brief row's format -> red
    expect(def(["group", "brief"]).format({ schema: "orca-group-brief-v1", groupId: "g-alpha", phaseEndUsage: { runIds: ["run-1"], asOf: BOOKED } }).split("\n")).toContain(LINE);
    expect(def(["group", "brief"]).format({ schema: "orca-group-brief-v1", groupId: "g-alpha" })).not.toContain("phase end");
  });

  it("group show derives it from the runs under way", () => {
    const view = (runs: unknown[]) => ({ schema: "orca-control-group-v1", summary: { groupId: "g-alpha" }, workItems: [], runs });
    // mutation: drop phaseEndBudgetLines from formatWithUnestimated -> red
    expect(def(["group", "show"]).format(view([UNDER_WAY])).split("\n")).toContain(LINE);
    expect(def(["group", "show"]).format(view([ENDED]))).not.toContain("as of the last phase end");
  });
});
