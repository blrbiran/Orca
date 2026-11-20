// Tester #402: an unanswered pre-existing failure left a 5/5 group silently at `review` -- `group brief` showed no
// waiting item, and the answer command demanded the report's whole sentence. The brief now prints one line per
// unanswered row with the copyable answer command; a brief without the key prints nothing new.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const SUMMARY = { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 1, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "review", commandRevision: 7 }] };
const BRIEF = { schema: "orca-group-brief-v1", groupId: "g-alpha", state: "review", commandRevision: 7 };
const WAITING = [
  { command: "`npm test` reports unrelated queue flakes", answerable: true, reportedBy: 1 },
  { command: "`npm run lint` fails on generated files", answerable: false, reportedBy: 2 },
];

describe("group brief (#402)", () => {
  it("prints one line per unanswered pre-existing failure, with the answer command only when it is answerable", async () => {
    const waiting = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: { ...BRIEF, preexistingFailuresWaiting: WAITING } } });
    const out = await cli(["group", "brief", "g-alpha"], waiting.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop `...preexistingFailureWaitingLines(field(body, "preexistingFailuresWaiting"))` -> no line, red
    expect(out.stdout.split("\n")).toEqual(expect.arrayContaining([
      "A pre-existing failure waits for your answer: `npm test` reports unrelated queue flakes; orca group preexisting-failure g-alpha --command \"npm test\" --answer <allow-fix|relative|edit-requirement>",
      "A pre-existing failure is reported for information only (no requirement review to answer): `npm run lint` fails on generated files",
    ]));
    expect(out.stdout).not.toContain("edit-requirement>\"");
    const plain = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: BRIEF } });
    expect((await cli(["group", "brief", "g-alpha"], plain.dir)).stdout).not.toContain("pre-existing failure");
  });
});
