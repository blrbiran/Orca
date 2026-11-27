import { describe, expect, it } from "vitest";
import { collectInto } from "../../src/control/executionDriver.js";
import type { ExecutionPort, ExecutionReport } from "../../src/control/executionPort.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/** ccloop's provisional Codex response watermark, not a usage event. */
const reading = (runId: string, revision = 1, tokens = 125): NonNullable<ExecutionReport["liveUsage"]> => ({
  schema: "ccloop-live-usage-v1", runId, attempt: 1, phase: "execute", callId: "call-1",
  threadId: "01a1da57-817e-7450-907a-f3a3f0371154", tokens, observedAt: new Date().toISOString(), revision,
});

async function inFlight() {
  let observation: ExecutionReport["liveUsage"];
  let terminal: ExecutionReport["terminal"] = null;
  let usageLowerBound: ExecutionReport["usageLowerBound"];
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable-silent", wrapPort: (port: ExecutionPort) => ({
    ...port,
    collect: async (input, afterSeq) => ({ ...await port.collect(input, afterSeq), ...(observation === undefined ? {} : { liveUsage: observation }), ...(terminal === null ? {} : { terminal, ...(usageLowerBound === undefined ? {} : { usageLowerBound }) }) }),
  }) });
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "accepted");
  return { t, driver, runId, set: (value: ExecutionReport["liveUsage"]) => { observation = value; },
    stop: (value: ExecutionReport["terminal"], floor?: ExecutionReport["usageLowerBound"]) => { terminal = value; usageLowerBound = floor; observation = undefined; } };
}

describe("Codex's running response usage (#285)", () => {
  it("stores a matching reading without booking it as work or changing the group budget", async () => {
    const { t, driver, runId, set } = await inFlight(); try {
      const budget = readControlGroup(t.h.store, "epoch", "g").ledger.used.tokens;
      set(reading(runId));
      await driver.round();
      expect(t.body(runId).liveUsage).toMatchObject({ runId, phase: "execute", tokens: 125, revision: 1 });
      // The view carries it as provisional while the run is under way; the booked figure is untouched.
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)?.liveUsage)
        .toMatchObject({ phase: "execute", tokens: 125, attempt: 1, revision: 1 });
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE run_id=?").get(runId)).toEqual({ n: 0 });
      expect(readControlGroup(t.h.store, "epoch", "g").ledger.used.tokens).toBe(budget);
      set(undefined);
      await driver.round();
      expect(t.body(runId)).not.toHaveProperty("liveUsage");
    } finally { await t.h.dispose(); }
  });

  it("keeps a newer watermark when an older collect answer arrives for the same call", async () => {
    const { t, driver, runId, set } = await inFlight(); try {
      set(reading(runId, 2, 300));
      await driver.round();
      set(reading(runId, 1, 125));
      await driver.round();
      expect(t.body(runId).liveUsage).toMatchObject({ revision: 2, tokens: 300 });
    } finally { await t.h.dispose(); }
  });

  it.each([
    { outcome: "failed", matches: true },
    { outcome: "failed", matches: false },
    { outcome: "exhausted", matches: true },
    { outcome: "exhausted", matches: false },
  ] as const)("retains a last response for a terminal $outcome stall only when the phase matches ($matches, #520)", async ({ outcome, matches }) => {
    const { t, driver, runId, set, stop } = await inFlight(); try {
      set(reading(runId));
      await driver.round();
      expect(t.body(runId)).toHaveProperty("liveUsage.tokens", 125);
      stop({ outcome, attemptSha: null, sourceDir: t.repo, repoDir: null, currentAttempt: 1,
        failureCause: { cause: "stalled", phase: matches ? "execute" : "verify", retries: 0, detail: "fixture stall" } });
      await collectInto(t.deps, t.body(runId));
      const collected = t.body(runId);
      if (matches) expect(collected).toHaveProperty("liveUsage.tokens", 125);
      else expect(collected).not.toHaveProperty("liveUsage");
      expect(collected).not.toHaveProperty("usageLowerBound");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE run_id=?").get(runId)).toEqual({ n: 0 });
      // Model the terminal drive's stored projection independently of candidate/stop-proof handling.
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...collected, state: "blocked",
        drive: { ...collected.drive, outcome, finalAttempt: 1, blockedAt: "C", blockedReason: `terminal:${outcome}`,
          failureCause: { cause: "stalled", phase: matches ? "execute" : "verify", retries: 0, detail: "fixture stall" } } }), runId);
      const projected = readControlGroup(t.h.store, "epoch", "g").runs.find((entry) => entry.runId === runId);
      expect(projected).toHaveProperty("outcome", outcome);
      if (matches) expect(projected).toHaveProperty("liveUsage.tokens", 125);
      else expect(projected).not.toHaveProperty("liveUsage");
    } finally { await t.h.dispose(); }
  });

  it("prefers the worker's terminal floor to an earlier response sample (#520)", async () => {
    const { t, driver, runId, set, stop } = await inFlight(); try {
      set(reading(runId));
      await driver.round();
      expect(t.body(runId)).toHaveProperty("liveUsage.tokens", 125);
      stop({ outcome: "failed", attemptSha: null, sourceDir: t.repo, repoDir: null, currentAttempt: 1,
        failureCause: { cause: "stalled", phase: "execute", retries: 0, detail: "fixture stall" } }, { tokens: 400 });
      await collectInto(t.deps, t.body(runId));
      expect(t.body(runId)).toHaveProperty("usageLowerBound.tokens", 400);
      expect(t.body(runId)).not.toHaveProperty("liveUsage");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE run_id=?").get(runId)).toEqual({ n: 0 });
    } finally { await t.h.dispose(); }
  });

  it("rejects another run's reading before retaining it", async () => {
    const { t, runId, set } = await inFlight(); try {
      set(reading("run-foreign"));
      await expect(collectInto(t.deps, t.body(runId))).rejects.toMatchObject({ code: "report-identity-conflict" });
      expect(t.body(runId)).not.toHaveProperty("liveUsage");
    } finally { await t.h.dispose(); }
  });
});
