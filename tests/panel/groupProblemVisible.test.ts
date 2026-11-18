// Tester #359 (#377 layer 4), plan 2026-11-18 tester batch D, Task V1: a requirement review that did not pass was only on
// the Web Problems row and `group show`. A group with every task done looked like "7/7, reviewing normally" to the card's
// firstFailure (tasks only), to `group brief`'s text and to `orca status`. The summary now carries a group-level problem
// beside firstFailure -- never instead of a task's failure -- and the brief and status read it.
import { describe, expect, it } from "vitest";
import { workHealthCheck } from "../../src/commands/status.js";
import { groupSummarySchema } from "../../src/control/webProtocol.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { cli, fakePanel, useFakePanels } from "../commands/fixtures/fakePanel.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

useFakePanels();

const NOT_PASSED = { state: "not-passed", why: "unfunded", autoFixRounds: 1,
  rounds: [{ roundNo: 1, tip: "a".repeat(40), runId: null, at: 1, result: "unfunded", criteria: [], summary: "no budget for the fix" }] };

type Store = Awaited<ReturnType<typeof driverHarness>>["h"]["store"];
const setWork = (store: Store, taskId: string, status: string): void => {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!;
  store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status }), taskId);
};
const setReview = (store: Store, review: unknown): void => {
  const row = store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
  store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "review", requirementReview: review }));
};

describe("a not-passed requirement review is a group problem (#359)", { timeout: 60_000 }, () => {
  it("every task done: the summary names the review's problem and its three answers; firstFailure stays the tasks'", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      setWork(t.h.store, "a", "done"); setWork(t.h.store, "b", "done");
      setReview(t.h.store, NOT_PASSED);
      const summary = readGroupSummary(t.h.store, "g");
      expect(groupSummarySchema.safeParse(summary).success).toBe(true);
      // mutation: drop the groupProblem assignment in readGroupSummaryFromSnapshot -> red here
      expect(summary.groupProblem).toEqual({ code: "requirement-review-not-passed:unfunded", why: "unfunded", next: [
        "orca group review-fix g --goal '<what to fix>'", "orca group review-rerun g --note '<what to look at>'", "orca group review-accept g --note '<why accept as is>'",
      ] });
      expect(summary.card?.firstFailure).toBeNull();
    } finally { await t.h.dispose(); }
  });

  // Review Focus 1: the task's failure still wins firstFailure; the group problem only sits beside it.
  it("a failed task keeps firstFailure, and the group problem is still given", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      setWork(t.h.store, "a", "done"); setWork(t.h.store, "b", "blocked");
      setReview(t.h.store, NOT_PASSED);
      const summary = readGroupSummary(t.h.store, "g");
      expect(summary.card?.firstFailure).toMatchObject({ taskId: "b", cause: "task-blocked" });
      expect(summary.groupProblem?.code).toBe("requirement-review-not-passed:unfunded");
    } finally { await t.h.dispose(); }
  });

  it("a passed review, or none, is no group problem", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      expect(readGroupSummary(t.h.store, "g")).not.toHaveProperty("groupProblem");
      setReview(t.h.store, { ...NOT_PASSED, state: "passed", why: undefined });
      expect(readGroupSummary(t.h.store, "g")).not.toHaveProperty("groupProblem");
    } finally { await t.h.dispose(); }
  });

  it("group brief's text names the review's problem and its answers", async () => {
    const brief = { schema: "orca-group-brief-v1", groupId: "g-alpha", repoId: "repo-1", state: "review", commandRevision: 5,
      requirementReview: { ...NOT_PASSED, problem: "requirement-review-not-passed:unfunded" } };
    const p = await fakePanel({ "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "review", commandRevision: 5 }] } },
      "GET groups/g-alpha/brief": { status: 200, body: brief } });
    const out = await cli(["group", "brief", "g-alpha"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    const lines = out.stdout.split("\n");
    // mutation: drop reviewLines from the brief's format -> red here
    expect(lines).toContain("problem: requirement-review-not-passed:unfunded");
    expect(lines).toContain("  or: orca group review-rerun g-alpha --note '<what to look at>'");
  });

  it("orca status counts a group with a group problem as work waiting on a person", async () => {
    const p = await fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [
        { groupId: "g1", counts: { blocked: 0 }, stopState: null, groupProblem: { code: "requirement-review-not-passed:unfunded", why: "unfunded", next: ["x"] } },
        // #222: an archived group's problem is not live work.
        { groupId: "old", archived: true, counts: { blocked: 0 }, stopState: null, groupProblem: { code: "requirement-review-not-passed:failed", why: "failed", next: ["x"] } },
      ] } },
      "GET recovery": { status: 200, body: { schema: "orca-control-recovery-v1", blockers: [] } },
    });
    const check = await workHealthCheck({ env: { PATH: process.env.PATH, HOME: p.dir }, stateDirFlag: p.dir, checkout: process.cwd() });
    // mutation: drop the group-problem count from workHealthCheck -> red here (level ok)
    expect(check).toMatchObject({ level: "warn", subject: "work" });
    expect(check.fact).toContain("1 group problem");
  });
});
