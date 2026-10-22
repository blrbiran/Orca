import { describe, expect, it } from "vitest";
import { ladderCandidates, quotaWaitCandidates, QUOTA_REPROBE_MS } from "../../src/control/systemDebug.js";
import { readOrchestrationSettings } from "../../src/control/orchestration.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Failure-cause spec 2026-10-21 §4-§5 (Orca side): ccloop's typed cause decides what Orca does with a failed task. A debug
 * run cannot fix credentials, quota or a missing program, so the escalation ladder leaves those tasks to the person; a quota
 * failure on an installation the person set to wait is retried by Orca after the re-probe interval instead. The cause also
 * reaches the run view (the next-step line) and the board card.
 */
async function world(cause: string) {
  const clock = { value: 1_000_000 };
  let failing = true;
  const t = await driverHarness([{ taskId: "a" }], {
    storeNow: () => clock.value,
    behaviour: (id) => (id === "a" && failing ? "failed" : "succeed"),
    failure: (id) => (id === "a" && failing ? { failureCause: { cause, phase: "plan", retries: 0, detail: null } } : undefined),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  let seq = 0;
  const setWait = (quotaWait: string[]) => service.setOrchestrationSettings(t.h.rawCommand(`settings-${++seq}`,
    Number(t.h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, quotaWait }) as never);
  const installation = (t.body(runId) as { agent: { agent: string } }).agent.agent;
  const retriedBy = () => t.h.store.db.prepare("SELECT id, actor_id FROM commands WHERE group_id='g' AND json_extract(body_json,'$.verb')='retry-task'").all().map((r) => [String(r.id), String(r.actor_id)]);
  return { t, service, runId, clock, setWait, installation, retriedBy, succeedNext: () => { failing = false; } };
}

describe("the escalation ladder leaves environment causes to the person (§4)", { timeout: 120_000 }, () => {
  for (const cause of ["auth", "quota", "executable-missing"]) {
    it(`does not escalate a task that failed with ${cause}`, async () => {
      const w = await world(cause); try {
        expect(ladderCandidates(w.t.h.store)).toEqual([]);
        expect((await w.service.systemDebugPass()).opened).toEqual([]);
      } finally { await w.t.h.dispose(); }
    });
  }
  // ccloop per-contract tool rules spec: a tool-rule violation is terminal there (no retry), and a debug run on the same
  // contract would break the same rule the same way -- the person decides (flow engine Task 10, controller call).
  it("does not escalate a task that failed with tool-rule-violated", async () => {
    const w = await world("tool-rule-violated"); try {
      expect(ladderCandidates(w.t.h.store)).toEqual([]);
      expect((await w.service.systemDebugPass()).opened).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });
  it("still escalates a task that failed its required check", async () => {
    const w = await world("required-check-failed"); try {
      expect(ladderCandidates(w.t.h.store).map((c) => [c.groupId, c.taskId, c.run.runId])).toEqual([["g", "a", w.runId]]);
    } finally { await w.t.h.dispose(); }
  });
});

describe("a quota wait retries the task after the re-probe interval (§5)", { timeout: 120_000 }, () => {
  it("is off by default, and on for the named installation only after the interval, retrying once as orca-auto", async () => {
    const w = await world("quota"); try {
      const later = () => { w.clock.value += QUOTA_REPROBE_MS; };
      // Off by default: nothing to retry even long after.
      later();
      expect(quotaWaitCandidates(w.t.h.store, new Set(readOrchestrationSettings(w.t.h.store).quotaWait ?? []), w.clock.value)).toEqual([]);
      // Another installation set to wait: still nothing.
      expect("error" in (w.setWait(["some-other-agent"]) as object)).toBe(false);
      expect(quotaWaitCandidates(w.t.h.store, new Set(readOrchestrationSettings(w.t.h.store).quotaWait!), w.clock.value)).toEqual([]);
      // This run's installation set to wait: the interval runs from its last activity, so a fresh block is not yet due.
      expect("error" in (w.setWait([w.installation, "some-other-agent", w.installation]) as object)).toBe(false);
      expect(readOrchestrationSettings(w.t.h.store).quotaWait).toEqual([w.installation, "some-other-agent"].sort());
      // The clock is QUOTA_REPROBE_MS past the block: one millisecond earlier is not yet due, exactly then is.
      expect(quotaWaitCandidates(w.t.h.store, new Set([w.installation]), w.clock.value - 1)).toEqual([]);
      expect(quotaWaitCandidates(w.t.h.store, new Set([w.installation]), w.clock.value)).toEqual([{ groupId: "g", taskId: "a", runId: w.runId }]);
      w.succeedNext();
      await w.service.systemDebugPass();
      expect(w.retriedBy()).toEqual([[`orca-auto-quota-retry-a-${w.runId}`, "orca-auto"]]);
      // The task is ready again; the failed run is no longer current, so nothing is due a second time.
      expect(quotaWaitCandidates(w.t.h.store, new Set([w.installation]), w.clock.value + QUOTA_REPROBE_MS)).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });

  it("does not wait on a cause other than quota", async () => {
    const w = await world("auth"); try {
      expect("error" in (w.setWait([w.installation]) as object)).toBe(false);
      expect(quotaWaitCandidates(w.t.h.store, new Set([w.installation]), w.clock.value + QUOTA_REPROBE_MS)).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });

  it("keeps the stored list when a later payload leaves it out, and a repeated list is a no-op", async () => {
    const w = await world("quota"); try {
      expect("error" in (w.setWait(["x"]) as object)).toBe(false);
      const same = w.setWait(["x"]) as { error?: { code: string } };
      expect(same.error?.code).toBe("no-op-command");
      const cap = w.service.setOrchestrationSettings(w.t.h.rawCommand("cap", Number(w.t.h.store.db.prepare("SELECT revision FROM orchestration_settings").get()!.revision), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 4 }) as never);
      expect("error" in (cap as object)).toBe(false);
      expect(readOrchestrationSettings(w.t.h.store)).toEqual({ maxRunningGroups: 4, quotaWait: ["x"] });
    } finally { await w.t.h.dispose(); }
  });
});

describe("the cause reaches the run view and the board card (§5)", { timeout: 120_000 }, () => {
  it("gives the run's cause to the run view, and the card names the typed cause first", async () => {
    const w = await world("rate-limited"); try {
      expect(readControlGroup(w.t.h.store, "epoch-test", "g").runs.find((run) => run.runId === w.runId)).toMatchObject({ failureCause: { cause: "rate-limited", phase: "plan", retries: 0, detail: null } });
      expect((readGroupSummary(w.t.h.store, "g") as { card?: { firstFailure: unknown } }).card?.firstFailure).toEqual({ taskId: "a", cause: "rate-limited" });
    } finally { await w.t.h.dispose(); }
  });
});
