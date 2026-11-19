// Tester #384: apply-parallel names the pairs it drops (`--pair before:after`, repeatable) or the whole list on purpose
// (`--all`). Naming none sends no selection, so the panel drops nothing and refuses with a hint; the old command dropped
// every candidate at once, which turned a live policy draft's semantic edges into layer 0.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { H, world } from "./fixtures/world.js";

useFakePanels();
const edit = (argv: string[], w: Awaited<ReturnType<typeof world>>) => cli([...argv, "--json"], w.dir);

describe("orca requirement apply-parallel selects the pairs it drops (#384)", () => {
  it("--pair before:after is repeatable and is sent as pairs, with the draft's pins", async () => {
    const w = await world();
    expect((await edit(["requirement", "apply-parallel", "g-alpha", "--pair", "T3:T4a", "--pair", "T5:T6"], w)).code).toBe(0);
    expect(w.posts()).toHaveLength(1);
    expect(w.posts()[0]!.payload).toEqual({ draftNo: 1, draftHash: H.draft,
      edit: { kind: "apply-parallel-candidates", pairs: [{ before: "T3", after: "T4a" }, { before: "T5", after: "T6" }] } });
  });

  it("--all asks for every candidate, on purpose", async () => {
    const w = await world();
    expect((await edit(["requirement", "apply-parallel", "g-alpha", "--all"], w)).code).toBe(0);
    expect(w.posts()[0]!.payload).toEqual({ draftNo: 1, draftHash: H.draft, edit: { kind: "apply-parallel-candidates", all: true } });
  });

  it("naming nothing sends no selection -- the panel drops nothing and the hint says how to select", async () => {
    const w = await world();
    expect((await edit(["requirement", "apply-parallel", "g-alpha"], w)).code).toBe(0);
    // mutation: default to the whole list -> pairs/all present here, red
    expect(w.posts()[0]!.payload).toEqual({ draftNo: 1, draftHash: H.draft, edit: { kind: "apply-parallel-candidates" } });
  });

  it("refuses --all with --pair, and a --pair that is not before:after, before sending anything", async () => {
    for (const argv of [["requirement", "apply-parallel", "g-alpha", "--all", "--pair", "T3:T4a"],
      ["requirement", "apply-parallel", "g-alpha", "--pair", "T3"], ["requirement", "apply-parallel", "g-alpha", "--pair", ":T4a"]]) {
      const w = await world();
      const out = await edit(argv, w);
      // mutation: parse a pair without validating both sides -> a POST is made, red
      expect([out.code, w.posts().length]).toEqual([1, 0]);
      expect(out.json().body).toMatchObject({ error: { code: "control-cli-argument-invalid" } });
    }
  });
});
