import { describe, expect, it, vi } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { installationRests, parseResetAt, REST_CAP_MS, REST_DEFAULT_MS } from "../../src/control/quotaRest.js";
import { failoverCommandId } from "../../src/control/systemDebug.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { permissionRefusal } from "../../src/panel/permissions.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { PartialSelection } from "../../src/control/agentSelection.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { caps } from "./fixtures/store.js";

/**
 * Quota failover spec 2026-11-03 §3, §8 (human: 「如果是provider额度用完，且有备用provider，可以改provider并重试。」, D1-D6 as
 * recommended): unattended work should not stop because one vendor's quota ran out while another installation has room.
 * A task whose run failed with ccloop's `quota` cause is switched by orca-auto to the next installation that is not
 * resting and retried at once -- unless a person or a plan chose its agent (a pin is a statement), or failover is off.
 * The switch keeps every earlier run valid: the view, the retry and the snapshot all still agree.
 */
async function world(options: { agent?: PartialSelection; detail?: string; cause?: string } = {}) {
  const clock = { value: Date.UTC(2026, 10, 5, 12, 0, 0) };
  let failing = true;
  const t = await driverHarness([{ taskId: "a", ...(options.agent ? { agent: options.agent } : {}) }], {
    storeNow: () => clock.value,
    behaviour: (id) => (id === "a" && failing ? "failed" : "succeed"),
    failure: (id) => (id === "a" && failing ? { failureCause: { cause: options.cause ?? "quota", phase: "plan", retries: 0, detail: options.detail ?? "You've hit your usage limit" } } : undefined),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  const work = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  const retries = () => t.h.store.db.prepare("SELECT id, actor_id FROM commands WHERE group_id='g' AND json_extract(body_json,'$.verb')='retry-task' ORDER BY rowid").all().map((r) => [String(r.id), String(r.actor_id)]);
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
      // Stamped with the task's switch count at the claim; the first run (claimed before any switch) has none.
      expect((w.t.body(next) as { agentEpoch?: number }).agentEpoch).toBe(1);
      expect((w.t.body(w.runId) as { agentEpoch?: number }).agentEpoch).toBeUndefined();
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
    // Only quota: credentials (auth) are not another installation's to fix.
    const auth = await world({ cause: "auth" }); try {
      await auth.service.systemDebugPass();
      expect(auth.retries()).toEqual([]);
      expect(auth.work().agent.agent).toBe("codex");
    } finally { await auth.t.h.dispose(); }
    // An installation the person set to wait (failure-cause spec 2026-10-21 §5) is waited for, not left.
    const waits = await world(); try {
      expect("error" in (waits.service.setOrchestrationSettings(waits.t.h.rawCommand("wait", Number(waits.t.h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0),
        "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, quotaWait: ["codex"] }) as never) as object)).toBe(false);
      await waits.service.systemDebugPass();
      expect(waits.retries()).toEqual([]);
      expect(waits.work().agent.agent).toBe("codex");
    } finally { await waits.t.h.dispose(); }
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
      // The installation the task is on is refused by name (nothing would change).
      const same = await w.service.retryTaskOnAgent({ schema: "orca-raw-command-v1", commandId: "person-same", actorId: "operator",
        expectedRevision: Number(w.t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
        verb: "retry-task", target: { kind: "group", groupId: "g" }, payload: { taskId: "a", runId: w.runId, agent: "codex" } } as never);
      expect((same as { error?: { code: string; message: string } }).error).toMatchObject({ code: "task-not-retryable", message: expect.stringContaining("agent-unchanged") });
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
  it("never switches to the installation the task is on, even when its named reset time has passed", async () => {
    // The vendor's reset (Oct 22nd) is long past at the failure (Nov 5th): codex is not resting, yet it is the one that failed.
    const w = await world({ detail: "You've hit your usage limit ... try again at Oct 22nd, 2026 2:13 PM" }); try {
      expect(installationRests(w.t.h.store, w.clock.value).has("codex")).toBe(false);
      await w.service.systemDebugPass();
      expect(w.retries()).toEqual([[failoverCommandId("a", w.runId), "orca-auto"]]);
      expect(w.work().agent.agent).toBe("claude");
    } finally { await w.t.h.dispose(); }
  });

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

describe("which selection an earlier run must carry after switches (runAgentAgrees)", () => {
  // Independent review (session e2ad4802): neither the lineage list (sorted by run id) nor the claim ordinal (a
  // continuation resets it to 1) orders runs by claim; each run is stamped with the task's switch count instead.
  const frozen = (agent: string) => ({ agent: { agent, model: "m", contextWindow: "agent-default" }, agentProvenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
    configHash: "c".repeat(64), timeoutMs: 1, killGraceMs: 0, agentCapabilities: caps });
  it("reads each run's epoch, whatever its id or claim ordinal", async () => {
    const { runAgentAgrees } = await import("../../src/control/agentSwitch.js");
    const work = { ...frozen("codex"), lineageRunIds: ["run-a", "run-b", "run-c", "run-d"],
      agentSwitches: [{ afterRunId: "run-c", previous: frozen("codex-old"), by: "orca-auto", at: 0, reason: "quota" },
        { afterRunId: "run-a", previous: frozen("claude"), by: "orca-auto", at: 0, reason: "quota" }] };
    expect(runAgentAgrees(work, { runId: "run-c", claimOrdinal: 1, ...frozen("codex-old") })).toBe(true);
    expect(runAgentAgrees(work, { runId: "run-a", claimOrdinal: 2, agentEpoch: 1, ...frozen("claude") })).toBe(true);
    // A continuation after the second switch: claim ordinal reset to 1, epoch 2, the current selection.
    expect(runAgentAgrees(work, { runId: "run-d", claimOrdinal: 1, agentEpoch: 2, ...frozen("codex") })).toBe(true);
    expect(runAgentAgrees(work, { runId: "run-d", claimOrdinal: 1, agentEpoch: 2, ...frozen("codex-old") })).toBe(false);
    expect(runAgentAgrees(work, { runId: "run-a", claimOrdinal: 2, agentEpoch: 1, ...frozen("codex") })).toBe(false);
    // An epoch past the history is not a run of this task as it stands.
    expect(runAgentAgrees(work, { runId: "run-b", claimOrdinal: 3, agentEpoch: 3, ...frozen("codex") })).toBe(false);
    // A task never switched: every run carries the current selection, as before.
    expect(runAgentAgrees(frozen("codex"), { runId: "run-x", claimOrdinal: 5, ...frozen("codex") })).toBe(true);
  });
});

describe("the pass survives what it cannot do (independent review)", { timeout: 120_000 }, () => {
  it("books nothing when the target cannot be resolved now, and switches on a later pass", async () => {
    const w = await world(); try {
      let refuse = true;
      const port = { ...w.t.h.deps.port, resolveAgent: async (partial: PartialSelection) => {
        if (refuse && partial.agent === "claude") throw new Error("ccloop is busy");
        return w.t.h.deps.port.resolveAgent(partial);
      } };
      const service = new WebControlService({ ...w.t.h.deps, port, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => w.t.repo });
      await service.systemDebugPass();
      expect(w.retries()).toEqual([]);
      refuse = false;
      await service.systemDebugPass();
      expect(w.work().agent.agent).toBe("claude");
    } finally { await w.t.h.dispose(); }
  });

  it("tries the next installation when one cannot be resolved now", async () => {
    const w = await world(); try {
      // A third installation the fake ccloop resolves as claude's twin; claude itself is busy this pass.
      const base = w.t.h.deps.port;
      const port = { ...base,
        listAgents: async () => ({ installations: [...(await base.listAgents()).installations, { id: "omp", kind: "omp", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
        resolveAgent: async (partial: PartialSelection) => {
          if (partial.agent === "claude") throw new Error("ccloop is busy");
          if (partial.agent === "omp") { const twin = await base.resolveAgent({ agent: "claude" }); return { ...twin, selection: { ...twin.selection, agent: "omp" } }; }
          return base.resolveAgent(partial);
        } };
      const service = new WebControlService({ ...w.t.h.deps, port, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => w.t.repo });
      await service.systemDebugPass();
      expect(w.work().agent.agent).toBe("omp");
    } finally { await w.t.h.dispose(); }
  });

  it("leaves a run whose failover command was already answered, even after the group revision moved", async () => {
    const w = await world(); try {
      const revision = () => Number(w.t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      // An answer booked under the run's failover id (here a refusal: the installation the task is on).
      const refused = await w.service.retryTaskOnAgent({ schema: "orca-raw-command-v1", commandId: failoverCommandId("a", w.runId), actorId: "operator", expectedRevision: revision(),
        verb: "retry-task", target: { kind: "group", groupId: "g" }, payload: { taskId: "a", runId: w.runId, agent: "codex" } } as never);
      expect("error" in (refused as object)).toBe(true);
      const limit = readWebGroup(w.t.h.store, "g").ledger.groupLimit;
      expect("error" in (w.t.service.setLimit(w.t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 1 } })) as object)).toBe(false);
      // Not resent (a resend at the new revision would be command-id-conflict, caught and logged per candidate).
      const written: string[] = [];
      const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { written.push(String(chunk)); return true; });
      try { await expect(w.service.systemDebugPass()).resolves.toBeDefined(); } finally { spy.mockRestore(); }
      expect(written.filter((line) => line.includes("failover"))).toEqual([]);
      expect(w.work().agent.agent).toBe("codex");
    } finally { await w.t.h.dispose(); }
  });
});

describe("an agent may switch a task's installation; --agent auto hands it back (session 3cfc2e73 ruling)", { timeout: 120_000 }, () => {
  // Human: 「想要增加被授权的 agent 的能力，可以不止是人才允许。」 then 「同意按你的建议走」: an authorized agent may switch, its
  // switch locks the task against failover like a person's and names who switched; a person unlocks it with --agent auto.
  const retry = (w: Awaited<ReturnType<typeof world>>, commandId: string, payload: object, principal: { client: string; principal: string }) =>
    withCommandContext(commandId, principal, () => w.service.retryTaskOnAgent({ schema: "orca-raw-command-v1", commandId, actorId: "operator",
      expectedRevision: Number(w.t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
      verb: "retry-task", target: { kind: "group", groupId: "g" }, payload: { taskId: "a", ...payload } } as never));
  const agent = { client: "cli:claude", principal: "agent:cli:claude" }, person = { client: "web", principal: "user:u1" };

  it("an agent's switch is named and locks; auto unlocks in place while every installation rests, and failover moves it later", async () => {
    const w = await world(); try {
      expect("error" in (await retry(w, "agent-switch", { runId: w.runId, agent: "claude" }, agent) as object)).toBe(false);
      expect(w.work().agentProvenance.agent).toBe("task");
      expect(w.work().agentSwitches[0]).toMatchObject({ by: "agent:cli:claude", reason: "person" });
      // claude runs out too: the agent's pin holds (D2), orca-auto leaves it.
      const second = await w.t.claim();
      await w.t.until(w.t.driver(), () => w.t.body(second).state === "blocked");
      await w.service.systemDebugPass();
      expect(w.retries().map(([id]) => id)).toEqual(["agent-switch"]);
      // Both installations rest: auto keeps claude, only its provenance changes, and the person is named.
      expect("error" in (await retry(w, "person-auto", { runId: second, agent: "auto" }, person) as object)).toBe(false);
      expect(w.work().agent.agent).toBe("claude");
      expect(w.work().agentProvenance.agent).toBe("failover");
      expect(w.work().agentSwitches[1]).toMatchObject({ afterRunId: second, by: "user:u1", reason: "auto", previous: expect.objectContaining({ agentProvenance: expect.objectContaining({ agent: "task" }) }) });
      expect(() => readConfirmedTaskExecution(w.t.h.store, "g", "a")).not.toThrow();
      // Unlocked: claude fails again (a streak of two, 30 minutes), codex's 15-minute rest ends first, and failover moves the task.
      const third = await w.t.claim();
      await w.t.until(w.t.driver(), () => w.t.body(third).state === "blocked");
      w.clock.value += REST_DEFAULT_MS + 1;
      await w.service.systemDebugPass();
      expect(w.work().agent.agent).toBe("codex");
      expect(w.retries().map(([id]) => id)).toEqual(["agent-switch", "person-auto", failoverCommandId("a", third)]);
      expect(readControlGroup(w.t.h.store, "epoch-test", "g").runs.map((run) => run.runId)).toEqual(expect.arrayContaining([w.runId, second, third]));
    } finally { await w.t.h.dispose(); }
  });

  it("auto on a resting installation takes the next one in the failover order, as failover would", async () => {
    const w = await world(); try {
      expect("error" in (await retry(w, "agent-auto", { runId: w.runId, agent: "auto" }, agent) as object)).toBe(false);
      expect(w.work().agent.agent).toBe("claude");
      expect(w.work().agentProvenance.agent).toBe("failover");
      expect(w.work().agentSwitches).toEqual([expect.objectContaining({ afterRunId: w.runId, by: "agent:cli:claude", reason: "auto" })]);
    } finally { await w.t.h.dispose(); }
  });

  it("auto on a task already switchable whose installation is not resting retries it as it is", async () => {
    // An auth failure leaves codex not resting; the plan named no agent, so the task is switchable already.
    const w = await world({ cause: "auth" }); try {
      expect("error" in (await retry(w, "auto-plain", { runId: w.runId, agent: "auto" }, person) as object)).toBe(false);
      expect(w.retries()).toEqual([["auto-plain", "operator"]]);
      expect(w.work().agent.agent).toBe("codex");
      expect(w.work().agentSwitches).toBeUndefined();
      expect(w.work().status).toBe("ready");
    } finally { await w.t.h.dispose(); }
  });

  it("a run Orca dispatched may not choose or unlock an installation; the socket agent and a person may", () => {
    const dispatched = { kind: "agent" as const, client: "cli", dispatchedRun: "run-1" };
    expect(permissionRefusal(dispatched, "retry-task", { taskId: "a", agent: "claude" })?.code).toBe("control-dispatched-run-refused");
    expect(permissionRefusal(dispatched, "retry-task", { taskId: "a", agent: "auto" })?.code).toBe("control-dispatched-run-refused");
    expect(permissionRefusal(dispatched, "retry-task", { taskId: "a" })).toBeNull();
    expect(permissionRefusal({ kind: "agent", client: "cli" }, "retry-task", { taskId: "a", agent: "auto" })).toBeNull();
    expect(permissionRefusal({ kind: "user", userId: "u1", name: "u", roles: ["member"] }, "retry-task", { taskId: "a", agent: "claude" })).toBeNull();
  });
});

describe("a task not started yet leaves a resting installation before its first claim (spec §3 Route, session 3cfc2e73)", { timeout: 120_000 }, () => {
  // Spec §3 Route: 「At dispatch -- never mid-run -- a work item whose selected installation is resting is offered to the next
  // installation」. Task `a` runs out of quota on codex; task `b` has not run yet and would only hit the same wall.
  type Port = WebControlService["deps"]["port"];
  async function pair(options: { bAgent?: PartialSelection; cause?: string; port?: (base: Port, claim: () => Promise<string>) => Port } = {}) {
    const clock = { value: Date.UTC(2026, 10, 5, 12, 0, 0) };
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", ...(options.bAgent ? { agent: options.bAgent } : {}) }], {
      storeNow: () => clock.value,
      behaviour: (id) => (id === "a" ? "failed" : "succeed"),
      failure: (id) => (id === "a" ? { failureCause: { cause: options.cause ?? "quota", phase: "plan", retries: 0, detail: "You've hit your usage limit" } } : undefined),
    });
    const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
    const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
    if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
    const port = options.port?.(t.h.deps.port, t.claim) ?? t.h.deps.port;
    const service = new WebControlService({ ...t.h.deps, port, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
    const first = await t.claim();
    await t.until(t.driver(), () => t.body(first).state === "blocked");
    const work = (id: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body));
    const runsOf = (id: string) => t.h.store.db.prepare("SELECT id, body FROM runs WHERE group_id='g' AND work_item_id=? ORDER BY rowid").all(id).map((row) => ({ id: String(row.id), ...JSON.parse(String(row.body)) }));
    // The driver's path: the next start wake is armed and delivered through the wake handlers.
    const deliver = async () => {
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      return deliverSchedulerWakes(t.h.store, createWebWakeHandlers({ ...t.dispatch, service }));
    };
    return { t, service, first, clock, work, runsOf, deliver };
  }

  it("switches it before the claim, records the switch, and its one run is on the other installation", async () => {
    const w = await pair(); try {
      expect(installationRests(w.t.h.store, w.clock.value).has("codex")).toBe(true);
      expect(w.work("b").agent.agent).toBe("codex");
      expect(w.runsOf("b")).toEqual([]);
      await w.deliver();
      expect(w.work("b").agent.agent).toBe("claude");
      expect(w.work("b").agentProvenance.agent).toBe("failover");
      expect(w.work("b").agentSwitches).toEqual([expect.objectContaining({ afterRunId: null, by: "orca-auto", reason: "rest", previous: expect.objectContaining({ agent: expect.objectContaining({ agent: "codex" }) }) })]);
      // No run was spent on codex: b's only run is claude's, stamped after the switch.
      expect(w.runsOf("b").map((run) => [run.agent.agent, run.agentEpoch])).toEqual([["claude", 1]]);
      expect(() => readConfirmedTaskExecution(w.t.h.store, "g", "b")).not.toThrow();
      expect(readControlGroup(w.t.h.store, "route-test", "g").runs.map((run) => run.runId)).toContain(w.runsOf("b")[0]!.id);
      // Not a retry: nothing booked in the command ledger for it.
      expect(w.t.h.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE json_extract(body_json,'$.verb')='retry-task'").get()!.n).toBe(0);
    } finally { await w.t.h.dispose(); }
  });

  it("leaves a plan-named agent (D2), an installation that is not resting or set to wait, a held group, and a task that has run", async () => {
    const pinned = await pair({ bAgent: { agent: "codex" } }); try {
      await pinned.deliver();
      expect(pinned.work("b").agentSwitches).toBeUndefined();
      expect(pinned.runsOf("b").map((run) => run.agent.agent)).toEqual(["codex"]);
    } finally { await pinned.t.h.dispose(); }
    const auth = await pair({ cause: "auth" }); try {
      await auth.deliver();
      expect(auth.runsOf("b").map((run) => run.agent.agent)).toEqual(["codex"]);
    } finally { await auth.t.h.dispose(); }
    const waits = await pair(); try {
      expect("error" in (waits.service.setOrchestrationSettings(waits.t.h.rawCommand("wait", Number(waits.t.h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0),
        "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, quotaWait: ["codex"] }) as never) as object)).toBe(false);
      await waits.deliver();
      expect(waits.runsOf("b").map((run) => run.agent.agent)).toEqual(["codex"]);
    } finally { await waits.t.h.dispose(); }
    const held = await pair(); try {
      held.t.h.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.mode','hold') WHERE group_id='g'").run();
      await held.deliver();
      expect(held.runsOf("b").map((run) => run.agent.agent)).toEqual(["codex"]);
    } finally { await held.t.h.dispose(); }
    // A task that has run is failoverPass's (after its own quota failure), not this route's: a's plain retry is claimed on
    // codex, and ccloop is not asked to resolve anything for it.
    let resolved = 0;
    const ran = await pair({ port: (base) => ({ ...base, resolveAgent: async (partial: PartialSelection) => { resolved += 1; return base.resolveAgent(partial); } }) }); try {
      expect("error" in (ran.service.retryTask(ran.t.h.command("retry-task", { taskId: "a" })) as object)).toBe(false);
      resolved = 0;
      await ran.deliver();
      expect(ran.runsOf("a").map((run) => run.agent.agent)).toEqual(["codex", "codex"]);
      expect(ran.work("a").agentSwitches).toBeUndefined();
      expect(resolved).toBe(0);
    } finally { await ran.t.h.dispose(); }
  });

  it("a claim that lands while ccloop is asked leaves the task as it now is (re-read in the switch's transaction)", async () => {
    let racing = true;
    const w = await pair({ port: (base, claim) => ({ ...base, resolveAgent: async (partial: PartialSelection) => {
      // The driver claims b on codex while the route waits for ccloop.
      if (racing && partial.agent === "claude") { racing = false; await claim(); }
      return base.resolveAgent(partial);
    } }) }); try {
      await w.deliver();
      expect(racing).toBe(false);
      expect(w.work("b").agentSwitches).toBeUndefined();
      expect(w.runsOf("b").map((run) => run.agent.agent)).toEqual(["codex"]);
    } finally { await w.t.h.dispose(); }
  });
});

describe("a failover refused recovery-blocked is booked and not tried again (session 3cfc2e73)", { timeout: 120_000 }, () => {
  // The 2026-11-05 plan registered "a recovery-blocked refusal is not booked by the command ledger, so such a failover is
  // re-attempted every pass". Measured in session 3cfc2e73: recovery-blocked is a durable command outcome (errors.ts), so
  // the refusal is booked (423) under the run's failover id and failoverCandidates leaves the run, as for any answer. A store
  // that disagrees with itself needs a person; the person's retry is a new run, which failover reads afresh.
  it("books the refusal: the next pass asks ccloop nothing and logs nothing", async () => {
    const w = await world(); try {
      let resolved = 0;
      const port = { ...w.t.h.deps.port, resolveAgent: async (partial: PartialSelection) => { resolved += 1; return w.t.h.deps.port.resolveAgent(partial); } };
      const service = new WebControlService({ ...w.t.h.deps, port, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => w.t.repo });
      // The work item no longer carries what its run was claimed with (I1): the retry is refused recovery-blocked.
      w.t.h.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.configHash',?) WHERE group_id='g' AND id='a'").run("e".repeat(64));
      const written: string[] = [];
      const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { written.push(String(chunk)); return true; });
      try {
        await service.systemDebugPass();
        expect(resolved).toBe(1);
        const row = w.t.h.store.db.prepare("SELECT original_status, body_json FROM commands WHERE group_id='g' AND id=?").get(failoverCommandId("a", w.runId));
        expect(row?.original_status).toBe(423);
        expect(JSON.parse(String(row?.body_json)).error).toMatchObject({ code: "recovery-blocked", message: "recovery-blocked:retry-identity" });
        await service.systemDebugPass();
        expect(resolved).toBe(1);
        expect(written.filter((line) => line.includes("failover"))).toEqual([]);
      } finally { spy.mockRestore(); }
      expect(w.work().agent.agent).toBe("codex");
    } finally { await w.t.h.dispose(); }
  });
});
