/**
 * Review-exit spec 2026-11-05 §3.1, §4 criteria 1-5 and 9 (D1, human ruling 「组里所有任务都完成并落地后，组自动变成 `done`，
 * 不再占槽位」): the driver's done pass. Every group is a raw row (the pass reads the DB only); each assertion reads the
 * store after the pass under test ran.
 */
import { describe, expect, it } from "vitest";
import { initialPlacement } from "../../src/control/dirGroup.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { markGroupsDone } from "../../src/control/groupDone.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { initialLanding } from "../../src/control/multiLandingRecord.js";
import type { ControlStore } from "../../src/control/store.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { openTestStore } from "./fixtures/store.js";

const SHA = { base: "a".repeat(40), landed: "b".repeat(40) };
const LOCAL = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;

function group(store: ControlStore, id: string, body: Record<string, unknown>, taskStatuses: string[] = ["done"]): void {
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,1,1,?)").run(id, JSON.stringify({ groupId: id, planHash: "p".repeat(64), status: "review", stopped: false, ...body }));
  taskStatuses.forEach((status, index) => store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,?,1,?)")
    .run(id, `t${index}`, JSON.stringify({ workItemId: `t${index}`, taskId: `t${index}`, kind: "task", status, dependsOn: [] })));
}
const status = (store: ControlStore, id: string) => (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as { status: string }).status;
const setBody = (store: ControlStore, id: string, patch: Record<string, unknown>) => {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, ...patch }), id);
};
const pass = (store: ControlStore) => store.transaction(() => markGroupsDone(store));
const doneRows = (store: ControlStore, id: string) => store.db.prepare("SELECT body FROM activity WHERE group_id=? AND kind='group-done'").all(id).map((row) => JSON.parse(String(row.body)));

describe("the done pass (review-exit spec §3.1, D1)", () => {
  it("a local-delivery group whose tasks land and integrate ends done", async () => {
    const h = await openTestStore(); try {
      group(h.store, "g", { integration: { ...newGroupIntegration(LOCAL)!, frozen: true, lastIntegrated: SHA.landed, integratedCommit: SHA.landed } });
      // mutation: drop the pass's `status = "done"` write -> review, red
      expect(pass(h.store)).toEqual(["g"]);
      expect(status(h.store, "g")).toBe("done");
      expect(doneRows(h.store, "g")).toEqual([{ from: "review", cause: "delivered" }]);
      // A done group is not moved again (no second row).
      expect(pass(h.store)).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("a local-delivery group with integration still pending stays review", async () => {
    const h = await openTestStore(); try {
      group(h.store, "g", { integration: { ...newGroupIntegration(LOCAL)!, frozen: true } });
      // mutation: drop the integration clause (done once the tasks are) -> done, red
      expect(pass(h.store)).toEqual([]);
      expect(status(h.store, "g")).toBe("review");
    } finally { await h.dispose(); }
  });

  it("a dir group reaches done only after placement catches up", async () => {
    const h = await openTestStore(); try {
      const dirWorkspace = { dir: "/nowhere/notes", vaultId: "e".repeat(64) };
      const placement = initialPlacement({ base: SHA.base, landedTip: SHA.landed, at: 1 });
      group(h.store, "g", { dirWorkspace, placement });
      // mutation: drop the dir clause -> done before placement, red
      expect(pass(h.store)).toEqual([]);
      setBody(h.store, "g", { placement: { ...placement, tip: SHA.landed } });
      expect(pass(h.store)).toEqual(["g"]);
    } finally { await h.dispose(); }
  });

  it("a multi group only after its landing is landed", async () => {
    const h = await openTestStore(); try {
      const landing = { ...initialLanding([{ key: "a", scheme: LOCAL }, { key: "b", scheme: { delivery: "keep" } }], 1), lastLanded: { a: SHA.landed } };
      const multiDir = { project: "p", dirs: [{ key: "a", repoId: "repo", kind: "repo" }, { key: "b", repoId: "other", kind: "repo" }], landing };
      group(h.store, "g", { multiDir });
      // mutation: drop the multi clause -> done while the landing is idle, red
      expect(pass(h.store)).toEqual([]);
      setBody(h.store, "g", { multiDir: { ...multiDir, landing: { ...landing, state: "landed" } } });
      expect(pass(h.store)).toEqual(["g"]);
    } finally { await h.dispose(); }
  });

  it("a budget-blocked group is not moved to done", async () => {
    const h = await openTestStore(); try {
      group(h.store, "g", { status: "blocked" });
      // mutation: drop the `blocked` guard (review, running or blocked) -> done, red
      expect(pass(h.store)).toEqual([]);
      expect(status(h.store, "g")).toBe("blocked");
    } finally { await h.dispose(); }
  });

  it("a group with a blocked task (D14), an active run or a stop intent stays where it is", async () => {
    const h = await openTestStore(); try {
      group(h.store, "d14", {}, ["done", "blocked"]);
      group(h.store, "active", {});
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('r','active','t0',1,1,'{\"phase\":\"handoff\"}')").run();
      group(h.store, "paused", {});
      h.store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES ('paused','pause',1,'{}')").run();
      expect(pass(h.store)).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("a done group is not re-armed by replenishStartWakes", async () => {
    const h = await openTestStore(); try {
      // A done group with a ready task (as a later retry could leave it) and the start wake replenish copies.
      group(h.store, "g", { status: "done" }, ["ready"]);
      h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('w0','g','start','{\"groupId\":\"g\",\"startRevision\":1}',1)").run();
      // mutation: add `done` to DISPATCHABLE_GROUP_STATES -> one wake armed, red
      expect(replenishStartWakes({ store: h.store })).toEqual([]);
    } finally { await h.dispose(); }
  });
});

describe("system verdict groups (review-exit spec §3.1, controller decision; criterion 9)", () => {
  const mark = (kind: "criteria-review" | "ladder", settled: unknown) => ({ systemDebug: { source: { kind, groupId: "o", taskId: "t0", runId: "run-o" }, stackOn: null, inputHash: "a".repeat(64), settled } });
  it("a criteria-review judge whose justified verdict left its task blocked is done once the verdict is recorded", async () => {
    const h = await openTestStore(); try {
      group(h.store, "judge", mark("criteria-review", null), ["blocked"]);
      expect(pass(h.store)).toEqual([]);
      setBody(h.store, "judge", mark("criteria-review", { state: "justified", at: 1, detail: null }));
      // mutation: drop the verdict predicate -> stays review, red
      expect(pass(h.store)).toEqual(["judge"]);
      expect(doneRows(h.store, "judge")).toEqual([{ from: "review", cause: "verdict" }]);
    } finally { await h.dispose(); }
  });

  it("a ladder group is done once its settle is recorded; another system group's mark does not count", async () => {
    const h = await openTestStore(); try {
      group(h.store, "ladder", mark("ladder", { state: "debug-failed", at: 1, detail: null }), ["ready"]);
      group(h.store, "check", { systemDebug: { ...mark("ladder", { state: "done", at: 1, detail: null }).systemDebug, source: { kind: "integration-check", groupId: "o", taskId: null, runId: null } } }, ["ready"]);
      // mutation: drop the verdict predicate -> [], red; widen it to every system kind -> ["ladder","check"], red
      expect(pass(h.store)).toEqual(["ladder"]);
    } finally { await h.dispose(); }
  });
});

describe("the done pass runs every driver round (criterion 3)", () => {
  it("an all-done review group from before the change reaches done without a new checkpoint", async () => {
    const harness = await driverHarness([{ taskId: "a" }]);
    try {
      const { h } = harness;
      for (const row of h.store.db.prepare("SELECT id, body FROM work_items WHERE group_id='g'").all()) {
        const work = JSON.parse(String(row.body)) as Record<string, unknown>;
        if (work.kind === "task") h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...work, status: "done" }), String(row.id));
      }
      setBody(h.store, "g", { status: "review" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM checkpoints").get()!.n).toBe(0);
      // mutation: run the pass only in a round that committed a checkpoint -> review, red
      await harness.driver().round();
      expect(status(h.store, "g")).toBe("done");
    } finally { await harness.h.dispose(); }
  });
});
