// Tester follow-up G Part 4.7 (§7 anti-goal: no Web-only action): `orca task handoff` lists a task's handoff versions from
// the group view, and with --run prints that run's summary, then its handoff, from the read route.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const STORED = { state: "stored", reason: null, bytes: 5 };
const RECORD = (taskId: string, runId: string, over: Record<string, unknown> = {}) => ({
  taskId, runId, outcome: "succeeded", handoff: STORED, summary: STORED, summaryText: `did ${taskId}\nand more\n`, recordedAt: 1, notesMerged: 0, ...over,
});

describe("orca task handoff", () => {
  // mutation: drop the taskId filter -> t2's run is listed under t1, red
  it("`orca task handoff g t1` lists that task's versions with their summary", async () => {
    const w = await world();
    w.state.view = { ...w.state.view, handoffs: [RECORD("t1", "run-0", { outcome: "failed", handoff: { state: "invalid", reason: "too-large", bytes: 9000 } }), RECORD("t1", "run-1"), RECORD("t2", "run-9")] } as typeof w.state.view;
    const out = await cli(["task", "handoff", "g-alpha", "t1"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe([
      "run run-0 (failed): handoff invalid (too-large), summary stored", "  did t1", "  and more",
      "run run-1 (succeeded): handoff stored, summary stored", "  did t1", "  and more",
    ].join("\n"));
    const json = await cli(["task", "handoff", "g-alpha", "t1", "--json"], w.dir);
    expect(json.json().body.handoffs.map((entry: { runId: string }) => entry.runId)).toEqual(["run-0", "run-1"]);
  });

  // mutation: swap the path's task and run -> the route is not found, red
  it("`--run run-1` prints summary then handoff from groups/g/handoffs/t/run", async () => {
    const w = await world({}, { "GET groups/g-alpha/handoffs/t1/run-1": { status: 200, body: { schema: "orca-task-handoff-v1", groupId: "g-alpha", taskId: "t1", runId: "run-1", record: RECORD("t1", "run-1"), handoff: "# H\nlearned X\n", summary: "did t1\n" } } });
    const out = await cli(["task", "handoff", "g-alpha", "t1", "--run", "run-1"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe("summary:\ndid t1\n\n\nhandoff:\n# H\nlearned X");
  });
});

// Tester #309 (follow-up J): the CLI says a summary was truncated and still prints what was kept.
describe("orca task handoff names a truncated summary (#309)", () => {
  it("prints `summary truncated (too-many-lines)` and the kept lines", async () => {
    const w = await world();
    w.state.view = { ...w.state.view, handoffs: [RECORD("t1", "run-1", { summary: { state: "truncated", reason: "too-many-lines", bytes: 793 }, summaryText: "l0\n… (truncated)\n" })] } as typeof w.state.view;
    const out = await cli(["task", "handoff", "g-alpha", "t1"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe(["run run-1 (succeeded): handoff stored, summary truncated (too-many-lines)", "  l0", "  … (truncated)"].join("\n"));
  });
});
