import { describe, expect, it } from "vitest";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

// Tester #265: a run ccloop stopped with `allowlist miss: README.md` read `diagnosis.cause: unknown` in --json and the card's
// first failure named no next step, though run show's text already printed the --allow-observed-paths retry. The
// diagnosis now says `path-policy`, and the card names that retry.
const MISSES = [{ repoKey: null, path: "README.md" }];

describe("an allowlist miss is diagnosed as path-policy and the card names the retry (#265)", () => {
  it("diagnosis.cause is path-policy with reported misses, unknown without", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const run = (drive: Record<string, unknown>) => ({ groupId: "g", workItemId: "a", taskId: "a", runId: "rp", generation: 1, graphVersion: 1, targetVersion: 1, executionId: null,
        phase: "work" as const, progress: null, providerAttemptOrdinal: 1, failureCode: null, drive });
      expect(readRunDiagnosis(h.store, run({ pathPolicyMisses: MISSES })).cause).toBe("path-policy");
      expect(readRunDiagnosis(h.store, run({ pathPolicyMisses: [] })).cause).toBe("unknown");
      expect(readRunDiagnosis(h.store, run({})).cause).toBe("unknown");
    } finally { await h.dispose(); }
  });

  it("the card's first failure names orca task retry --allow-observed-paths", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, currentRunId: "rp" }));
      const run = (drive: Record<string, unknown>) => JSON.stringify({ state: "blocked", failureCode: null, drive: { blockedAt: "C", outcome: "blocked_waiting_human", blockedReason: "terminal:blocked_waiting_human", stopReason: "allowlist miss: README.md", ...drive } });
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('rp','g','a',1,1,?)").run(run({ pathPolicyMisses: MISSES }));
      expect(readGroupSummary(h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "terminal:blocked_waiting_human", next: "orca task retry g a --allow-observed-paths" });
      h.store.db.prepare("UPDATE runs SET body=? WHERE id='rp'").run(run({}));
      expect(readGroupSummary(h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "terminal:blocked_waiting_human" });
    } finally { await h.dispose(); }
  });
});
