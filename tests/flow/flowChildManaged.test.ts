/**
 * Flow engine spec §6.2, §9.6 (review finding C1): a `work` step's hidden child is the kernel's, not the escalation
 * ladder's. orca-auto confirms the child (group_orchestration mode `run`) and its plan carries a repository id, so without
 * an exclusion a failed child -- e.g. the `to-draft-box` effect step failing after the draft was already created -- would
 * be re-dispatched by ladder level 1, get a ladder debug group, or be retried by a quota wait: the effect could run twice
 * (§9.6: a failed effect is not retried until the person retries, as a new execution with a new record). The retry verbs
 * on such a child are refused `flow-child-managed`: the person retries the step through the run, not the child.
 */
import { describe, expect, it } from "vitest";
import { ladderCandidates, quotaWaitCandidates, QUOTA_REPROBE_MS } from "../../src/control/systemDebug.js";
import { WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

async function world(cause: string, flowChild: boolean) {
  const clock = { value: 1_000_000 };
  const t = await driverHarness([{ taskId: "a" }], {
    storeNow: () => clock.value,
    behaviour: () => "failed",
    failure: () => ({ failureCause: { cause, phase: "execute", retries: 0, detail: null } }),
  });
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  // The group as the child port leaves an effect step's child: the `flow` child block beside its plan.
  if (flowChild) {
    t.h.store.db.prepare("UPDATE groups SET body=json_set(body,'$.flow',json(?)) WHERE id='g'").run(JSON.stringify({
      role: "child", flowRunId: "fr-1", parentGroupId: "flow-1", stepKey: "to-draft-box", seq: 1, baseCommit: "a".repeat(40), effectRecordId: "eff-1",
    }));
  }
  const installation = (t.body(runId) as { agent: { agent: string } }).agent.agent;
  const verbs = () => t.h.store.db.prepare("SELECT id FROM commands WHERE group_id='g' AND json_extract(body_json,'$.verb') IN ('retry-task','recovery-retry','continue-task')").all().map((r) => String(r.id));
  return { t, service, runId, clock, installation, verbs };
}

describe("a failed flow child stays with the kernel (C1)", { timeout: 120_000 }, () => {
  it("is no ladder candidate, gets no level-1 re-dispatch and no ladder debug group", async () => {
    const w = await world("required-check-failed", true); try {
      expect(ladderCandidates(w.t.h.store)).toEqual([]);
      const pass = await w.service.systemDebugPass();
      expect(pass.redispatched).toEqual([]);
      expect(pass.opened).toEqual([]);
      expect(w.verbs()).toEqual([]);
      expect(w.t.h.store.db.prepare("SELECT count(*) AS n FROM groups WHERE json_extract(body,'$.systemDebug') IS NOT NULL").get()).toMatchObject({ n: 0 });
    } finally { await w.t.h.dispose(); }
  });

  it("the same failure on a plain group is a ladder candidate (the exclusion is the flow block, nothing else)", async () => {
    const w = await world("required-check-failed", false); try {
      expect(ladderCandidates(w.t.h.store).map((c) => c.groupId)).toEqual(["g"]);
    } finally { await w.t.h.dispose(); }
  });

  it("is not retried by a quota wait", async () => {
    const w = await world("quota", true); try {
      expect(quotaWaitCandidates(w.t.h.store, new Set([w.installation]), w.clock.value + QUOTA_REPROBE_MS)).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });

  it("refuses retry-task, recovery-retry and continue-task with flow-child-managed", async () => {
    const w = await world("required-check-failed", true); try {
      const retry = w.service.retryTask(w.t.h.command("retry-task", { taskId: "a" })) as { error?: { code: string } };
      expect(retry.error?.code).toBe("flow-child-managed");
      const recovery = await w.service.recoveryRetry(w.t.h.command("recovery-retry", { scope: "group", groupId: "g" })) as { error?: { code: string } };
      expect(recovery.error?.code).toBe("flow-child-managed");
      const runScoped = await w.service.recoveryRetry(w.t.h.runCommand("recovery-retry", w.runId, { scope: "run", runId: w.runId })) as { error?: { code: string } };
      expect(runScoped.error?.code).toBe("flow-child-managed");
      const cont = await w.service.continueTask(w.t.h.taskCommand("continue-task", "a", { predecessorRunId: w.runId, checkpointId: "cp-1" })) as { error?: { code: string } };
      expect(cont.error?.code).toBe("flow-child-managed");
    } finally { await w.t.h.dispose(); }
  });
});
