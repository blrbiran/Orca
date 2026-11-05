// Session 3cfc2e73, issue #132: a requirement write the CLI cannot pin on an archived group answers group-archived.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { H, world } from "./fixtures/world.js";

useFakePanels();

describe("requirement writes on an archived group (#132)", () => {
  const view = (archived: boolean, requirement: { roundNo: number | null; draftNo: number | null }, drafts: unknown[] = []) => ({
    "GET groups/g-alpha/requirement": { status: 200, body: { schema: "orca-requirement-view-v1", summary: { groupId: "g-alpha", commandRevision: 5, archived, requirement }, rounds: [], drafts } },
  });

  it("feedback, accept and answer answer group-archived (not requirement-no-draft/no-round) and send nothing", async () => {
    const w = await world({}, view(true, { roundNo: null, draftNo: null }));
    for (const argv of [["requirement", "feedback", "g-alpha", "--text", "t"], ["requirement", "accept", "g-alpha"], ["requirement", "answer", "g-alpha", "--answer", "q1"]]) {
      const out = await cli([...argv, "--json"], w.dir);
      expect([out.code, out.json().body.error.code], argv.join(" ")).toEqual([1, "group-archived"]);
    }
    expect(w.posts()).toEqual([]);
  });

  it("accept on an archived group whose draft has no output yet answers group-archived", async () => {
    const w = await world({}, view(true, { roundNo: 1, draftNo: 1 }, [{ draftNo: 1, state: "drafting", draftHash: null }]));
    const out = await cli(["requirement", "accept", "g-alpha", "--json"], w.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "group-archived"]);
  });

  it("the same reads on a group that is not archived still answer requirement-no-draft", async () => {
    const w = await world({}, view(false, { roundNo: null, draftNo: null }));
    const out = await cli(["requirement", "accept", "g-alpha", "--json"], w.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "requirement-no-draft"]);
  });

  it("with a draft present the CLI still sends, so the panel's own archive gate answers", async () => {
    const w = await world({}, view(true, { roundNo: 1, draftNo: 1 }, [{ draftNo: 1, state: "awaiting-review", draftHash: H.draft }]));
    await cli(["requirement", "accept", "g-alpha", "--json"], w.dir);
    expect(w.posts().map((post) => post.path)).toEqual(["groups/g-alpha/requirement/accept"]);
  });
});
