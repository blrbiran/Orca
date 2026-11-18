// Tester #379: a draft edit on a group whose split was accepted is refused (requirement-already-accepted, detail
// draft-edits-closed:<n>). The CLI says that draft edits are closed and names the supported way to change the plan before
// confirm -- the accepted draft through the plan library into a new group, then archive this one -- as `next` commands.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const refused = (route: string, message: string, code = "requirement-already-accepted") =>
  ({ [`POST groups/g-alpha/requirement/${route}`]: { status: 422, body: { error: { code, message, commandRevision: 6, evidenceIds: [], retryable: false } } } });
const NEXT = [
  "orca plan save --requirement g-alpha --draft 3",
  "orca plan export <entry> --out <file>",
  "orca plan import <file> --entry <entry> --as-person",
  "orca group import --library <entry>",
  "orca group archive g-alpha",
];

describe("a draft edit refused after accept says what changes the plan instead (#379)", () => {
  it.each([
    ["feedback", ["requirement", "feedback", "g-alpha", "--text", "x"]],
    ["edit", ["requirement", "apply-parallel", "g-alpha"]],
    ["edit", ["requirement", "add-implied-path", "g-alpha", "--task", "t", "--path", "p"]],
    ["edit", ["requirement", "narrow-path", "g-alpha", "--task", "t", "--path", "p", "--to", "p/a"]],
    ["edit", ["requirement", "drop-path", "g-alpha", "--task", "t", "--path", "p"]],
  ])("orca %s: %j", async (route, argv) => {
    const w = await world({}, refused(route, "requirement-already-accepted:draft-edits-closed:3"));
    const out = await cli(argv, w.dir);
    expect(out.code).toBe(2);
    // mutation: drop the hint from the row -> red
    expect(out.stderr).toContain("orca: the split was accepted (draft 3), so draft edits are closed; to change the plan before confirm");
    // mutation: drop the next from the row -> red
    for (const command of NEXT) expect(out.stderr).toContain(`orca: next: ${command}`);
    const json = await cli([...argv, "--json"], w.dir);
    expect((json.json().body as { next?: string[] }).next).toEqual(NEXT);
  });

  it("another refusal of the same rows gets no such hint", async () => {
    const w = await world({}, refused("edit", "group-state-invalid:not-clarifying", "group-state-invalid"));
    const out = await cli(["requirement", "drop-path", "g-alpha", "--task", "t", "--path", "p"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).not.toContain("draft edits are closed");
    expect(out.stderr).not.toContain("plan save");
  });
});
