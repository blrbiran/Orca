import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const cleaned = {
  status: 200,
  body: {
    schema: "orca-command-success-v1", commandId: "cli-1", actorId: "human", verb: "archive-group",
    target: { kind: "group", groupId: "g-alpha" }, commandRevision: 6, projectionSeq: 1, effectivePayloadHash: "h", authorityCommandHash: "a",
    result: { kind: "archived", groupId: "g-alpha", at: 7, derived: { parentTerminal: true,
      archived: ["sysdebug-criteria-review-a", "sysdebug-criteria-review-b"], paused: ["sysdebug-criteria-review-c"] } },
  },
};

// Issue #419 (lifecycle): the one-shot cleanup entry on the existing archive verb.
describe("group archive --derived-of (issue #419)", () => {
  it("takes the parent from the flag, not the positional, and sends archive-group with derived: true at its revision", async () => {
    const w = await world({}, { "POST groups/g-alpha/archive": cleaned });
    const out = await cli(["group", "archive", "--derived-of", "g-alpha", "--json"], w.dir);
    expect(out.code).toBe(0);
    expect(w.posts()).toHaveLength(1);
    expect(w.posts()[0]).toEqual(expect.objectContaining({ path: "groups/g-alpha/archive", expectedRevision: 5, payload: { derived: true } }));
  });

  it("keeps a plain archive's payload empty", async () => {
    const w = await world({}, { "POST groups/g-alpha/archive": { status: 200, body: { ...cleaned.body, result: { kind: "archived", groupId: "g-alpha", at: 7 } } } });
    expect((await cli(["group", "archive", "g-alpha", "--json"], w.dir)).code).toBe(0);
    expect(w.posts()[0]).toEqual(expect.objectContaining({ path: "groups/g-alpha/archive", payload: {} }));
  });

  it("prints what it changed, and that an accepted run settles first", async () => {
    const w = await world({}, { "POST groups/g-alpha/archive": cleaned });
    const out = await cli(["group", "archive", "--derived-of", "g-alpha"], w.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("g-alpha: archived 2 criteria-review group(s); paused 1 whose run is still active");
    expect(out.stdout).toContain("archived sysdebug-criteria-review-a");
    expect(out.stdout).toContain("paused sysdebug-criteria-review-c: no new work is claimed");
  });

  it("refuses the parent twice (positional and flag)", async () => {
    const w = await world({}, { "POST groups/g-alpha/archive": cleaned });
    const out = await cli(["group", "archive", "g-alpha", "--derived-of", "g-alpha"], w.dir);
    expect(out.code).toBe(1);
    expect(w.posts()).toHaveLength(0);
  });
});