// Tester #419: a criteria-review judge Orca opened for a flagged task could stay `debugging` for the rest of the group's
// life -- the parent read a non-terminal state after the group was done, and no view said why the judge stopped. The
// judge's own group is still `blocked` at its token cap (or its run failed); that is terminal for the review, and the
// parent's brief and full view now say so with the command that unblocks it.
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import express from "express";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { criteriaReviewsOf } from "../../src/control/systemDebug.js";
import { criteriaReviewLines } from "../../src/commands/domains/verbs.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

const HASH = "a".repeat(64);
const mark = (taskId: string, settled: { state: string; at: number; detail: string | null } | null) => ({
  source: { kind: "criteria-review", groupId: "g", taskId, runId: `run-${taskId}` },
  stackOn: null,
  inputHash: HASH,
  settled,
});

type H = Awaited<ReturnType<typeof webFixture>>;
async function world(): Promise<{ h: H; brief: () => Promise<Record<string, unknown>>; done: () => Promise<void> }> {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const server = createServer((() => { const app = express(); app.use(express.json());
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web"); return app; })());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return {
    h,
    brief: async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/brief`);
      return await response.json() as Record<string, unknown>;
    },
    done: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await h.dispose(); },
  };
}

const insertGroup = (h: H, id: string, body: Record<string, unknown>) =>
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,1,1,?)").run(id, JSON.stringify(body));
const insertWork = (h: H, groupId: string, id: string, body: Record<string, unknown>) =>
  h.store.db.prepare("INSERT INTO work_items(id,group_id,target_version,body) VALUES (?,?,1,?)").run(id, groupId, JSON.stringify({ kind: "task", status: "ready", ...body }));

describe("a criteria-review judge that cannot conclude is terminal for the parent (#419)", () => {
  it("a judge blocked at its group cap reads failed (group-cap-reached), not debugging", async () => {
    const w = await world();
    try {
      insertGroup(w.h, "sysdebug-criteria-review-aaaa", { status: "running", systemDebug: mark("a", null) });
      insertWork(w.h, "sysdebug-criteria-review-aaaa", "debug", {
        status: "blocked", groupCapStop: { runId: "run-debug", at: 1, observedTokens: 209_130 },
        currentRunId: "run-debug",
      });

      expect(criteriaReviewsOf(w.h.store, "g")).toEqual([
        { taskId: "a", debugGroupId: "sysdebug-criteria-review-aaaa", state: "failed", reason: "group-cap-reached" },
      ]);
      // mutation: map an unfinished judge to "debugging" regardless of the cap -> this goes back to debugging -> red
      expect((await w.brief()).criteriaReviews).toEqual([
        { taskId: "a", debugGroupId: "sysdebug-criteria-review-aaaa", state: "failed", reason: "group-cap-reached" },
      ]);
      expect(criteriaReviewLines((await w.brief()).criteriaReviews as never)).toEqual([
        "criteria-review a: failed (group-cap-reached) — sysdebug-criteria-review-aaaa; next: orca group set-limit sysdebug-criteria-review-aaaa --limit <tokens>; orca group show sysdebug-criteria-review-aaaa",
      ]);
    } finally { await w.done(); }
  });

  it("a judge still running stays debugging, and its line carries no next step", async () => {
    const w = await world();
    try {
      insertGroup(w.h, "sysdebug-criteria-review-bbbb", { status: "running", systemDebug: mark("a", null) });
      insertWork(w.h, "sysdebug-criteria-review-bbbb", "debug", { status: "running", currentRunId: "run-live" });
      expect(criteriaReviewsOf(w.h.store, "g")).toEqual([
        { taskId: "a", debugGroupId: "sysdebug-criteria-review-bbbb", state: "debugging", reason: null },
      ]);
      expect(criteriaReviewLines((await w.brief()).criteriaReviews as never)).toEqual([
        "criteria-review a: debugging (sysdebug-criteria-review-bbbb)",
      ]);
    } finally { await w.done(); }
  });

  it("a failed judge on a passed parent review is advisory, with the debug group's next", async () => {
    const w = await world();
    try {
      insertGroup(w.h, "sysdebug-criteria-review-aaaa", { status: "running", systemDebug: mark("a", null) });
      insertWork(w.h, "sysdebug-criteria-review-aaaa", "debug", {
        status: "blocked", groupCapStop: { runId: "run-debug", at: 1, observedTokens: 209_130 }, currentRunId: "run-debug",
      });
      const body = JSON.parse(String(w.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      w.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, requirementReview: { state: "passed", autoFixRounds: 0, rounds: [] } }));
      const brief = await w.brief();
      expect(brief.requirementReview).toMatchObject({ state: "passed" });
      // mutation: drop the advisory sentence -> the line is a bare failure beside `review: passed`, red
      expect(criteriaReviewLines(brief.criteriaReviews as never, (brief.requirementReview as { state?: string } | undefined)?.state === "passed")).toEqual([
        "criteria-review a: failed (group-cap-reached) — sysdebug-criteria-review-aaaa; the requirement review passed, so this criteria review is advisory and does not affect the main group; next: orca group set-limit sysdebug-criteria-review-aaaa --limit <tokens>; orca group show sysdebug-criteria-review-aaaa",
      ]);
    } finally { await w.done(); }
  });

  it("a settled judge keeps its verdict", async () => {
    const w = await world();
    try {
      insertGroup(w.h, "sysdebug-criteria-review-cccc", { status: "done", systemDebug: mark("a", { state: "justified", at: 2, detail: null }) });
      expect(criteriaReviewsOf(w.h.store, "g")).toEqual([
        { taskId: "a", debugGroupId: "sysdebug-criteria-review-cccc", state: "justified", reason: null },
      ]);
      expect(criteriaReviewLines((await w.brief()).criteriaReviews as never)).toEqual([]);
    } finally { await w.done(); }
  });
});