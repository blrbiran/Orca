import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

describe("orca group cap", () => {
  it("sends a revision-bound lower-only proposal edit with the other dimensions unchanged", async () => {
    const w = await world();
    const result = await cli(["group", "cap", "g-alpha", "--tokens", "900", "--json"], w.dir);
    expect(result.code).toBe(0);
    expect(w.posts()).toHaveLength(1);
    expect(w.posts()[0]).toMatchObject({ path: "groups/g-alpha/proposal/edit", expectedRevision: 5,
      payload: { baseProposalVersion: 3, capOnly: true, operations: [], proposedGroupLimit: { tokens: 900, activeMs: 10, attempts: 2, sessions: 2 } } });
  });

  it("refuses a non-finite or greater ceiling before sending a write", async () => {
    const w = await world();
    for (const value of ["none", "1001", "-1", "1.5"]) {
      const result = await cli(["group", "cap", "g-alpha", "--tokens", value, "--json"], w.dir);
      expect(result.code, value).toBe(1);
    }
    expect(w.posts()).toEqual([]);
  });
});
