// Tester #379 (spec 2026-11-19 resplit-as-new-group §2, §3): `orca requirement resplit <group> --text <why> [--group
// <new>]` sends requirement-resplit with the new group's id (generated as requirement open generates one) and the
// feedback; its receipt names the new group and that the old one is archived; a confirmed group's refusal names the way
// that is left (archive it, open a new requirement).
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

// Ruling (session 3ba26002, 2026-11-19, human 「这次批准改写所有必要的判据」; controller ruling, Rule 11): the flag is `--text`,
// as the sibling `orca requirement feedback` names the same "what was wrong" text; the payload key stays `feedback`, as
// that sibling's payload names it. (Was: `--feedback`.)

const ROUTE = "POST groups/g-alpha/requirement/resplit";
const resplitted = { [ROUTE]: { status: 200, body: { commandId: "c", commandRevision: 6, result: { kind: "requirement-resplit", groupId: "g-alpha", newGroupId: "g-new", draftNo: 4, wakeId: "w" } } } };

describe("orca requirement resplit (#379)", () => {
  it("sends the new group's id and the feedback to the old group's resplit route", async () => {
    const w = await world({}, resplitted);
    const out = await cli(["requirement", "resplit", "g-alpha", "--text", "run the two modules in parallel", "--group", "g-new"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: send the feedback under another key -> red
    expect(w.posts()).toEqual([expect.objectContaining({ path: "groups/g-alpha/requirement/resplit", expectedRevision: 5,
      payload: { newGroupId: "g-new", feedback: "run the two modules in parallel" } })]);
    // mutation: drop the row's format -> the generic receipt, red
    expect(out.stdout).toContain("re-split g-alpha as g-new (draft 4 is being drafted); g-alpha is archived. orca requirement show g-new follows it");
  });

  it("generates the new group's id when --group is not given", async () => {
    const w = await world({}, resplitted);
    const out = await cli(["requirement", "resplit", "g-alpha", "--text", "x"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: send no newGroupId without --group -> red
    expect((w.posts()[0]!.payload as { newGroupId: string }).newGroupId).toMatch(/^g-[0-9a-f]{8}$/);
  });

  it("a confirmed group's refusal says to archive it and open a new requirement", async () => {
    const w = await world({}, { [ROUTE]: { status: 422, body: { error: { code: "proposal-confirmed", message: "proposal-confirmed:resplit:ready", commandRevision: 6, evidenceIds: [], retryable: false } } } });
    const json = await cli(["requirement", "resplit", "g-alpha", "--text", "x", "--json"], w.dir);
    expect(json.code).toBe(2);
    // mutation: drop the row's next -> undefined, red
    expect((json.json().body as { next?: string[] }).next).toEqual(["orca group archive g-alpha", "orca requirement open --idea \"<the requirement, changed>\""]);
    const out = await cli(["requirement", "resplit", "g-alpha", "--text", "x"], w.dir);
    // mutation: drop the row's hint -> the generic line, red
    expect(out.stderr).toContain("orca: g-alpha is confirmed (ready), so it is not re-split: it may start at any time");
  });
});
