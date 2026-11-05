import { describe, expect, it } from "vitest";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { REST_DEFAULT_MS } from "../../src/control/quotaRest.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Quota failover spec 2026-11-03 §3 "Nothing to switch to ⇒ … the panel says 'codex is out of quota until 16:12'"
 * (session 3cfc2e73, batch FB): a person looking at a task that stopped on quota and that Orca could not move to another
 * installation must see until when it waits, not only a generic "quota used up". The run view carries the rest of the
 * run's installation -- only for the task's current run, only while it is still failed (a switch retries it), only for a
 * quota failure, and only while the rest lasts.
 */
/** The store clock; it does not move while the runs fail, so each run ends (its last activity) at T0. */
const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);

async function world(failures: Record<string, { cause: string; detail: string }>) {
  const clock = { value: T0 };
  const ids = Object.keys(failures);
  const t = await driverHarness(ids.map((taskId) => ({ taskId })), {
    storeNow: () => clock.value,
    behaviour: (id) => (id in failures ? "failed" : "succeed"),
    failure: (id) => (id in failures ? { failureCause: { cause: failures[id]!.cause, phase: "plan", retries: 0, detail: failures[id]!.detail } } : undefined),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const runs: Record<string, string> = {};
  for (const id of ids) {
    runs[id] = await t.claim();
    await t.until(t.driver(), () => t.body(runs[id]!).state === "blocked");
  }
  let orders = 0;
  const setOrder = (failoverOrder: string[]) => service.setOrchestrationSettings(t.h.rawCommand(`order-${++orders}`,
    Number(t.h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, failoverOrder }) as never);
  const runView = (runId: string) => readControlGroup(t.h.store, "epoch-test", "g").runs.find((run) => run.runId === runId)!;
  return { t, service, runs, clock, setOrder, runView };
}

describe("the task view says until when a quota-stopped task waits (§3)", { timeout: 120_000 }, () => {
  it("names the installation and the default rest's end while nothing can take the task, and drops it once switched", async () => {
    const w = await world({ a: { cause: "quota", detail: "You've hit your usage limit" } }); try {
      // Only codex in the order: nothing to switch to.
      expect("error" in (w.setOrder(["codex"]) as object)).toBe(false);
      await w.service.systemDebugPass();
      const run = w.runs.a!;
      expect(w.runView(run).quotaRest).toEqual({ installation: "codex", until: T0 + 15 * 60_000, source: "default" });
      // The rest is over: nothing to say any more.
      w.clock.value = T0 + REST_DEFAULT_MS + 1;
      expect(w.runView(run).quotaRest).toBeUndefined();
      w.clock.value = T0;
      // claude may take it: the task is switched and retried, and the failed run is no longer what it waits on.
      expect("error" in (w.setOrder(["codex", "claude"]) as object)).toBe(false);
      await w.service.systemDebugPass();
      expect(w.runView(run).quotaRest).toBeUndefined();
    } finally { await w.t.h.dispose(); }
  });

  it("takes the reset time the CLI named", async () => {
    const w = await world({ a: { cause: "quota", detail: "You've hit your usage limit … try again at 16:12" } }); try {
      expect("error" in (w.setOrder(["codex"]) as object)).toBe(false);
      const ended = new Date(T0);
      // The next 16:12 local time after the failure (12:00 UTC on 2026-11-05).
      let reset = new Date(ended.getFullYear(), ended.getMonth(), ended.getDate(), 16, 12).getTime();
      if (reset <= ended.getTime()) reset = new Date(ended.getFullYear(), ended.getMonth(), ended.getDate() + 1, 16, 12).getTime();
      expect(w.runView(w.runs.a!).quotaRest).toEqual({ installation: "codex", until: reset, source: "vendor" });
    } finally { await w.t.h.dispose(); }
  });

  it("says nothing about a rest for a task that stopped for another reason on a resting installation", async () => {
    const w = await world({ a: { cause: "quota", detail: "You've hit your usage limit" }, b: { cause: "auth", detail: "401" } }); try {
      expect("error" in (w.setOrder(["codex"]) as object)).toBe(false);
      // codex rests (task a's quota failure), and task b's run was on codex too.
      expect(w.runView(w.runs.a!).quotaRest?.installation).toBe("codex");
      expect((w.t.body(w.runs.b!) as { agent: { agent: string } }).agent.agent).toBe("codex");
      expect(w.runView(w.runs.b!).quotaRest).toBeUndefined();
    } finally { await w.t.h.dispose(); }
  });
});
