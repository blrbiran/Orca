// Tester follow-up G Part 5 (§7 anti-goal: no Web-only action): `orca task note` sends add-live-note with the note as its
// only payload, on the task's live-notes route.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

describe("orca task note", () => {
  // mutation: route `.../notes` or payload `{ note }` -> the one POST differs, red
  it("`orca task note g t --text …` posts {text} to groups/g/tasks/t/live-notes", async () => {
    const w = await world();
    const out = await cli(["task", "note", "g-alpha", "t1", "--text", "the fixture lives in test/data", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const posts = w.posts();
    expect(posts).toHaveLength(1);
    expect({ path: posts[0]!.path, expectedRevision: posts[0]!.expectedRevision, payload: posts[0]!.payload })
      .toEqual({ path: "groups/g-alpha/tasks/t1/live-notes", expectedRevision: 5, payload: { text: "the fixture lives in test/data" } });
  });
  it("refuses without --text and sends nothing", async () => {
    const w = await world();
    const out = await cli(["task", "note", "g-alpha", "t1"], w.dir);
    expect(out.code).not.toBe(0);
    expect(w.posts()).toEqual([]);
  });
});
