import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA, buildEstimatePrompt } from "../../src/control/estimatePrompt.js";
import { driverRunIds, stepA1 } from "../../src/control/executionDriver.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { isEstimateRun } from "../../src/control/webDispatch.js";
import { workspacePathOf } from "../../src/control/workspace.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness, estimateOutput } from "./fixtures/estimateHarness.js";

// Single-call estimate spec §6.1-§6.4: an estimate run is the driver's, runs as one ccloop single call, and settles
// into its estimate. The harness and its synthetic single-call ccloop live in fixtures/estimateHarness.ts.
describe("Task 0 item 4: an estimate run after A1 and booked usage (single-call estimate spec §8.1)", () => {
  it("reserves its attempt at A1 and then satisfies completeEstimate's conservation guard", async () => {
    const x = await estimateHarness(); try {
      expect(stepA1(x.deps, x.runId)).toBe(true);
      expect(x.body()).toMatchObject({ state: "start-pending", providerAttemptOrdinal: 1 });
      recordUsage(x.h.store, { runId: x.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1_234, activeMs: 50, attempts: 1, sessions: 1 }, source: { artifactId: "usage-t0", hash: "e".repeat(64) } });
      expect(x.body().remaining.work).toEqual({ tokens: 250_000 - 1_234, activeMs: 900_000 - 50, attempts: 0, sessions: 0 });
      // The call gave nothing (null): completeEstimate must still get past every conservation check to record that.
      x.service.completeEstimate("g", x.h.estimateId, null, () => {
        const row = x.body(); row.state = "settled-restartable";
        x.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), x.runId);
      });
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-call-failed" });
      expect(x.active()).toBe(0);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(1_234);
    } finally { await x.h.dispose(); }
  });
});

describe("the estimate chain (single-call estimate spec §6.1-§6.3)", () => {
  it("drives an estimate run from starting to a ready estimate through one single call, with no workspace", async () => {
    const x = await estimateHarness(); try {
      expect(isEstimateRun(x.h.store, x.runId)).toBe(true);
      expect(driverRunIds(x.h.store)).toEqual([x.runId]);
      await x.rounds(() => x.estimate().state !== "running");
      const plan = readArchivedPlan(x.h.store, "g");
      expect(x.estimate()).toMatchObject({ state: "ready", reasonCode: null, output: estimateOutput(plan.planHash), outputHash: sha256Canonical(estimateOutput(plan.planHash)) });
      expect(x.body()).toMatchObject({ state: "settled-restartable", cumulative: { work: { tokens: 777, activeMs: 5, attempts: 1, sessions: 1 } }, unknown: { work: false } });
      expect(x.active()).toBe(0);
      expect(driverRunIds(x.h.store)).toEqual([]);
      // Exactly one accept, and the envelope is the single call Orca assembled: the prompt byte for byte, the
      // hand-written schema, the frozen output cap, no checkpoint.
      expect(x.fake.calls.accept).toHaveLength(1);
      const sent = x.fake.calls.accept[0]!;
      const request = x.estimate().request!;
      expect(sent).toMatchObject({ protocol: 3, inputCheckpoint: null, claim: { runId: x.runId, taskId: null, workItemId: x.h.estimateId } });
      expect(sent.work).toEqual({ kind: "single-call", prompt: buildEstimatePrompt("1", canonicalBytes(request).toString("utf8")), responseSchema: BUDGET_ESTIMATE_JSON_SCHEMA, maxOutputTokens: 64_000, sourceDir: x.body().drive.sourceDir });
      // No workspace, recorded or on disk.
      expect(x.body().drive.workspacePath).toBeNull();
      expect(existsSync(workspacePathOf(x.deps.roots, x.runId))).toBe(false);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(777);
    } finally { await x.h.dispose(); }
  });

  it("blocks the run and settles nothing when ccloop's call record names another prompt", async () => {
    const x = await estimateHarness({ tamper: "prompt" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "single-call-prompt-mismatch" });
      expect(x.estimate().state).toBe("running");
      expect(x.active()).toBe(1);
    } finally { await x.h.dispose(); }
  });

  it("blocks as estimate-usage-unknown, not in a retry loop, when an aborted call observed no usage", async () => {
    const x = await estimateHarness({ outcome: "aborted", tokens: null }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown" });
      expect(x.body().state).toBe("blocked");
      expect(x.estimate().state).toBe("running");
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.usageUnknown).toBe(true);
      const collects = x.fake.calls.collect;
      await x.driver.round();
      expect(x.fake.calls.collect).toBe(collects);
    } finally { await x.h.dispose(); }
  });

  // Controller ruling (2026-09-28): a call that failed with no usage books a null work cumulative too, and must land in
  // the same named block -- not a C retry every round.
  it("blocks as estimate-usage-unknown, not in a retry loop, when a failed call observed no usage", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown" });
      expect(x.estimate().state).toBe("running");
      expect(x.body().unknown.work).toBe(true);
      const collects = x.fake.calls.collect;
      await x.driver.round();
      expect(x.fake.calls.collect).toBe(collects);
      expect(x.body().state).toBe("blocked");
    } finally { await x.h.dispose(); }
  });

  it.each([
    ["a call that failed", { outcome: "failed" as const }, "estimate-call-failed"],
    ["an answer for another plan", { output: () => estimateOutput("f".repeat(64)) }, "estimate-output-plan-mismatch"],
    ["an answer that is not an estimate", { output: () => ({ schema: "budget-estimate-v1" }) }, "estimate-output-invalid"],
  ])("fails the estimate with its reason through the driver: %s", async (_label, options, reasonCode) => {
    const x = await estimateHarness(options); try {
      await x.rounds(() => x.estimate().state !== "running");
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode, output: null });
      expect(x.body().state).toBe("settled-restartable");
    } finally { await x.h.dispose(); }
  });

  it("is not an estimate run when its claim row names another run", async () => {
    const x = await estimateHarness(); try {
      const id = `estimate:g:${x.h.estimateId}`;
      const claim = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id)!.body));
      x.h.store.db.prepare("UPDATE outbox SET body=? WHERE id=?").run(JSON.stringify({ ...claim, runId: "run-other" }), id);
      expect(isEstimateRun(x.h.store, x.runId)).toBe(false);
      expect(driverRunIds(x.h.store)).toEqual([]);
    } finally { await x.h.dispose(); }
  });
});
