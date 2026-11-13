// Tester #290 / #297 (follow-up J): `run show` prints the live ceiling's tokens and cause, the stop ccloop reported at it,
// and, for a codex run, a note that codex is stopped only between turns and so can go past it (human: 「codex 提示就好」 --
// a note, never a block).
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const CEILING = { revision: 1, tokens: 10_000_000, cause: "pause-line", deliveredRevision: 1 };
const STOP = { revision: 1, tokens: 10_000_000, cause: "pause-line", observedTokens: 62_998_085, phase: "execute", at: "boundary" };
const RUN = { runId: "run-1", taskId: "t1", state: "blocked", agent: { installation: "codex-main", model: "gpt-6-sol" } };

async function show(run: Record<string, unknown>, kind: string | null): Promise<string> {
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [run] } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    ...(kind === null ? {} : { "GET agents": { status: 200, body: { schema: "orca-agents-view-v1", installations: [{ id: "codex-main", kind }] } } }),
  });
  const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
  expect(out.code, out.stderr).toBe(0);
  return out.stdout;
}

describe("run show names the live ceiling (#290, #297)", () => {
  it("prints the ceiling and the stop, and for codex the between-turns note", async () => {
    const text = await show({ ...RUN, liveCeiling: CEILING, liveCeilingStop: STOP }, "codex");
    // mutation (no liveCeilingLines in run show) -> red here.
    expect(text).toContain("live ceiling: 10,000,000 tokens (pause-line, revision 1)");
    expect(text).toContain("stopped at the live ceiling: 62,998,085 tokens used against 10,000,000 (pause-line, execute, boundary)");
    // mutation (no codex note) -> red here.
    expect(text).toContain("note: codex is stopped only between turns");
  });
  it("prints no codex note for another agent, nor when the agents read fails; nothing for a run without a ceiling", async () => {
    expect(await show({ ...RUN, liveCeiling: CEILING }, "claude")).not.toContain("codex is stopped");
    const unread = await show({ ...RUN, liveCeiling: CEILING }, null);
    expect(unread).toContain("live ceiling: 10,000,000 tokens");
    expect(unread).not.toContain("codex is stopped");
    expect(await show(RUN, "codex")).not.toContain("live ceiling");
  });
});
