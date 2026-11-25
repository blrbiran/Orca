import { describe, expect, it } from "vitest";
import { applyArchiveGroup } from "../../src/control/archiveGroup.js";
import { flagDecision, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { readControlGroup, groupCardFlaggedCount } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { terminalKindOf } from "../../src/control/archivedMark.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { convergeDerivedCriteriaReviewGroups, parentGroupTerminal } from "../../src/control/criteriaReviewLifecycle.js";
import { groupStopState, readStopIntent } from "../../src/control/stopIntent.js";
import { criteriaReviewsOf } from "../../src/control/systemDebug.js";
import type { ControlStore } from "../../src/control/store.js";
import { openTestStore } from "./fixtures/store.js";

const JUDGE = (parentId: string) => ({
  systemDebug: {
    source: { kind: "criteria-review" as const, groupId: parentId, taskId: "a", runId: "run-flagged" },
    stackOn: parentId, inputHash: "a".repeat(64), settled: null,
  },
});

function put(store: ControlStore, id: string, body: Record<string, unknown>, revision = 1): void {
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,?,1,0,?)").run(id, revision, JSON.stringify(body));
}
const bodyOf = (store: ControlStore, id: string): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const revisionOf = (store: ControlStore, id: string): number =>
  Number(store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);

/** A done parent with two derived judges left running/blocked (issue #419's local state). */
async function doneParentWithJudges() {
  const h = await openTestStore();
  put(h.store, "g", { status: "done" });
  put(h.store, "sysdebug-criteria-review-running", { status: "running", ...JUDGE("g") });
  put(h.store, "sysdebug-criteria-review-blocked", { status: "blocked", ...JUDGE("g") });
  return h;
}

describe("criteria-review lifecycle (issue #419)", () => {
  it("a done parent converges its running/blocked judges to archived; the parent reads failed, not debugging", async () => {
    const h = await doneParentWithJudges();
    try {
      expect(parentGroupTerminal(h.store, "g")).toBe(true);
      const converged = h.store.transaction(() => convergeDerivedCriteriaReviewGroups(h.store, undefined, { actor: "orca-auto" }));
      expect(converged).toEqual({ archived: ["sysdebug-criteria-review-running", "sysdebug-criteria-review-blocked"], paused: [] });
      for (const id of converged.archived) {
        expect(terminalKindOf(bodyOf(h.store, id))).toBe("archived");
        expect(bodyOf(h.store, id).derivedArchive).toEqual({ parentGroupId: "g", reason: "parent-terminal" });
        expect(readGroupActivity(h.store, id, 50).map((entry) => entry.kind)).toContain("archived");
      }
      expect(criteriaReviewsOf(h.store, "g")).toEqual([
        { taskId: "a", debugGroupId: "sysdebug-criteria-review-running", state: "failed", reason: "parent-terminal" },
        { taskId: "a", debugGroupId: "sysdebug-criteria-review-blocked", state: "failed", reason: "parent-terminal" },
      ]);
    } finally { await h.dispose(); }
  });

  it("an active run is not killed: the judge is paused (no new work claimed) and archived once the run settles", async () => {
    const h = await openTestStore();
    try {
      put(h.store, "g", { status: "done" });
      const id = "sysdebug-criteria-review-live";
      put(h.store, id, { status: "running", ...JUDGE("g") });
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,1,?)")
        .run("run-live", id, "debug", JSON.stringify({ runId: "run-live", state: "running", taskId: "debug", executionId: "exec-1" }));
      const runBefore = String(h.store.db.prepare("SELECT body FROM runs WHERE id='run-live'").get()!.body);

      const first = h.store.transaction(() => convergeDerivedCriteriaReviewGroups(h.store, undefined, { actor: "orca-auto" }));
      expect(first).toEqual({ archived: [], paused: [id] });
      expect(terminalKindOf(bodyOf(h.store, id))).toBeNull();
      expect(bodyOf(h.store, id).stopped).toBe(true);
      expect(readStopIntent(h.store, id)?.mode).toBe("pause");
      expect(groupStopState(h.store, id)).toBe("paused");
      // The accepted run is untouched: still active, byte-identical body.
      expect(h.store.db.prepare("SELECT active FROM runs WHERE id='run-live'").get()!.active).toBe(1);
      expect(String(h.store.db.prepare("SELECT body FROM runs WHERE id='run-live'").get()!.body)).toBe(runBefore);

      // It settles: the next pass archives the judge with the same evidence.
      h.store.db.prepare("UPDATE runs SET active=0 WHERE id='run-live'").run();
      const second = h.store.transaction(() => convergeDerivedCriteriaReviewGroups(h.store, undefined, { actor: "orca-auto" }));
      expect(second).toEqual({ archived: [id], paused: [] });
      expect(terminalKindOf(bodyOf(h.store, id))).toBe("archived");
    } finally { await h.dispose(); }
  });

  it("a claimed-but-not-started run is left alone so it can start (a pause would hold it at groupHeld)", async () => {
    const h = await openTestStore();
    try {
      put(h.store, "g", { status: "done" });
      const id = "sysdebug-criteria-review-claimed";
      put(h.store, id, { status: "running", ...JUDGE("g") });
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,1,?)")
        .run("run-claimed", id, "debug", JSON.stringify({ runId: "run-claimed", state: "starting", taskId: "debug", executionId: null }));
      const before = JSON.stringify(bodyOf(h.store, id));
      expect(h.store.transaction(() => convergeDerivedCriteriaReviewGroups(h.store, undefined, { actor: "orca-auto" })))
        .toEqual({ archived: [], paused: [] });
      expect(JSON.stringify(bodyOf(h.store, id))).toBe(before);
      expect(readStopIntent(h.store, id)).toBeNull();
      expect(terminalKindOf(bodyOf(h.store, id))).toBeNull();
    } finally { await h.dispose(); }
  });

  it("the cleanup archives a terminal parent's derived judges and leaves a non-terminal parent's judge alone", async () => {
    const h = await doneParentWithJudges();
    try {
      put(h.store, "p", { status: "running" });
      put(h.store, "sysdebug-criteria-review-other", { status: "running", ...JUDGE("p") });
      const result = applyArchiveGroup({ store: h.store }, {
        schema: "orca-raw-command-v1", commandId: "cleanup-g", actorId: "human", expectedRevision: revisionOf(h.store, "g"),
        verb: "archive-group", target: { kind: "group", groupId: "g" }, payload: { derived: true },
      } as never);
      if ("error" in result || result.result.kind !== "archived") throw new Error(JSON.stringify(result));
      expect(result.result).toEqual(expect.objectContaining({
        kind: "archived", groupId: "g",
        derived: { parentTerminal: true, archived: ["sysdebug-criteria-review-running", "sysdebug-criteria-review-blocked"], paused: [] },
      }));
      expect(terminalKindOf(bodyOf(h.store, "sysdebug-criteria-review-other"))).toBeNull();
      // The parent itself is untouched: not archived, just a recorded command.
      expect(terminalKindOf(bodyOf(h.store, "g"))).toBeNull();

      // A third run on the non-terminal parent changes nothing and says why.
      const untouched = applyArchiveGroup({ store: h.store }, {
        schema: "orca-raw-command-v1", commandId: "cleanup-p", actorId: "human", expectedRevision: revisionOf(h.store, "p"),
        verb: "archive-group", target: { kind: "group", groupId: "p" }, payload: { derived: true },
      } as never);
      if ("error" in untouched || untouched.result.kind !== "archived") throw new Error(JSON.stringify(untouched));
      expect(untouched.result).toEqual(expect.objectContaining({ kind: "archived", groupId: "p", derived: { parentTerminal: false, archived: [], paused: [] } }));
    } finally { await h.dispose(); }
  });

  it("is idempotent: a second cleanup changes nothing and writes no new archive rows", async () => {
    const h = await doneParentWithJudges();
    try {
      const command = (commandId: string, expectedRevision: number) => ({
        schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision,
        verb: "archive-group", target: { kind: "group", groupId: "g" }, payload: { derived: true },
      }) as never;
      const first = applyArchiveGroup({ store: h.store }, command("cleanup-1", revisionOf(h.store, "g")));
      if ("error" in first || first.result.kind !== "archived") throw new Error(JSON.stringify(first));
      const activityAfterFirst = ["sysdebug-criteria-review-running", "sysdebug-criteria-review-blocked"]
        .map((id) => readGroupActivity(h.store, id, 500).length);
      const second = applyArchiveGroup({ store: h.store }, command("cleanup-2", revisionOf(h.store, "g")));
      if ("error" in second || second.result.kind !== "archived") throw new Error(JSON.stringify(second));
      expect(second.result).toEqual(expect.objectContaining({ kind: "archived", groupId: "g", derived: { parentTerminal: true, archived: [], paused: [] } }));
      expect(["sysdebug-criteria-review-running", "sysdebug-criteria-review-blocked"].map((id) => readGroupActivity(h.store, id, 500).length))
        .toEqual(activityAfterFirst);
    } finally { await h.dispose(); }
  });

  it("a terminal parent converges the criteria flag its archived judge cannot conclude (#419/#485)", async () => {
    const h = await openTestStore();
    try {
      put(h.store, "g", { status: "done" });
      put(h.store, "sysdebug-criteria-review-flag", { status: "running", ...JUDGE("g") });
      h.store.transaction(() => flagDecision(h.store, { decisionId: "run-flagged/orca-criteria", groupId: "g", runId: "run-flagged", source: "test-change", reason: "fewer assertions", evidence: [], by: "orca-auto", at: "2026-11-25T00:00:00.000Z" }));
      expect(groupCardFlaggedCount(h.store, "g")).toBe(1);
      h.store.transaction(() => convergeDerivedCriteriaReviewGroups(h.store, undefined, { actor: "orca-auto" }));
      // mutation: archive the judge without ratifying its flag -> still flagged, the card counts 1 forever, red
      expect(readFlaggedDecision(h.store, "run-flagged/orca-criteria")).toMatchObject({
        state: "ratified", ratifiedBy: "orca-auto", ratifiedVia: "criteria-review",
        note: expect.stringContaining("parent group ended"),
      });
      expect(groupCardFlaggedCount(h.store, "g")).toBe(0);
    } finally { await h.dispose(); }
  });

  it("a done group's card count equals what group show reads after its judge is archived (#419/#485)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, status: "done" }));
      put(t.h.store, "sysdebug-criteria-review-card", { status: "running", ...JUDGE("g") });
      t.h.store.transaction(() => flagDecision(t.h.store, { decisionId: "run-flagged/orca-criteria", groupId: "g", runId: "run-flagged", source: "test-change", reason: "fewer assertions", evidence: [], by: "orca-auto", at: "2026-11-25T00:00:00.000Z" }));
      t.h.store.transaction(() => convergeDerivedCriteriaReviewGroups(t.h.store, undefined, { actor: "orca-auto" }));
      // mutation: keep the archived judge's flag in pendingDecisions -> 1 here while group show reads 0, red
      expect(readControlGroup(t.h.store, "epoch-test", "g").summary.card?.pendingDecisions).toBe(0);
      expect(groupCardFlaggedCount(t.h.store, "g")).toBe(0);
    } finally { await t.h.dispose(); }
  });

  it("treats an archived/closed parent as terminal and a blocked parent as not", async () => {
    const h = await openTestStore();
    try {
      put(h.store, "a", { status: "running", archived: { at: 1, actor: "human" } });
      put(h.store, "c", { status: "done", archived: { at: 1, actor: "human", kind: "closed" } });
      put(h.store, "b", { status: "blocked" });
      expect(parentGroupTerminal(h.store, "a")).toBe(true);
      expect(parentGroupTerminal(h.store, "c")).toBe(true);
      expect(parentGroupTerminal(h.store, "b")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("archiving a parent through the archive command converges its judges in the same command", async () => {
    const h = await openTestStore();
    try {
      put(h.store, "d", { status: "review" });
      put(h.store, "sysdebug-criteria-review-d", { status: "running", ...JUDGE("d") });
      const result = applyArchiveGroup({ store: h.store }, {
        schema: "orca-raw-command-v1", commandId: "archive-d", actorId: "human", expectedRevision: revisionOf(h.store, "d"),
        verb: "archive-group", target: { kind: "group", groupId: "d" }, payload: {},
      } as never);
      if ("error" in result || result.result.kind !== "archived") throw new Error(JSON.stringify(result));
      expect(terminalKindOf(bodyOf(h.store, "sysdebug-criteria-review-d"))).toBe("archived");
    } finally { await h.dispose(); }
  });
});