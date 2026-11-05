// Review-exit spec 2026-11-05 §3.4 (D4): `orca group start` (and `resume` of a group never started) answered
// `queued-for-slot` prints one line naming how many go first; any other answer prints as before.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const answer = (result: unknown) => ({ status: 202, body: { schema: "orca-command-success-v1", commandId: "c", actorId: "human", verb: "start", target: { kind: "group", groupId: "g-alpha" }, commandRevision: 6, projectionSeq: 6, effectivePayloadHash: "h", authorityCommandHash: "h", result } });

describe("a start queued at the cap (review-exit spec §3.4)", () => {
  it("group start and group resume print the queued line", async () => {
    for (const [action, route, operation] of [["start", "start", "start"], ["resume", "resume-dispatch", "resume-dispatch"]] as const) {
      const w = await world({}, { [`POST groups/g-alpha/${route}`]: answer({ kind: "queued-for-slot", operation, ahead: 2 }) });
      const out = await cli(["group", action, "g-alpha"], w.dir);
      expect(out.code, action).toBe(0);
      // mutation: drop the queued branch of the formatter -> the generic key/value text, red
      expect(out.stdout, action).toBe("queued: 2 ahead; it starts when a slot frees (orca orchestration show)\n");
    }
  });

  it("a scheduled start prints as before", async () => {
    const w = await world({}, { "POST groups/g-alpha/start": answer({ kind: "scheduled", operation: "start", wakeId: "w-1" }) });
    const out = await cli(["group", "start", "g-alpha"], w.dir);
    expect(out.stdout).not.toContain("queued:");
    expect(out.stdout).toContain("w-1");
  });
});
