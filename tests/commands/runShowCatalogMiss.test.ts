// Issue #209: `run show` of a 0-usage rate-limited run whose model the agent's catalog does not list names the catalog
// warning the run view carries, so the operator changes the model instead of reading a quota problem.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const MISS = "model-not-in-catalog: gpt-6-sol (listed: mode-a mode-b)";
const RUN = { runId: "run-1", taskId: "t1", state: "blocked", failureCause: { cause: "rate-limited", phase: "plan", retries: 0, detail: "429" } };

async function show(run: Record<string, unknown>): Promise<string[]> {
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

describe("run show names a rate-limited run's catalog miss (#209)", () => {
  it("prints the warning on its own hint line, after the cause", async () => {
    const lines = await show({ ...RUN, catalogMiss: MISS });
    const hint = lines.findIndex((line) => line.startsWith("hint: this run used no tokens and its model is not in the agent's catalog"));
    expect(hint).toBeGreaterThan(lines.indexOf("failureCause: rate-limited (phase plan)"));
    expect(lines[hint]).toContain(`(${MISS})`);
  });

  it("prints no such line when the view carries none", async () => {
    expect((await show(RUN)).join("\n")).not.toContain("agent's catalog");
  });
});

// Tester follow-up J (#299): a provider 404 on the model is named with the frozen model and the commands that choose
// another; Orca neither retries it nor switches the model.
describe("run show names a model the provider does not serve (#299)", () => {
  it("prints the model, the installation and the commands that choose another", async () => {
    const lines = await show({ ...RUN, agent: { installation: "codex", model: "gpt-6-sol" }, failureCause: { cause: "model-unavailable", phase: "plan", retries: 0, detail: "404" } });
    // mutation M3 (no model-unavailable hint line) -> red here.
    const hint = lines.find((line) => line.startsWith("hint: the provider does not serve model gpt-6-sol for codex"));
    expect(hint).toContain("orca task retry g-alpha t1 --agent <installation>");
    expect(hint).toContain("orca agent set-preferences");
    expect((await show(RUN)).join("\n")).not.toContain("does not serve model");
  });
});
