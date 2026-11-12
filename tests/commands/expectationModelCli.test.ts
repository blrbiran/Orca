// Tester follow-up G spec §10.3 (plan Part B, O1): the CLI's hard switch. `--hard` sends `hard: true` beside a task's work
// tokens; without it the operation carries no `hard` key at all (an older panel's payload hash is unchanged).
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

describe("proposal set-budget --hard (spec §10.3)", () => {
  it("--hard sends hard: true; without it no hard key is sent", async () => {
    const w = await world();
    await cli(["proposal", "set-budget", "g-alpha", "--task", "t1", "--allocation", "work", "--dimension", "tokens", "--value", "400000", "--hard"], w.dir);
    await cli(["proposal", "set-budget", "g-alpha", "--task", "t1", "--allocation", "work", "--dimension", "tokens", "--value", "400000"], w.dir);
    expect(w.posts().map((p) => (p.payload as { operations: unknown[] }).operations[0])).toEqual([
      { target: { scope: "task", taskId: "t1", allocation: "work", dimension: "tokens" }, value: 400000, provenance: "human", hard: true },
      { target: { scope: "task", taskId: "t1", allocation: "work", dimension: "tokens" }, value: 400000, provenance: "human" },
    ]);
  });
});
