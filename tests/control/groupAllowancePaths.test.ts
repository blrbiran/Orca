import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readObservedPathChain } from "../../src/control/observedPathAmendment.js";
import { pathsCovered } from "../../src/control/groupAllowances.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import type { PathPolicyMissV1 } from "../../src/control/pathPolicyMisses.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { loop } from "./fixtures/taskLoop.js";

// Tester follow-up G §6.3 (#189), §10.4: a group path allowance grants exactly the paths the request named. "Allow this
// kind in this group" retries the asking task now (the observed-path retry) and, through Orca's allowance pass, every later
// task blocked on paths it fully covers; "allow this one" is today's single retry. Orca never retries without a covering,
// active allowance.

const OWNER: Principal = { kind: "user", userId: "owner", name: "ana", roles: ["owner"] };
const BY = { by: "ana", via: "web" };
const NOTES: PathPolicyMissV1 = { repoKey: null, path: "docs/notes.md" };
const OTHER: PathPolicyMissV1 = { repoKey: null, path: "docs/other.md" };
type Harness = Awaited<ReturnType<typeof driverHarness>>;

/** a, then b and c (both after a): a and b miss docs/notes.md; c misses it and docs/other.md. A task allowed once succeeds. */
async function world() {
  const succeeds = new Set<string>();
  const t = await driverHarness([
    { taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b"), dependsOn: ["a"] }, { taskId: "c", loop: loop("c"), dependsOn: ["a"] },
  ], {
    behaviour: (id) => succeeds.has(id) ? "succeed" : "blocked-waiting-human",
    stopReason: (id) => succeeds.has(id) ? null : "allowlist miss: docs/notes.md",
    pathPolicyMisses: (id) => succeeds.has(id) ? undefined : id === "c" ? [NOTES, OTHER] : [NOTES],
  });
  const driver = t.driver();
  const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
  const runOf = (task: string): string | null => {
    const row = t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=? ORDER BY rowid DESC").get(task);
    return row === undefined ? null : String(row.id);
  };
  const until = async (predicate: () => boolean): Promise<void> => {
    for (let i = 0; i < 120 && !predicate(); i += 1) { await deliverSchedulerWakes(t.h.store, { start }); await driver.round(); }
    if (!predicate()) throw new Error("the expected state was not reached");
  };
  const blocked = (task: string) => { const id = runOf(task); return id !== null && t.body(id).state === "blocked"; };
  const workStatus = (task: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(task)!.body)).status;
  await t.claim();
  await until(() => blocked("a"));
  return { t, driver, succeeds, runOf, until, blocked, workStatus };
}

function allow(t: Harness, runId: string, scope: "one" | "group") {
  const command = t.h.command("allow-request", { request: { kind: "path", runId }, scope });
  return withCommandContext(command.commandId, routedCommandContext("web", OWNER, BY), () => t.service.allowRequest(command));
}
const retriedRows = (t: Harness, runId: string) => Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE group_id='g' AND kind='task-retried' AND run_id=?").get(runId)!.n);
const actors = (t: Harness, task: string) => {
  const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(task)!.body));
  return readObservedPathChain(t.h.store, "g", task, work).map((record) => record.actor);
};

describe("#189: what a path allowance covers (§10.4)", () => {
  const granted = (paths: PathPolicyMissV1[]) => ({ allowanceId: "allow-1", request: { type: "path" as const, paths }, from: { runId: "run-a" }, by: "ana", via: "web", principal: null, commandId: "c", at: 1 });
  it("covers a run only when every miss is named exactly", () => {
    expect(pathsCovered([granted([NOTES])], [NOTES])).toHaveLength(1);
    expect(pathsCovered([granted([NOTES])], [NOTES, OTHER])).toBeNull();
    expect(pathsCovered([granted([{ repoKey: null, path: "docs" }])], [NOTES])).toBeNull();
    expect(pathsCovered([granted([{ repoKey: "other", path: "docs/notes.md" }])], [NOTES])).toBeNull();
  });
});

describe("#189: path allowances", { timeout: 180_000 }, () => {
  it("allowing a path for the group retries this task now and another task later, but not one with an uncovered miss", async () => {
    const w = await world(); const { t } = w; try {
      const aRun = w.runOf("a")!;
      w.succeeds.add("a");
      const answer = await allow(t, aRun, "group");
      expect("error" in answer ? answer.error : answer.result).toMatchObject({ kind: "request-allowed", allowanceId: "allow-1", retry: { kind: "task-retried" } });
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toContain("docs/notes.md");
      await w.until(() => w.blocked("b") && w.blocked("c"));
      const bRun = w.runOf("b")!, cRun = w.runOf("c")!;
      const pass = await t.service.allowancePass();
      expect(pass.retried).toEqual([bRun]);
      expect(actors(t, "b")).toEqual(["allowance:allow-1"]);
      // c also misses docs/other.md, which no allowance names: it is not retried.
      expect(t.body(cRun).state).toBe("blocked");
      // The pass runs at most one retry per blocked run.
      await t.service.allowancePass();
      expect(retriedRows(t, bRun)).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("allow this one retries without recording an allowance", async () => {
    const w = await world(); const { t } = w; try {
      w.succeeds.add("a");
      const answer = await allow(t, w.runOf("a")!, "one");
      expect("error" in answer ? answer.error : answer.result).toMatchObject({ kind: "request-allowed", allowanceId: null, retry: { kind: "task-retried" } });
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).allowances).toBeUndefined();
      await w.until(() => w.blocked("b"));
      expect((await t.service.allowancePass()).retried).toEqual([]);
      expect(t.body(w.runOf("b")!).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("a revoke before the pass leaves the covered run blocked", async () => {
    const w = await world(); const { t } = w; try {
      w.succeeds.add("a");
      await allow(t, w.runOf("a")!, "group");
      const revoked = await t.service.revokeAllowance(t.h.command("revoke-allowance", { allowanceId: "allow-1" }));
      expect("error" in revoked).toBe(false);
      await w.until(() => w.blocked("b"));
      expect((await t.service.allowancePass()).retried).toEqual([]);
      expect(t.body(w.runOf("b")!).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("orca-auto still needs a covering allowance", async () => {
    const w = await world(); const { t } = w; try {
      const aRun = w.runOf("a")!;
      const auto = t.h.command("retry-task", { taskId: "a", runId: aRun, allowObservedPaths: true, allowanceId: "allow-9" }, "auto-allow-9");
      auto.actorId = "orca-auto";
      expect(t.service.retryTask(auto)).toMatchObject({ error: { code: "observed-paths-not-allowed" } });
      // A "this one" grant records nothing, so Orca still may not retry under it.
      expect(t.body(aRun).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });
});
