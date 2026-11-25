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
  // Tester #504: on a finished group the row is recorded; only a review rerun would read an answer, and the answer
  // command stays reachable.
  { command: "`npm run build` failed at the base", answerable: false, onlyRerunUsesIt: true, reportedBy: 1 },
];
const RECORDED = "A pre-existing failure is recorded; a review-rerun would use this answer: `npm run build` failed at the base; orca group preexisting-failure g-alpha --command \"npm run build\" --answer <allow-fix|relative|edit-requirement>";

describe("group brief (#402)", () => {
  it("prints one line per unanswered pre-existing failure, with the answer command only when it is answerable", async () => {
    const waiting = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: { ...BRIEF, preexistingFailuresWaiting: WAITING } } });
    const out = await cli(["group", "brief", "g-alpha"], waiting.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop `...preexistingFailureWaitingLines(field(body, "preexistingFailuresWaiting"))` -> no line, red
    expect(out.stdout.split("\n")).toEqual(expect.arrayContaining([
      "A pre-existing failure waits for your answer: `npm test` reports unrelated queue flakes; orca group preexisting-failure g-alpha --command \"npm test\" --answer <allow-fix|relative|edit-requirement>",
      "A pre-existing failure is reported for information only (no requirement review to answer): `npm run lint` fails on generated files",
      RECORDED,
    ]));
    // #504: a finished group's row never says it waits, and it keeps the answer command available.
    expect(RECORDED).not.toContain("waits for your answer");
    expect(RECORDED).toContain("orca group preexisting-failure g-alpha");
    expect(out.stdout).not.toContain("edit-requirement>\"");
    const plain = await fakePanel({ "GET summary": { status: 200, body: SUMMARY }, "GET groups/g-alpha/brief": { status: 200, body: BRIEF } });
    expect((await cli(["group", "brief", "g-alpha"], plain.dir)).stdout).not.toContain("pre-existing failure");
  });

  it("a done group's brief records its row instead of saying it waits (#504)", async () => {
    const done = { ...SUMMARY, groups: [{ ...SUMMARY.groups[0], state: "done" }] };
    const p = await fakePanel({ "GET summary": { status: 200, body: done },
      "GET groups/g-alpha/brief": { status: 200, body: { ...BRIEF, state: "done", preexistingFailuresWaiting: [{ command: "npm test", answerable: false, onlyRerunUsesIt: true, reportedBy: 1 }] } } });
    const out = await cli(["group", "brief", "g-alpha"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: print the waiting line whenever the entry is unanswered -> "waits for your answer", red
    expect(out.stdout).not.toContain("waits for your answer");
    expect(out.stdout).toContain("a review-rerun would use this answer");
  });
});
