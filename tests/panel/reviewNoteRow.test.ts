// #337 (spec 2026-11-19 §5.5, §5.7, criterion C5; human: 「不要卡在」): a folder or multi-directory group's review that did not
// pass is `noted`. It is shown -- a warn `review-note` Overview row in the group's Problems region, the summary's
// `requirementReview.note`, and `group show`'s note and next -- but it is not "needs you" and not a group problem: nothing
// waits on the person, and the group is not held.
import { describe, expect, it } from "vitest";
import { reviewLines } from "../../src/commands/domains/verbs.js";
import { groupNeedsYou, readControlOverview } from "../../src/panel/controlOverview.js";
import { groupSummarySchema } from "../../src/control/webProtocol.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { cli, fakePanel, useFakePanels } from "../commands/fixtures/fakePanel.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

useFakePanels();

const NOTED = { state: "noted", why: "rounds-exhausted", autoFixRounds: 2,
  rounds: [{ roundNo: 3, tip: "a".repeat(40), runId: null, at: 1, result: "not-met", summary: "a still says nothing",
    criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a.txt must say hello", fixableBy: "work" }] }] };

type Store = Awaited<ReturnType<typeof driverHarness>>["h"]["store"];
const setDone = (store: Store, review: unknown): void => {
  for (const row of store.db.prepare("SELECT id, body FROM work_items WHERE group_id='g'").all())
    store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "done" }), row.id);
  const row = store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
  store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "done", requirementReview: review }));
};

describe("a noted review is shown, never needs-you (#337 C5)", { timeout: 60_000 }, () => {
  it("is a warn review-note row in the group's Problems, the summary's note, and no group problem", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      setDone(t.h.store, NOTED);
      const summary = readGroupSummary(t.h.store, "g");
      expect(groupSummarySchema.safeParse(summary).success).toBe(true);
      expect(summary.requirementReview).toMatchObject({ state: "noted", note: "requirement-review-noted:rounds-exhausted" });
      expect(summary.requirementReview).not.toHaveProperty("problem");
      expect(summary).not.toHaveProperty("groupProblem");
      const overview = readControlOverview(t.h.store, "e");
      // mutation M7: emit the row as task-attention -> the kind and needs-you both change, red
      expect(overview.steps.filter((step) => step.groupId === "g")).toEqual([expect.objectContaining({ kind: "review-note", reason: "requirement-review-noted:rounds-exhausted",
        destination: expect.objectContaining({ kind: "group", groupId: "g", region: "problem" }) })]);
      expect(groupNeedsYou(t.h.store, "g")).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("group show prints the note, the last round, and accept then a new requirement as next", async () => {
    const t = await driverHarness([{ taskId: "a" }]); let requirementReview: unknown; try {
      setDone(t.h.store, NOTED);
      requirementReview = readGroupSummary(t.h.store, "g").requirementReview;
    } finally { await t.h.dispose(); }
    expect(reviewLines("g", requirementReview as Parameters<typeof reviewLines>[1])).toEqual([
      "review: noted (rounds-exhausted)",
      "note: requirement-review-noted:rounds-exhausted",
      "review: a still says nothing",
      "  AC1 not-met: a.txt must say hello",
      "next: orca group review-accept g --note '<why accept as is>'",
      "  or: open a new requirement on the project for further work",
    ]);
    const p = await fakePanel({ "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "done", commandRevision: 5 }] } },
      "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "done", commandRevision: 5, requirementReview }, workItems: [], runs: [] } } });
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    expect(lines).toContain("note: requirement-review-noted:rounds-exhausted");
    expect(lines).toContain("next: orca group review-accept g-alpha --note '<why accept as is>'");
    expect(lines.some((line) => line.startsWith("problem: requirement-review"))).toBe(false);
  });
});
