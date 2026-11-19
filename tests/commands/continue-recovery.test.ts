// Tester #386 (a): `task continue` of a run that ended `exhausted` (which holds no handoff checkpoint) stopped at
// `checkpoint-not-found` with no way on. The refusal now names the next commands: the group's limit a further attempt
// needs (all four fields, filled from the group's current limit) and the task's retry. Neither is sent.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

type Run = { outcome?: string | null; used?: { tokens: number } };
async function exhaustedNoCheckpoint(limit: { tokens: number | null } = { tokens: 1000 }) {
  const w = await world({ checkpointId: null });
  Object.assign(w.state.view.runs[0] as Run, { outcome: "exhausted", used: { tokens: 700 } });
  w.state.view.ledger.groupLimit = { tokens: limit.tokens, activeMs: 10, attempts: 2, sessions: 2 } as typeof w.state.view.ledger.groupLimit;
  return w;
}
async function refused(w: Awaited<ReturnType<typeof exhaustedNoCheckpoint>>) {
  const json = await cli(["task", "continue", "g-alpha", "t1", "--json"], w.dir);
  expect(json.code).toBe(1);
  const human = await cli(["task", "continue", "g-alpha", "t1"], w.dir);
  expect(human.code).toBe(1);
  const body = json.json().body as { error: { code: string; message: string }; next?: string[] };
  expect(body.error.code).toBe("checkpoint-not-found");
  expect(body.error.message).toContain("run-1");
  const lines = human.stderr.split("\n").filter((line) => line.startsWith("orca: next: ")).map((line) => line.slice("orca: next: ".length));
  expect(lines).toEqual(body.next ?? []);
  return body.next ?? null;
}

describe("task continue on an exhausted run with no checkpoint (#386)", () => {
  it("names the set-limit with the four fields from the group's current limit, and the retry; sends nothing", async () => {
    const w = await exhaustedNoCheckpoint();
    const next = await refused(w);
    // mutation: fall back to another run's checkpoint -> a POST, red; drop the merge of the other dimensions -> red.
    expect(next).toEqual([
      "orca group set-limit g-alpha --limit '{\"tokens\":1700,\"activeMs\":10,\"attempts\":2,\"sessions\":2}'",
      "orca task retry g-alpha t1",
    ]);
    expect(w.posts()).toEqual([]);
  });

  it("a group with no token limit needs no limit command: the retry is the next step", async () => {
    const w = await exhaustedNoCheckpoint({ tokens: null });
    // mutation: always print the set-limit -> the null token count would appear, red.
    expect(await refused(w)).toEqual(["orca task retry g-alpha t1"]);
    expect(w.posts()).toEqual([]);
  });

  it("a run that did not end exhausted keeps the old refusal with no next step", async () => {
    const w = await exhaustedNoCheckpoint();
    Object.assign(w.state.view.runs[0] as Run, { outcome: "succeeded" });
    expect(await refused(w)).toBe(null);
    expect(w.posts()).toEqual([]);
  });
});
