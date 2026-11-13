import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";
import { recordUsage } from "../../src/control/usage.js";
import { ledgerPhase } from "../../src/control/usageLedger.js";
import { readUsageView, runUsageDetail, usedTokens } from "../../src/control/usageQuery.js";
import type { ModelUsage } from "../../src/control/types.js";
import { groupUsageDetailLines, runUsageDetailLines } from "../../src/commands/domains/usageDetailLines.js";
import { findCommand } from "../../src/commands/registry.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { amount, openTestStore, seedBudgetCase } from "./fixtures/store.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Raw usage detail spec 2026-11-13 (tester follow-up J) §3, §5, §7, §8: the human, 「都要记录原始token，而不是等效token……
 * 还有具体的模型，这样之后才有机会换算成美元」 and 「有些项目不是must have，有就记录，没有就留空」. Each ledger row keeps
 * the sub-parts a later price step needs, null when the source did not report them; no figure that a budget, cap or pause
 * line compares changes. Temp stores only (Rule 17).
 */
type Harness = Awaited<ReturnType<typeof openTestStore>>;
const detail = (h: Harness) => h.store.db.prepare(`SELECT model,input,output,cache_read,cache_write,tokens,quality,reasoning,cache_write_5m,cache_write_1h,requests,
  max_request_input,phase,task_id,agent_kind,installation_id,basis FROM usage_ledger WHERE source<>'pre-ledger' ORDER BY id`).all();
const subParts = (h: Harness) => detail(h).map((r) => [r.model, r.reasoning, r.cache_write_5m, r.cache_write_1h, r.requests, r.max_request_input]);
const m = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number, extra: Partial<ModelUsage> = {}): ModelUsage => ({ model, input, output, cacheRead, cacheWrite, ...extra });

async function taskRun() {
  const h = await openTestStore();
  const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
  const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
  return { h, runId: c.runId, e };
}

describe("booking the detail (spec §5, §8.4, §8.5)", () => {
  it("delta's the sub-parts and requests like the four parts, keeps maxRequestInput as the event's own value, and annotates the row", async () => {
    const { h, runId, e } = await taskRun(); try {
      recordUsage(h.store, { ...e, eventSeq: 1, phase: "plan", cumulative: amount(50, 1, 1, 1),
        byModel: [m("opus", 30, 10, 8, 2, { reasoning: 4, cacheWrite5m: 1, cacheWrite1h: 1, requests: 3, maxRequestInput: 25 })] }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, phase: "execute", cumulative: amount(60, 1, 1, 1),
        byModel: [m("opus", 35, 15, 8, 2, { reasoning: 6, cacheWrite5m: 1, cacheWrite1h: 1, requests: 5, maxRequestInput: 12 })] }, 2);
      expect(detail(h)).toEqual([
        { model: "opus", input: 30, output: 10, cache_read: 8, cache_write: 2, tokens: 50, quality: "reported", reasoning: 4, cache_write_5m: 1, cache_write_1h: 1, requests: 3,
          max_request_input: 25, phase: "plan", task_id: "T1", agent_kind: null, installation_id: "codex", basis: null },
        // maxRequestInput 12 is this phase's own largest request: neither 12 - 25 nor max(25, 12) (§8.5).
        { model: "opus", input: 5, output: 5, cache_read: 0, cache_write: 0, tokens: 10, quality: "reported", reasoning: 2, cache_write_5m: 0, cache_write_1h: 0, requests: 2,
          max_request_input: 12, phase: "execute", task_id: "T1", agent_kind: null, installation_id: "codex", basis: null },
      ]);
      // Totals are the four parts; the sub-parts never add (D7).
      expect(usedTokens(h.store, "all", 1, null)).toBe(60);
      expect(runId).toMatch(/^run-/);
    } finally { await h.dispose(); }
  });

  it("a sub-part absent now, absent in the baseline, or absent at any earlier event of the run is null; a model new in the event starts at 0", async () => {
    const { h, e } = await taskRun(); try {
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(20, 1, 1, 1), byModel: [m("a", 10, 10, 0, 0, { requests: 1 })] }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(50, 1, 1, 1), byModel: [m("a", 20, 20, 0, 0, { reasoning: 5, requests: 2 }), m("b", 5, 5, 0, 0, { requests: 4, reasoning: 1 })] }, 2);
      recordUsage(h.store, { ...e, eventSeq: 3, cumulative: amount(70, 1, 1, 1), byModel: [m("a", 30, 30, 0, 0, { reasoning: 8, requests: 3 }), m("b", 5, 5, 0, 0, { requests: 4, reasoning: 1 })] }, 3);
      recordUsage(h.store, { ...e, eventSeq: 4, cumulative: amount(90, 1, 1, 1), byModel: [m("a", 40, 40, 0, 0), m("b", 5, 5, 0, 0, { requests: 4, reasoning: 1 })] }, 4);
      expect(subParts(h)).toEqual([
        ["a", null, null, null, 1, null], // reasoning never reported
        ["a", null, null, null, 1, null], // reasoning reported now, absent in the baseline
        ["b", 1, null, null, 4, null], // a model new in the event: its sub-parts from 0
        ["a", null, null, null, 1, null], // reasoning reported in event 2 and now, but absent in event 1: stays absent (§8.4)
        ["a", null, null, null, null, null], // requests absent now
      ]);
    } finally { await h.dispose(); }
  });

  it("a value over its bound -- in the event or in the delta -- is null, the row stays reported and its four parts are untouched", async () => {
    const { h, e } = await taskRun(); try {
      // reasoning 11 > output 10; 5m + 1h = 5 > cacheWrite 4; maxRequestInput 20 > 10 + 5 + 4.
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(29, 1, 1, 1),
        byModel: [m("x", 10, 10, 5, 4, { reasoning: 11, cacheWrite5m: 3, cacheWrite1h: 2, requests: 1, maxRequestInput: 20 })] }, 1);
      expect(detail(h).map((r) => [r.model, r.input, r.output, r.cache_read, r.cache_write, r.tokens, r.quality, r.reasoning, r.cache_write_5m, r.cache_write_1h, r.requests, r.max_request_input])).toEqual([
        ["x", 10, 10, 5, 4, 29, "reported", null, null, null, 1, null],
      ]);
    } finally { await h.dispose(); }
  });

  it("checks the delta's bounds, not only the event's", async () => {
    const { h, e } = await taskRun(); try {
      // In bound as cumulatives, out of bound as deltas: output +2 but reasoning +5; cacheWrite +1 but 5m + 1h +2.
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(20, 1, 1, 1), byModel: [m("y", 5, 10, 0, 5, { reasoning: 0, cacheWrite5m: 1, cacheWrite1h: 1 })] }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(23, 1, 1, 1), byModel: [m("y", 5, 12, 0, 6, { reasoning: 5, cacheWrite5m: 2, cacheWrite1h: 2 })] }, 2);
      expect(subParts(h)).toEqual([["y", 0, 1, 1, null, null], ["y", null, null, null, null, null]]);
      expect(detail(h).map((r) => [r.output, r.cache_write, r.quality])).toEqual([[10, 5, "reported"], [2, 1, "reported"]]);
    } finally { await h.dispose(); }
  });

  it("checks the event's bounds, not only the delta's: an event still over its bound is null even when its delta is not", async () => {
    const { h, e } = await taskRun(); try {
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(14, 1, 1, 1), byModel: [m("z", 0, 10, 0, 4, { reasoning: 11, cacheWrite5m: 3, cacheWrite1h: 2 })] }, 1);
      // Deltas: output +1, reasoning +1; cacheWrite +1, 5m + 1h +1 -- in bound; the event's 12 > 11 and 3 + 3 > 5 are not.
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(16, 1, 1, 1), byModel: [m("z", 0, 11, 0, 5, { reasoning: 12, cacheWrite5m: 3, cacheWrite1h: 3 })] }, 2);
      expect(subParts(h)).toEqual([["z", null, null, null, null, null], ["z", null, null, null, null, null]]);
    } finally { await h.dispose(); }
  });

  it("a handoff bucket's row is phase handoff; a work event without a phase has none; a breakdown-mismatch row carries no detail", async () => {
    const { h, e } = await taskRun(); try {
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(20, 1, 1, 1), byModel: [m("a", 10, 10, 0, 0, { requests: 1 })] }, 1);
      recordUsage(h.store, { ...e, bucket: "handoff", eventSeq: 2, cumulative: amount(4, 1, 1, 1), byModel: [m("a", 2, 2, 0, 0, { requests: 1 })] }, 2);
      // Does not reconcile (30 ≠ 25): an authoritative unattributed row and a flagged per-model row without detail.
      recordUsage(h.store, { ...e, eventSeq: 3, phase: "verify", cumulative: amount(30, 1, 1, 1), byModel: [m("a", 15, 10, 0, 0, { requests: 2 })] }, 3);
      expect(detail(h).map((r) => [r.model, r.quality, r.phase, r.requests])).toEqual([
        ["a", "reported", null, 1], ["a", "reported", "handoff", 1], [null, "unattributed", "verify", null], ["a", "breakdown-mismatch", "verify", null],
      ]);
    } finally { await h.dispose(); }
  });

  it("maps a run's phase and purpose to the ledger phase, guessing none", () => {
    expect([
      ledgerPhase({ phase: "work" }, "work", "execute"), ledgerPhase({ phase: "work" }, "handoff", "execute"), ledgerPhase({ phase: "estimate" }, "work", undefined),
      ledgerPhase({ phase: "single-call", purpose: "clarify" }, "work", undefined), ledgerPhase({ phase: "single-call", purpose: "split" }, "work", undefined),
      ledgerPhase({ phase: "single-call", purpose: "requirement-review" }, "work", undefined), ledgerPhase({ phase: "single-call", purpose: "flow-review" }, "work", undefined),
      ledgerPhase({ phase: "single-call", purpose: "quota-probe" }, "work", undefined), ledgerPhase({ phase: "work" }, "work", undefined),
    ]).toEqual(["execute", "handoff", "estimate", "clarify", "split", "review", "review", null, null]);
  });
});

describe("reading the detail (spec §2, §5 Readers)", () => {
  it("the usage view, the run view's lines and the group lines sum per model and phase; a part unknown on any summed row is null; totals unchanged", async () => {
    const { h, runId, e } = await taskRun(); try {
      recordUsage(h.store, { ...e, eventSeq: 1, phase: "plan", cumulative: amount(20, 1, 1, 1), byModel: [m("a", 10, 10, 0, 0, { reasoning: 3, requests: 1, maxRequestInput: 9 })] }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, phase: "execute", cumulative: amount(40, 1, 1, 1), byModel: [m("a", 20, 20, 0, 0, { reasoning: 5, requests: 2, maxRequestInput: 7 })] }, 2);
      // The phase-less event lacks requests and maxRequestInput: the model's whole sums of those are unknown.
      recordUsage(h.store, { ...e, eventSeq: 3, cumulative: amount(50, 1, 1, 1), byModel: [m("a", 25, 25, 0, 0, { reasoning: 6 })] }, 3);
      const view = readUsageView(h.store, { scope: "all", from: 1, to: null, groupBy: "model" }, 10);
      expect(view.range.tokens).toBe(50);
      expect(view.range.byModel).toEqual([{ model: "a", input: 25, output: 25, cacheRead: 0, cacheWrite: 0, tokens: 50, reasoning: 6, cacheWrite5m: null, cacheWrite1h: null, requests: null, maxRequestInput: null }]);
      const nil = { cacheWrite5m: null, cacheWrite1h: null };
      expect(view.range.byModelPhase).toEqual([
        { model: "a", phase: "execute", input: 10, output: 10, cacheRead: 0, cacheWrite: 0, tokens: 20, reasoning: 2, ...nil, requests: 1, maxRequestInput: 7 },
        { model: "a", phase: "plan", input: 10, output: 10, cacheRead: 0, cacheWrite: 0, tokens: 20, reasoning: 3, ...nil, requests: 1, maxRequestInput: 9 },
        { model: "a", phase: null, input: 5, output: 5, cacheRead: 0, cacheWrite: 0, tokens: 10, reasoning: 1, ...nil, requests: null, maxRequestInput: null },
      ]);
      const lines = runUsageDetail(h.store, runId);
      expect(lines.map((l) => [l.model, l.phase, l.tokens, l.reasoning, l.requests, l.maxRequestInput])).toEqual([["a", "plan", 20, 3, 1, 9], ["a", "execute", 20, 2, 1, 7], ["a", null, 10, 1, null, null]]);
      expect(runUsageDetailLines(lines)).toEqual([
        "usage by model and phase:",
        "  a (plan): 20 tokens -- input 10 / output 10 (reasoning 3) / cacheRead 0 / cacheWrite 0 (5m —, 1h —) / requests 1 / largest request input 9",
        "  a (execute): 20 tokens -- input 10 / output 10 (reasoning 2) / cacheRead 0 / cacheWrite 0 (5m —, 1h —) / requests 1 / largest request input 7",
        "  a (no phase): 10 tokens -- input 5 / output 5 (reasoning 1) / cacheRead 0 / cacheWrite 0 (5m —, 1h —) / requests — / largest request input —",
      ]);
      expect(runUsageDetailLines(undefined)).toEqual([]);
      // Two runs' lines: the sums add per model and phase, the largest request is the larger, an unknown stays unknown.
      const other = [{ model: "a", phase: "plan", tokens: 5, input: 5, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cacheWrite5m: null, cacheWrite1h: null, requests: 4, maxRequestInput: 11 },
        { model: null, phase: "handoff", tokens: 3, input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, cacheWrite5m: null, cacheWrite1h: null, requests: null, maxRequestInput: null }];
      expect(groupUsageDetailLines([{ usageDetail: lines }, { usageDetail: other }, {}])).toEqual([
        "group usage by model and phase (booked to its runs):",
        "  a (execute): 20 tokens -- input 10 / output 10 (reasoning 2) / cacheRead 0 / cacheWrite 0 (5m —, 1h —) / requests 1 / largest request input 7",
        "  a (plan): 25 tokens -- input 15 / output 10 (reasoning 3) / cacheRead 0 / cacheWrite 0 (5m —, 1h —) / requests 5 / largest request input 11",
        "  a (no phase): 10 tokens -- input 5 / output 5 (reasoning 1) / cacheRead 0 / cacheWrite 0 (5m —, 1h —) / requests — / largest request input —",
        "  unattributed (handoff): 3 tokens",
      ]);
      expect(groupUsageDetailLines([{}])).toEqual([]);
    } finally { await h.dispose(); }
  });
});

describe("the views carry the lines to run show and group show (spec §2)", () => {
  const def = (argv: string[]) => { const found = findCommand(argv); if (!("def" in found)) throw new Error(argv.join(" ")); return found.def; };
  const LINE = "  unattributed (no phase): 10 tokens";

  it("the run view gives usageDetail from the run's ledger rows; run show and group show print it", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim(); const driver = t.driver();
      // The synthetic ccloop reports work 10 without a breakdown or a phase.
      await t.until(driver, () => t.body(runId).highWater >= 2);
      const run = readControlGroup(t.h.store, "epoch-test", "g").runs.find((r) => r.runId === runId)!;
      expect(run.usageDetail).toEqual([{ model: null, phase: null, tokens: 10, input: null, output: null, cacheRead: null, cacheWrite: null,
        reasoning: null, cacheWrite5m: null, cacheWrite1h: null, requests: null, maxRequestInput: null }]);
      const shown = def(["run", "show"]).format({ groupId: "g", run, activity: { entries: [] }, evidence: { count: 0 } }).split("\n");
      expect(shown).toEqual(expect.arrayContaining(["usage by model and phase:", LINE]));
      const group = def(["group", "show"]).format({ schema: "orca-control-group-v1", summary: { groupId: "g" }, workItems: [], runs: [run, run] }).split("\n");
      expect(group).toEqual(expect.arrayContaining(["group usage by model and phase (booked to its runs):", "  unattributed (no phase): 20 tokens"]));
    } finally { await t.h.dispose(); }
  });
});

describe("guard: budgets, caps and pause lines still count tokens (spec §1, §7)", () => {
  it("what a cap or a group's budget counts is the booked tokens, whatever the sub-parts say", async () => {
    const { h, e } = await taskRun(); try {
      const used = () => (JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g1'").get()!.body)) as { used: { tokens: number } }).used.tokens;
      const before = used();
      // reasoning 9 of output 10, 5m 4 of cacheWrite 4, 7 requests: none of it may change what is counted.
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(30, 1, 1, 1), byModel: [m("a", 10, 10, 6, 4, { reasoning: 9, cacheWrite5m: 4, cacheWrite1h: 0, requests: 7, maxRequestInput: 20 })] }, 1);
      // Spend caps (spendCaps.ts) and the headline read usedTokens; the group's budget reads group.used.
      expect(usedTokens(h.store, "all", 1, null)).toBe(30);
      expect(readUsageView(h.store, { scope: "all", from: 1, to: null, groupBy: "model" }, 10).headline.total).toBe(usedTokens(h.store, "all", null, null));
      expect(readUsageView(h.store, { scope: "all", from: 1, to: null, groupBy: "model" }, 10).range.tokens).toBe(30);
      expect(used() - before).toBe(30);
    } finally { await h.dispose(); }
  });
});

describe("schema 23 -> 24: the ledger's detail columns", () => {
  it("a v23 store opens at 24 with the columns; existing rows keep every value and read NULL; one backup precedes the step", async () => {
    const root = await mkdtemp(join(tmpdir(), "s24-")), dir = join(root, "s");
    try {
      (await openControlStore({ stateDir: dir, now: () => 1000 })).close();
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      for (const column of ["reasoning", "cache_write_5m", "cache_write_1h", "requests", "max_request_input", "phase", "task_id", "agent_kind", "installation_id", "basis"]) raw.exec(`ALTER TABLE usage_ledger DROP COLUMN ${column}`);
      raw.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (5,'g','r','run-1','run-work','opus',1,2,3,4,10,'reported')").run();
      raw.prepare("UPDATE meta SET value='23' WHERE key='schemaVersion'").run();
      raw.close();
      const store = await openControlStore({ stateDir: dir, now: () => 2000 });
      try {
        expect(schemaVersion).toBe("24");
        expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("24");
        expect(store.db.prepare("SELECT * FROM usage_ledger").all()).toEqual([{ id: 1, applied_at: 5, group_id: "g", repo_id: "r", run_id: "run-1", source: "run-work", model: "opus", input: 1, output: 2,
          cache_read: 3, cache_write: 4, tokens: 10, quality: "reported", reasoning: null, cache_write_5m: null, cache_write_1h: null, requests: null, max_request_input: null,
          phase: null, task_id: null, agent_kind: null, installation_id: null, basis: null }]);
        // §8.3: quality keeps its three values; basis and phase take only theirs.
        const insert = (quality: string, basis: string | null, phase: string | null) => () => store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,source,tokens,quality,basis,phase) VALUES (1,'g','run-work',1,?,?,?)").run(quality, basis, phase);
        expect(insert("settled", null, null)).toThrow(/CHECK/);
        expect(insert("unattributed", "guess", null)).toThrow(/CHECK/);
        expect(insert("unattributed", null, "thinking")).toThrow(/CHECK/);
        expect(insert("unattributed", "soft-loop-floor", "review")).not.toThrow();
      } finally { store.close(); }
      const backups = (await readdir(dir)).filter((name) => name.startsWith("control.sqlite.pre-"));
      expect(backups).toEqual(["control.sqlite.pre-v23-2000"]);
      const backup = new DatabaseSync(join(dir, backups[0]!), { readOnly: true });
      try { expect(backup.prepare("PRAGMA table_info(usage_ledger)").all().map((c) => c.name)).not.toContain("basis"); } finally { backup.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("re-running the step on a store that has the columns changes nothing (a criterion that downgrades only the marker)", async () => {
    const root = await mkdtemp(join(tmpdir(), "s24-")), dir = join(root, "s");
    try {
      (await openControlStore({ stateDir: dir, now: () => 1000 })).close();
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      const sql = raw.prepare("SELECT sql FROM sqlite_master WHERE name='usage_ledger'").get()!.sql;
      raw.prepare("UPDATE meta SET value='23' WHERE key='schemaVersion'").run(); raw.close();
      const store = await openControlStore({ stateDir: dir, now: () => 2000 });
      try { expect(store.db.prepare("SELECT sql FROM sqlite_master WHERE name='usage_ledger'").get()!.sql).toBe(sql); } finally { store.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
