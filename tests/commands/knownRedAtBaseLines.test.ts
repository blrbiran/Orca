// Pre-existing failures spec 2026-11-18 L4 (#341): an orchestrating agent polls `group brief`; a check Orca already knows
// was red at the group's base must reach it in words -- the spec's line, naming where Orca learned it and when -- and a
// brief without the key prints nothing new.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const SUMMARY = { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 1, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "draft", commandRevision: 7 }] };
const BRIEF = { schema: "orca-group-brief-v1", groupId: "g-alpha", state: "draft", commandRevision: 7 };
const AT = Date.UTC(2026, 10, 17, 23, 30);
const KNOWN = [
  { command: "npm test", base: "b".repeat(40), source: "acceptance", groupId: "g-old", at: AT },
  { command: "npm run lint", base: "b".repeat(40), source: "base-check", groupId: "g-sib", taskId: "t2", at: AT },
];

describe("group brief (#341 L4)", () => {
  it("prints the spec's line for each check known red at the base, and none without the key", async () => {
    const known = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: { ...BRIEF, knownRedAtBase: KNOWN } } });
    const out = await cli(["group", "brief", "g-alpha"], known.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop `...knownRedAtBaseLines(field(body, "knownRedAtBase"))` from the brief's format -> red
    expect(out.stdout.split("\n")).toEqual(expect.arrayContaining([
      "At this group's base, `npm test` was red (group g-old's acceptance, 2026-11-17)",
      "At this group's base, `npm run lint` was red (task t2 of group g-sib, run at the base, 2026-11-17)",
    ]));
    const plain = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: BRIEF } });
    expect((await cli(["group", "brief", "g-alpha"], plain.dir)).stdout).not.toContain("At this group's base");
  });
});
