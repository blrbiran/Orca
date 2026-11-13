// Tester follow-up J (#299): ccloop 9c83b38 names a provider 404 on the run's model `model-unavailable` (not retryable).
// Why it matters: the dogfood run failed as `unknown` and the same frozen model was retried until its attempts ran out.
// - the escalation ladder leaves the task to the person (no debug group, no retry-task by orca-auto), and Orca never
//   switches the model itself (failover ruling D2);
// - the group's first failure names the retry on another installation.
import { describe, expect, it } from "vitest";
import { ladderCandidates } from "../../src/control/systemDebug.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

describe("a run whose model the provider does not serve (#299)", { timeout: 120_000 }, () => {
  it("is not escalated or retried by Orca, and its first failure names task retry --agent", async () => {
    const t = await driverHarness([{ taskId: "a" }], {
      behaviour: () => "failed",
      failure: () => ({ failureCause: { cause: "model-unavailable", phase: "plan", retries: 0, detail: "unexpected status 404 Not Found" } }),
    }); try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      // mutation M1 (model-unavailable not in LADDER_EXEMPT_CAUSES) -> red here.
      expect(ladderCandidates(t.h.store)).toEqual([]);
      expect((await service.systemDebugPass()).opened).toEqual([]);
      expect(t.h.store.db.prepare("SELECT id FROM commands WHERE group_id='g' AND json_extract(body_json,'$.verb')='retry-task'").all()).toEqual([]);
      // mutation M2 (firstFailure names no next for model-unavailable) -> red here.
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "model-unavailable", next: "orca task retry g a --agent <installation>" });
    } finally { await t.h.dispose(); }
  });
});
