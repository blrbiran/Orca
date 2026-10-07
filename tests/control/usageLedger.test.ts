import { describe, expect, it } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { recordUsage } from "../../src/control/usage.js";
import { bookReconcileUsage, groupRepoIdOf, usageSource } from "../../src/control/usageLedger.js";
import { ccloopCollectionSchema, ccloopResolutionSchema } from "../../src/control/ccloopPort.js";
import { openTestStore, seedBudgetCase, amount } from "./fixtures/store.js";
import { driverHarness } from "./fixtures/driverHarness.js";

const rows = (h: { store: { db: import("node:sqlite").DatabaseSync } }) =>
  h.store.db.prepare("SELECT applied_at,run_id,source,model,input,output,cache_read,cache_write,tokens,quality FROM usage_ledger WHERE source<>'pre-ledger' ORDER BY id").all();
const m = (model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ model, input, output, cacheRead, cacheWrite });

describe("the usage ledger (spec §5.1, D7, D16, D18)", () => {
  it("books one row per model per applied delta, in the usage transaction, at the store clock", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(65, 1, 1, 1), byModel: [m("haiku", 10, 5), m("opus", 30, 10, 8, 2)] }, 5_000);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(75, 2, 1, 1), byModel: [m("haiku", 10, 5), m("opus", 35, 15, 8, 2)] }, 6_000);
      expect(rows(h)).toEqual([
        { applied_at: 5_000, run_id: c.runId, source: "run-work", model: "haiku", input: 10, output: 5, cache_read: 0, cache_write: 0, tokens: 15, quality: "reported" },
        { applied_at: 5_000, run_id: c.runId, source: "run-work", model: "opus", input: 30, output: 10, cache_read: 8, cache_write: 2, tokens: 50, quality: "reported" },
        { applied_at: 6_000, run_id: c.runId, source: "run-work", model: "opus", input: 5, output: 5, cache_read: 0, cache_write: 0, tokens: 10, quality: "reported" },
      ]);
      // Each row names its group and the group's repository (here the group's projectKey, the COALESCE's last arm).
      expect(h.store.db.prepare("SELECT DISTINCT group_id,repo_id FROM usage_ledger WHERE source<>'pre-ledger'").all()).toEqual([{ group_id: "g1", repo_id: "example/repo" }]);
      // A replayed event books nothing twice.
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(75, 2, 1, 1), byModel: [m("haiku", 10, 5), m("opus", 35, 15, 8, 2)] }, 7_000);
      expect(rows(h)).toHaveLength(3);
    } finally { await h.dispose(); }
  });

  it("books an event without a breakdown (absent or null) as one unattributed row, and a zero delta as none", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(20, 1, 1, 1) }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(20, 2, 1, 1), byModel: null }, 2);
      recordUsage(h.store, { ...e, eventSeq: 3, cumulative: null }, 3);
      expect(rows(h)).toEqual([{ applied_at: 1, run_id: c.runId, source: "run-work", model: null, input: null, output: null, cache_read: null, cache_write: null, tokens: 20, quality: "unattributed" }]);
    } finally { await h.dispose(); }
  });

  it("an unattributed event makes later breakdowns of the same bucket unattributed (unknown baseline)", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(20, 1, 1, 1) }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(50, 2, 1, 1), byModel: [m("opus", 40, 10)] }, 2);
      expect(rows(h).map((r) => [r.model, r.tokens, r.quality])).toEqual([[null, 20, "unattributed"], [null, 30, "unattributed"]]);
    } finally { await h.dispose(); }
  });

  it("a breakdown that does not reconcile keeps an authoritative total row and flags the per-model rows", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      recordUsage(h.store, { runId: c.runId, generation: 1, bucket: "work", source: s.usageRef, eventSeq: 1, cumulative: amount(40, 1, 1, 1), byModel: [m("opus", 30, 20)] }, 1);
      expect(rows(h).map((r) => [r.model, r.tokens, r.quality])).toEqual([[null, 40, "unattributed"], ["opus", 50, "breakdown-mismatch"]]);
    } finally { await h.dispose(); }
  });

  it("a model that disappears from a later breakdown, or a count that goes down, is not attributed (ccloop: never fall back)", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(30, 1, 1, 1), byModel: [m("haiku", 10, 0), m("opus", 20, 0)] }, 1);
      // Reconciles (40), but haiku is gone: the per-model delta is unknowable.
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(40, 2, 1, 1), byModel: [m("opus", 40, 0)] }, 2);
      expect(rows(h).map((r) => [r.applied_at, r.model, r.tokens, r.quality])).toEqual([
        [1, "haiku", 10, "reported"], [1, "opus", 20, "reported"], [2, null, 10, "unattributed"], [2, "opus", 20, "breakdown-mismatch"],
      ]);
      // Reconciles (50) against event 2's opus 40, but input went down: unattributed, and no negative per-model row.
      recordUsage(h.store, { ...e, eventSeq: 3, cumulative: amount(50, 3, 1, 1), byModel: [m("opus", 30, 20)] }, 3);
      expect(rows(h).filter((r) => r.applied_at === 3).map((r) => [r.model, r.tokens, r.quality])).toEqual([[null, 10, "unattributed"]]);
    } finally { await h.dispose(); }
  });

  it("the driver books what it collects at its own clock; a peer without byModel books one unattributed row, a zero delta none", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      t.deps.now = () => new Date(1_234_000);
      const runId = await t.claim(); const driver = t.driver();
      // The synthetic ccloop reports work 10 and handoff 0, neither with a breakdown.
      await t.until(driver, () => t.body(runId).highWater >= 2);
      expect(rows(t.h).map((r) => [r.applied_at, r.run_id, r.source, r.model, r.tokens, r.quality])).toEqual([[1_234_000, runId, "run-work", null, 10, "unattributed"]]);
    } finally { await t.h.dispose(); }
  });

  it("books a reconciliation's spend as its run's work, unattributed, and nothing for 0 (D16)", async () => {
    const h = await openTestStore(); try {
      const body = { projectKey: "example/repo" };
      bookReconcileUsage(h.store, { runId: "run-r", groupId: "g1", groupBody: body, tokens: 0, appliedAt: 1 });
      bookReconcileUsage(h.store, { runId: "run-r", groupId: "g1", groupBody: body, tokens: 7, appliedAt: 2 });
      expect(rows(h).map((r) => [r.applied_at, r.run_id, r.source, r.model, r.tokens, r.quality])).toEqual([[2, "run-r", "run-work", null, 7, "unattributed"]]);
    } finally { await h.dispose(); }
  });

  it("names the source from the run's phase and purpose (D15)", () => {
    expect([usageSource({ phase: "work" }, "work"), usageSource({ phase: "work" }, "handoff"), usageSource({}, "work"), usageSource({ phase: "estimate" }, "work"),
      usageSource({ phase: "single-call", purpose: "clarify" }, "work"), usageSource({ phase: "single-call", purpose: "split" }, "work")])
      .toEqual(["run-work", "run-handoff", "run-work", "estimate", "clarify", "split"]);
  });

  it("reads a group's repository as the migration does: plan, then requirement, then projectKey, skipping empty strings", () => {
    expect([
      groupRepoIdOf({ plan: { repoId: "p" }, requirement: { repoId: "r" }, projectKey: "k" }),
      groupRepoIdOf({ plan: { repoId: "" }, requirement: { repoId: "r" }, projectKey: "k" }),
      groupRepoIdOf({ requirement: { repoId: 7 }, projectKey: "k" }),
      groupRepoIdOf({}),
    ]).toEqual(["p", "r", "k", null]);
  });

  it("the ccloop port accepts byModel (absent, null or sorted entries) and usageBreakdown, and refuses an unsorted breakdown", () => {
    const event = { runId: "r", generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1, activeMs: 0, attempts: 0, sessions: 0 }, source: { artifactId: "a", hash: "a".repeat(64) } };
    const answer = (events: unknown[]) => ({ events, candidate: null, terminal: null });
    expect(ccloopCollectionSchema.safeParse(answer([event, { ...event, byModel: null }, { ...event, byModel: [m("a", 1, 0)] }])).success).toBe(true);
    expect(ccloopCollectionSchema.safeParse(answer([{ ...event, byModel: [m("b", 1, 0), m("a", 0, 0)] }])).success).toBe(false);
    // ccloop's order is JS code-unit order, not locale order: "Z" (0x5A) sorts before "a" (0x61).
    expect(ccloopCollectionSchema.safeParse(answer([{ ...event, byModel: [m("Z", 1, 0), m("a", 0, 0)] }])).success).toBe(true);
    expect(ccloopCollectionSchema.safeParse(answer([{ ...event, byModel: [m("a", 1, 0), m("a", 0, 0)] }])).success).toBe(false);
    expect(ccloopCollectionSchema.safeParse(answer([{ ...event, byModel: [] }])).success).toBe(false);
    expect(ccloopResolutionSchema.shape.usageBreakdown.safeParse("per-model").success).toBe(true);
    expect(ccloopResolutionSchema.shape.usageBreakdown.safeParse(undefined).success).toBe(true);
  });
});
