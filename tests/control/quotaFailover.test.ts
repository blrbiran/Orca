import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { installationRests, parseResetAt, REST_CAP_MS, REST_DEFAULT_MS } from "../../src/control/quotaRest.js";
import { failoverCommandId } from "../../src/control/systemDebug.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { PartialSelection } from "../../src/control/agentSelection.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Quota failover spec 2026-11-03 §3, §8 (human: 「如果是provider额度用完，且有备用provider，可以改provider并重试。」, D1-D6 as
 * recommended): unattended work should not stop because one vendor's quota ran out while another installation has room.
 * A task whose run failed with ccloop's `quota` cause is switched by orca-auto to the next installation that is not
 * resting and retried at once -- unless a person or a plan chose its agent (a pin is a statement), or failover is off.
 * The switch keeps every earlier run valid: the view, the retry and the snapshot all still agree.
 */
async function world(options: { agent?: PartialSelection } = {}) {
  const clock = { value: Date.UTC(2026, 10, 5, 12, 0, 0) };
  let failing = true;
  const t = await driverHarness([{ taskId: "a", ...(options.agent ? { agent: options.agent } : {}) }], {
    storeNow: () => clock.value,
    behaviour: (id) => (id === "a" && failing ? "failed" : "succeed"),
    failure: (id) => (id === "a" && failing ? { failureCause: { cause: "quota", phase: "plan", retries: 0, detail: "You've hit your usage limit" } } : undefined),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  const work = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  const retries = () => t.h.store.db.prepare("SELECT id, actor_id FROM commands WHERE group_id='g' AND json_extract(body_json,'$.verb')='retry-task'").all().map((r) => [String(r.id), String(r.actor_id)]);
  let orders = 0;
  const setOrder = (failoverOrder: string[]) => service.setOrchestrationSettings(t.h.rawCommand(`order-${++orders}`,
    Number(t.h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, failoverOrder }) as never);
  return { t, service, runId, clock, work, retries, setOrder, succeedNext: () => { failing = false; } };
}

describe("the reset time a codex quota error names (D3)", () => {
  it("reads a dated and a time-only reset in local time, and nothing else", () => {
    const at = new Date(2026, 10, 4, 15, 0).getTime();
    expect(parseResetAt("You've hit your usage limit ... try again at Oct 22nd, 2026 2:13 PM", at)).toBe(new Date(2026, 9, 22, 14, 13).getTime());
    expect(parseResetAt("You've hit your usage limit … try again at 16:12", at)).toBe(new Date(2026, 10, 4, 16, 12).getTime());
    // Already past today: the next one.
    expect(parseResetAt("try again at 09:30", at)).toBe(new Date(2026, 10, 5, 9, 30).getTime());
    expect(parseResetAt("You've hit your usage limit. Upgrade to Pro", at)).toBeNull();
    expect(parseResetAt("try again at 25:99", at)).toBeNull();
    expect(parseResetAt(null, at)).toBeNull();
  });
});

describe("a quota failure switches the task's installation and retries it (§8)", { timeout: 120_000 }, () => {
  it("switches to the next installation, records the switch, and every earlier run still agrees", async () => {
    const w = await world(); try {
      const before = w.work();
      expect(before.agent.agent).toBe("codex");
      // The failed installation rests for every group: no reset time named, so 15 minutes.
      const rest = installationRests(w.t.h.store, w.clock.value).get("codex");
      expect(rest).toMatchObject({ source: "default", runId: w.runId });
      expect(rest!.until - w.clock.value).toBeLessThanOrEqual(REST_DEFAULT_MS);
      w.succeedNext();
      await w.service.systemDebugPass();
      expect(w.retries()).toEqual([[failoverCommandId("a", w.runId), "orca-auto"]]);
      const after = w.work();
      expect(after.agent.agent).toBe("claude");
      expect(after.agentProvenance.agent).toBe("failover");
      expect(after.agentSwitches).toEqual([expect.objectContaining({ afterRunId: w.runId, by: "orca-auto", reason: "quota", previous: expect.objectContaining({ agent: before.agent }) })]);
      // The re-issued snapshot is the authority and agrees with the work item.
      expect(() => readConfirmedTaskExecution(w.t.h.store, "g", "a")).not.toThrow();
      const activity = w.t.h.store.db.prepare("SELECT body FROM activity WHERE kind='task-retried' AND run_id=?").get(w.runId);
      expect(JSON.parse(String(activity!.body))).toEqual({ fromRunId: w.runId, agent: { from: "codex", to: "claude" } });
      // The failed codex run still belongs to the task's lineage: the group view (which throws recovery-blocked on a run
      // that disagrees with its work item) still reads, and lists it.
      expect(readControlGroup(w.t.h.store, "epoch-test", "g").runs.map((run) => run.runId)).toContain(w.runId);
      // The next run is claimed on claude and the task finishes.
      const next = await w.t.claim();
      expect((w.t.body(next) as { agent: { agent: string } }).agent.agent).toBe("claude");
      // One failover per failed run: a second pass does nothing.
      await w.service.systemDebugPass();
      expect(w.retries()).toHaveLength(1);
    } finally { await w.t.h.dispose(); }
  });

  it("does not switch a task whose agent the plan named (D2), nor with failover off (D1)", async () => {
    const pinned = await world({ agent: { agent: "codex" } }); try {
      expect(pinned.work().agentProvenance.agent).toBe("task-plan");
      await pinned.service.systemDebugPass();
      expect(pinned.retries()).toEqual([]);
      expect(pinned.work().agent.agent).toBe("codex");
    } finally { await pinned.t.h.dispose(); }
    const off = await world(); try {
      expect("error" in (off.setOrder([]) as object)).toBe(false);
      await off.service.systemDebugPass();
      expect(off.retries()).toEqual([]);
    } finally { await off.t.h.dispose(); }
  });

  it("skips a resting installation and the one the task is on, in the person's order", async () => {
    const w = await world(); try {
      // Only the failed installation in the order: nothing to switch to, the task waits.
      expect("error" in (w.setOrder(["codex"]) as object)).toBe(false);
      await w.service.systemDebugPass();
      expect(w.retries()).toEqual([]);
      expect("error" in (w.setOrder(["codex", "claude"]) as object)).toBe(false);
      await w.service.systemDebugPass();
      expect(w.work().agent.agent).toBe("claude");
    } finally { await w.t.h.dispose(); }
  });

  it("a person retries a failed task on another installation; the switch is theirs", async () => {
    const w = await world(); try {
      const revision = Number(w.t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      const answer = await w.service.retryTaskOnAgent({ schema: "orca-raw-command-v1", commandId: "person-retry", actorId: "operator", expectedRevision: revision,
        verb: "retry-task", target: { kind: "group", groupId: "g" }, payload: { taskId: "a", runId: w.runId, agent: "claude" } } as never);
      expect("error" in (answer as object)).toBe(false);
      expect(w.work().agentProvenance.agent).toBe("task");
      expect(w.work().agentSwitches[0]).toMatchObject({ reason: "person", by: "operator" });
      // The same installation again is refused by name.
      const again = await w.service.retryTaskOnAgent({ schema: "orca-raw-command-v1", commandId: "person-retry-2", actorId: "operator", expectedRevision: revision + 1,
        verb: "retry-task", target: { kind: "group", groupId: "g" }, payload: { taskId: "a", agent: "claude" } } as never);
      expect((again as { error?: { code: string } }).error?.code).toBeDefined();
    } finally { await w.t.h.dispose(); }
  });
});

describe("a resting installation is not switched to (D3, D4)", { timeout: 120_000 }, () => {
  it("waits while the other installation rests, and switches back once its rest ends", async () => {
    const w = await world(); try {
      await w.service.systemDebugPass();
      expect(w.work().agent.agent).toBe("claude");
      // claude runs out too (the task still fails), while codex rests from its own failure 0 ms ago.
      const second = await w.t.claim();
      await w.t.until(w.t.driver(), () => w.t.body(second).state === "blocked");
      await w.service.systemDebugPass();
      expect(w.work().agent.agent).toBe("claude");
      expect(w.retries()).toHaveLength(1);
      // codex's 15-minute rest ends (claude's own has just begun): the task goes back to codex.
      w.clock.value += REST_DEFAULT_MS + 1;
      await w.service.systemDebugPass();
      expect(w.retries().map(([id]) => id)).toEqual([failoverCommandId("a", w.runId), failoverCommandId("a", second)]);
      expect(w.work().agent.agent).toBe("codex");
      expect(w.work().agentSwitches.map((entry: { afterRunId: string }) => entry.afterRunId)).toEqual([w.runId, second]);
      // Both earlier runs (one per installation) still agree with what the task carried when they were claimed.
      expect(readControlGroup(w.t.h.store, "epoch-test", "g").runs.map((run) => run.runId)).toEqual(expect.arrayContaining([w.runId, second]));
      expect(() => readConfirmedTaskExecution(w.t.h.store, "g", "a")).not.toThrow();
    } finally { await w.t.h.dispose(); }
  });
});

describe("rests from the stored runs (D3)", () => {
  type Row = { id: string; body: string };
  const store = (rows: Row[]) => ({ db: { prepare: () => ({ all: () => rows, get: () => undefined }) } }) as never;
  const run = (id: string, agent: string, endedAt: number, drive: object): Row => ({ id, body: JSON.stringify({ agent: { agent }, endedAt, drive }) });
  const quota = (detail: string | null = null) => ({ outcome: "failed", failureCause: { cause: "quota", detail } });
  it("doubles per consecutive quota failure up to 8 hours, takes a named reset time, and ends on a success", () => {
    const t0 = new Date(2026, 10, 5, 10, 0).getTime();
    expect(installationRests(store([run("r1", "codex", t0, quota())]), t0).get("codex")).toMatchObject({ until: t0 + REST_DEFAULT_MS, source: "default" });
    expect(installationRests(store([run("r1", "codex", t0, quota()), run("r2", "codex", t0 + 1, quota())]), t0).get("codex")!.until).toBe(t0 + 1 + 2 * REST_DEFAULT_MS);
    const many = Array.from({ length: 12 }, (_, i) => run(`r${i}`, "codex", t0 + i, quota()));
    expect(installationRests(store(many), t0).get("codex")!.until).toBe(t0 + 11 + REST_CAP_MS);
    expect(installationRests(store([run("r1", "codex", t0, quota("try again at 16:12"))]), t0).get("codex")).toMatchObject({ until: new Date(2026, 10, 5, 16, 12).getTime(), source: "vendor" });
    // A success after the failure ends the rest; a failure after a success starts a new streak of one.
    expect(installationRests(store([run("r1", "codex", t0, quota()), run("r2", "codex", t0 + 1, { outcome: "succeeded" })]), t0).has("codex")).toBe(false);
    expect(installationRests(store([run("r1", "codex", t0, quota()), run("r2", "codex", t0 + 1, { outcome: "succeeded" }), run("r3", "codex", t0 + 2, quota())]), t0).get("codex")!.until).toBe(t0 + 2 + REST_DEFAULT_MS);
    // Over: not resting; another installation's failure is its own.
    expect(installationRests(store([run("r1", "codex", t0, quota())]), t0 + REST_DEFAULT_MS).has("codex")).toBe(false);
    expect(installationRests(store([run("r1", "claude", t0, quota())]), t0).has("codex")).toBe(false);
  });
});
