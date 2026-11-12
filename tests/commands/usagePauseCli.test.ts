// Tester follow-up G spec §2.5 (plan Part B, O5): `orca task decide-usage <group> <task> --decision continue|stop [--note]`
// sends the decision (and the note, as continue-task's operator note) to the task's usage-pause route; a decision that is
// neither is refused before any socket call.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

describe("task decide-usage (spec §2.5)", () => {
  it("continue with a note, and stop without one", async () => {
    const w = await world();
    expect((await cli(["task", "decide-usage", "g-alpha", "t1", "--decision", "continue", "--note", "finish the parser"], w.dir)).code).toBe(0);
    expect((await cli(["task", "decide-usage", "g-alpha", "t1", "--decision", "stop"], w.dir)).code).toBe(0);
    expect(w.posts().map((p) => [p.path, p.payload])).toEqual([
      ["groups/g-alpha/tasks/t1/usage-pause", { decision: "continue", note: { text: "finish the parser", scope: "next-attempt" } }],
      ["groups/g-alpha/tasks/t1/usage-pause", { decision: "stop" }],
    ]);
  });

  it("a decision that is neither is refused before any socket call", async () => {
    const w = await world();
    const out = await cli(["task", "decide-usage", "g-alpha", "t1", "--decision", "maybe", "--json"], w.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "control-cli-argument-invalid"]);
    expect(w.posts()).toEqual([]);
  });
});
