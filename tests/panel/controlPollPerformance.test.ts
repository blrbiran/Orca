import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { exportRequirementDocument } from "../../src/control/requirementExport.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "../control/fixtures/requirementHarness.js";
import { VALID_SPLIT } from "../control/fixtures/requirementOutputs.js";
import { join } from "node:path";
import { validateRetryGrantSource } from "../../src/control/retryGrant.js";
import { settlementAdmission } from "../../src/control/settleUnknownUsage.js";
import { describe, expect, it } from "vitest";
import { readControlGroup, readControlSummary, readGroupSummary } from "../../src/panel/controlViews.js";
import { readRunEvidence } from "../../src/panel/controlViews.js";
import { ControlError } from "../../src/control/errors.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { unknownFailure, handoff, settle } from "../control/fixtures/unknownFailure.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { recordActivity, readRunActivity, ACTIVITY_RETENTION } from "../../src/control/activity.js";
import { openControlStore } from "../../src/control/store.js";
import { webFixture, profileSnapshot } from "../control/fixtures/web.js";
import { installControlReadCounters, type ReadCounters } from "../control/fixtures/controlReadCounters.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const work = (h: H, id: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body));
const save = (h: H, id: string, body: unknown) => h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(body), id);
const tasks = (n: number) => Array.from({ length: n }, (_, i) => ({ taskId: `t${String(i).padStart(2, "0")}`, dependsOn: i === 0 ? [] : i === 1 ? ["t00"] : [`t${String(i - 2).padStart(2, "0")}`, `t${String(i - 1).padStart(2, "0")}`] }));
function observed(c: ReadCounters, n: number, entry: string) {
  const target = c.executions.filter(e => /SELECT .*body FROM (work_items|runs) WHERE group_id=\?/.test(e.sql) || /FROM activity.*JOIN runs/.test(e.sql));
  const remaining = new Map<string, { sql: string; method: string; executions: number; rows: number }>();
  for (const e of c.executions.filter(e => !target.includes(e))) {
    const key = `${e.method}:${e.sql}`, row = remaining.get(key) ?? { sql: e.sql, method: e.method, executions: 0, rows: 0 };
    row.executions++; row.rows += e.rows; remaining.set(key, row);
  }
  const aliasBuckets = [...c.parses.keys()].filter(key => key.includes("|")).map(key => ({ rows: key.split("|"), multiplicity: key.split("|").length }));
  expect(aliasBuckets).toEqual([]);
  console.info(JSON.stringify({ observation: "task1", n, entry, aliasBuckets, prepares: c.prepares.length, executions: c.executions.length, target, remaining: [...remaining.values()], usedBodies: c.parses.size, parses: [...c.parses.values()].reduce((a, b) => a + b, 0), maxParsesPerBody: Math.max(0, ...c.parses.values()) }));
}
function bounds(c: ReadCounters, detail: boolean) {
  for (const table of ["work_items", "runs"]) {
    const bodyReads = c.executions.filter(e => new RegExp(`FROM ${table}\\b`).test(e.sql) && /SELECT .*body/i.test(e.sql));
    expect(bodyReads.filter(e => e.method === "get")).toHaveLength(0);
    expect(bodyReads.filter(e => e.method === "all" && /WHERE group_id=\?/.test(e.sql))).toHaveLength(1);
  }
  expect(c.executions.filter(e => /FROM activity.*JOIN runs/.test(e.sql))).toHaveLength(detail ? 1 : 0);
  expect(c.executions.filter(e => /FROM activity WHERE run_id=/.test(e.sql))).toHaveLength(0);
  for (const [id, count] of c.parses) expect(count, id).toBeLessThanOrEqual(1);
}
const refusal = (fn: () => unknown) => {
  try { fn(); return null; } catch (error) {
    if (!(error instanceof ControlError)) throw error;
    return { code: error.code, detail: error.detail };
  }
};
const otherGroup = (h: H) => h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('other',1,1,'{}')").run();
async function claimed(n = 10) {
  let clock = 200;
  const h = await webFixture(profileSnapshot(), tasks(n), { storeNow: () => clock });
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart(h.deps, "g");
  if (claim.kind !== "claimed") throw new Error(JSON.stringify(claim));
  h.store.transaction(() => recordActivity(h.store, { groupId: "g", runId: claim.runId, kind: "phase", body: { stage: "first" } }));
  clock = 100;
  h.store.transaction(() => recordActivity(h.store, { groupId: "g", runId: claim.runId, kind: "phase", body: { stage: "latest" } }));
  return { h, runId: claim.runId };
}
describe("control poll request snapshots", () => {
  for (const n of [10, 50]) {
    it(`batches real summary and group reads for ${n} tasks with multiple dependencies`, async () => {
      const { h, runId } = await claimed(n);
      const counter = installControlReadCounters(h.store);
      try {
        const expectedSummary = readGroupSummary(h.store, "g"), expected = readControlGroup(h.store, "e", "g");
        expect(expectedSummary).toMatchObject({ completion: { done: 0, total: n }, counts: { running: 1, waiting: n - 1, idle: 0, blocked: 0, done: 0 } });
        expect(expected.workItems.map(w => w.category)).toEqual(["running", ...Array(n - 1).fill("waiting")]);
        expect(counter.store).toBe(h.store);
        counter.reset(); expect(readGroupSummary(counter.store, "g")).toEqual(expectedSummary); bounds(counter.snapshot(), false); observed(counter.snapshot(), n, "summary");
        counter.reset(); const actual = readControlGroup(counter.store, "e", "g"); expect(actual).toEqual(expected); bounds(counter.snapshot(), true); observed(counter.snapshot(), n, "group");
        expect(actual.runs.find(r => r.runId === runId)?.lastActivityAt).toBe(100);
      } finally { counter.restore(); await h.dispose(); }
    });
  }
  it("reuses statements while refreshing body and projection state between real requests", async () => {
    const h = await webFixture(profileSnapshot(), tasks(10));
    const counter = installControlReadCounters(h.store);
    try {
      counter.reset(); const initial = readControlSummary(counter.store, "e", null); bounds(counter.snapshot(), false);
      const target = (c: ReadCounters) => c.prepares.filter(p => /SELECT .*body FROM (work_items|runs) WHERE group_id=\?/.test(p.sql));
      expect(target(counter.snapshot())).toHaveLength(2);
      save(h, "t00", { ...work(h, "t00"), status: "done" });
      h.store.transaction(() => recordActivity(h.store, { groupId: "g", kind: "command", body: {} }));
      counter.reset(); const changed = readControlSummary(counter.store, "e", initial.changeSeq); bounds(counter.snapshot(), false);
      expect(changed.resetRequired).toBe(false); expect(changed.groups[0]?.completion?.done).toBe(1); expect(target(counter.snapshot())).toHaveLength(0);
      counter.reset(); expect(readControlSummary(counter.store, "e", changed.changeSeq).groups).toEqual([]); expect(target(counter.snapshot())).toHaveLength(0); expect(counter.snapshot().parses.size).toBe(0);
      counter.reset(); const reset = readControlSummary(counter.store, "e", changed.changeSeq, true); bounds(counter.snapshot(), false); expect(reset.resetRequired).toBe(true); expect(reset.groups).toEqual(changed.groups);
    } finally { counter.restore(); await h.dispose(); }
  });
  it("keeps legacy missing and corrupt work lenient but strict detail rejects its own schema and authority", async () => {
    const h = await webFixture(profileSnapshot(), tasks(10));
    try {
      save(h, "t00", { ...work(h, "t00"), status: "done" });
      h.store.db.prepare("UPDATE work_items SET body='broken' WHERE group_id='g' AND id='t01'").run();
      h.store.db.prepare("INSERT INTO work_items(id,group_id,target_version,body) VALUES ('unused','g',1,'broken')").run();
      expect(readGroupSummary(h.store, "g")).toMatchObject({ completion: { done: 1, total: 10 }, counts: { done: 1, waiting: 0, idle: 6, running: 0, blocked: 0 } });
      expect(() => readControlGroup(h.store, "e", "g")).toThrowError("work-item-invalid:t01");
      save(h, "t01", { ...work(h, "t00"), workItemId: "t01", taskId: "t01", dependsOn: ["t00"] });
      expect(() => readControlGroup(h.store, "e", "g")).toThrowError("work-item-authority:t01");
    } finally { await h.dispose(); }
  });
  it("does not borrow same-id dependency or current run bodies from another group", async () => {
    const { h, runId } = await claimed(3);
    try {
      otherGroup(h);
      h.store.db.prepare("UPDATE work_items SET group_id='other',body=json_set(body,'$.status','done') WHERE group_id='g' AND id='t00'").run();
      h.store.db.prepare("UPDATE runs SET group_id='other',body=json_set(body,'$.state','blocked') WHERE id=?").run(runId);
      save(h, "t01", { ...work(h, "t01"), status: "ready", currentRunId: runId });
      const counter = installControlReadCounters(h.store);
      try {
        counter.reset(); const summary = readGroupSummary(counter.store, "g");
        expect(summary).toMatchObject({ completion: { done: 0, total: 3 }, counts: { idle: 0, waiting: 2, done: 0, blocked: 0, running: 0 } });
        expect([...counter.snapshot().parses.keys()]).not.toContain("work_items:other:t00");
        expect([...counter.snapshot().parses.keys()]).not.toContain(`runs:other:${runId}`);
        bounds(counter.snapshot(), false);
        expect(refusal(() => readControlGroup(counter.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: "work-item-missing:t00" });
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });
  it("keeps missing work and bad referenced runs out of summary counts without parsing unused rows", async () => {
    const { h, runId } = await claimed(3);
    try {
      h.store.db.prepare("UPDATE runs SET body='broken' WHERE id=?").run(runId);
      h.store.db.prepare("DELETE FROM work_items WHERE group_id='g' AND id='t02'").run();
      h.store.db.prepare("INSERT INTO work_items(id,group_id,target_version,body) VALUES ('unused','g',1,'unused bad json')").run();
      const counter = installControlReadCounters(h.store);
      try {
        counter.reset(); expect(readGroupSummary(counter.store, "g")).toMatchObject({ completion: { done: 0, total: 3 }, counts: { idle: 0, running: 0, waiting: 1, blocked: 0, done: 0 } }); bounds(counter.snapshot(), false);
        expect(counter.snapshot().parses.has("work_items:g:unused")).toBe(false);
        expect(refusal(() => readControlGroup(counter.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: `run-invalid:${runId}` });
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });
  it("isolates prepared statements across two stores and reconstructs them after close and reopen", async () => {
    const one = await webFixture(profileSnapshot(), tasks(3)), two = await webFixture(profileSnapshot(), tasks(3));
    let reopened: Awaited<ReturnType<typeof openControlStore>> | undefined;
    try {
      save(one, "t00", { ...work(one, "t00"), status: "done" });
      save(two, "t01", { ...work(two, "t01"), status: "completed" });
      for (const [h, doneId] of [[one, "t00"], [two, "t01"]] as const) {
        const counter = installControlReadCounters(h.store);
        try {
          counter.reset(); const summary = readGroupSummary(counter.store, "g");
          expect(summary.completion?.done).toBe(1);
          expect(readControlGroup(counter.store, "e", "g").workItems.find(w => w.taskId === doneId)?.status).toBe("completed");
          expect(counter.snapshot().prepares.filter(p => /FROM activity.*JOIN runs/.test(p.sql))).toHaveLength(1);
          expect(counter.snapshot().prepares.filter(p => /SELECT .*body FROM (work_items|runs) WHERE group_id=\?/.test(p.sql))).toHaveLength(2);
        } finally { counter.restore(); }
      }
      const stateDir = one.store.stateDir;
      one.store.close(); reopened = await openControlStore({ stateDir });
      const counter = installControlReadCounters(reopened);
      try {
        counter.reset(); expect(readGroupSummary(counter.store, "g").completion?.done).toBe(1); bounds(counter.snapshot(), false);
        expect(counter.snapshot().prepares.filter(p => /SELECT .*body FROM (work_items|runs) WHERE group_id=\?/.test(p.sql))).toHaveLength(2);
        counter.reset(); expect(readControlGroup(counter.store, "e", "g").workItems[0]?.status).toBe("completed"); bounds(counter.snapshot(), true);
        expect(counter.snapshot().prepares.filter(p => /FROM activity.*JOIN runs/.test(p.sql))).toHaveLength(1);
        expect(counter.snapshot().prepares.filter(p => /SELECT .*body FROM (work_items|runs) WHERE group_id=\?/.test(p.sql))).toHaveLength(0);
      } finally { counter.restore(); }
    } finally { reopened?.close(); await one.dispose(); await two.dispose(); }
  });
  it("uses rowid for current lineage and progress while displaying historical runs in id order", async () => {
    const { h, runId } = await claimed(3);
    try {
      const original = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      h.store.db.prepare("UPDATE runs SET id='z-history',active=0,body=? WHERE id=?").run(JSON.stringify({ ...original, runId: "z-history", state: "settled-failed" }), runId);
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('a-current','g','t00',2,1,?)").run(JSON.stringify({ ...original, runId: "a-current", generation: 2 }));
      save(h, "t00", { ...work(h, "t00"), lineageRunIds: ["a-current", "z-history"], currentRunId: "a-current" });
      const counter = installControlReadCounters(h.store);
      try {
        counter.reset(); const view = readControlGroup(counter.store, "e", "g"); bounds(counter.snapshot(), true);
        expect(view.runs.map(r => r.runId)).toEqual(["a-current", "z-history"]);
        expect(view.workItems[0]).toMatchObject({ currentRunId: "a-current", lineageRunIds: ["a-current", "z-history"], progress: { runId: "a-current" } });
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });
  it("pins strict schema, authority, amendment and frozen agent refusals through the real group reader", async () => {
    const { h, runId } = await claimed(3);
    try {
      const original = work(h, "t00");
      for (const [body, detail] of [
        [{ ...original, dependsOn: "bad" }, "work-item-invalid:t00:Expected array, received string"],
        [{ ...original, workItemId: "foreign" }, "work-item-authority:t00"],
        [{ ...original, amendmentHash: "0".repeat(64), loopVersion: 1 }, "task-amendment-invalid:t00"],
        [{ ...original, agent: { ...original.agent, model: "foreign" } }, "work-item-agent:t00"],
      ] as const) {
        save(h, "t00", body);
        expect(refusal(() => readControlGroup(h.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail });
      }
      save(h, "t00", original);
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, workItemId: "foreign" }), runId);
      expect(refusal(() => readControlGroup(h.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: `run-identity:${runId}` });
    } finally { await h.dispose(); }
  });
  it("refreshes latest seq despite clock rollback and preserves null and retention results", async () => {
    const { h, runId } = await claimed(3);
    try {
      const counter = installControlReadCounters(h.store);
      try {
        counter.reset(); expect(readControlGroup(counter.store, "e", "g").runs[0]?.lastActivityAt).toBe(100); bounds(counter.snapshot(), true);
        expect(counter.snapshot().prepares.filter(p => /FROM activity.*JOIN runs/.test(p.sql))).toHaveLength(1);
        h.store.transaction(() => recordActivity(h.store, { groupId: "g", runId, kind: "usage-settled", body: { changed: true } }));
        h.store.db.prepare("UPDATE activity SET at=50 WHERE seq=(SELECT MAX(seq) FROM activity)").run();
        counter.reset(); expect(readControlGroup(counter.store, "e", "g").runs[0]?.lastActivityAt).toBe(50); bounds(counter.snapshot(), true);
        expect(counter.snapshot().prepares.filter(p => /FROM activity.*JOIN runs/.test(p.sql))).toHaveLength(0);
        h.store.transaction(() => { for (let i = 0; i < ACTIVITY_RETENTION; i++) recordActivity(h.store, { groupId: "g", kind: "command", body: {} }); });
        counter.reset(); expect(readControlGroup(counter.store, "e", "g").runs[0]?.lastActivityAt).toBeNull(); bounds(counter.snapshot(), true);
        h.store.db.prepare("DELETE FROM activity WHERE group_id='g'").run();
        counter.reset(); expect(readControlGroup(counter.store, "e", "g").runs[0]?.lastActivityAt).toBeNull(); bounds(counter.snapshot(), true);
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });
  it.each(["kind", "body"] as const)("checks the full latest activity %s lazily after run identity, using run-id membership", async mode => {
    const { h, runId } = await claimed(3);
    try {
      otherGroup(h);
      h.store.db.prepare("UPDATE activity SET group_id='other' WHERE run_id=?").run(runId);
      expect(readControlGroup(h.store, "e", "g").runs[0]?.lastActivityAt).toBe(readRunActivity(h.store, runId, 1)[0]?.at);
      const seq = Number(h.store.db.prepare("SELECT MAX(seq) AS seq FROM activity WHERE run_id=?").get(runId)!.seq);
      if (mode === "kind") h.store.db.prepare("UPDATE activity SET kind='bad-kind' WHERE seq=?").run(seq);
      else h.store.db.prepare("UPDATE activity SET body='[]' WHERE seq=?").run(seq);
      expect(refusal(() => readControlGroup(h.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: `activity-invalid:${seq}` });
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, groupId: "other" }), runId);
      expect(refusal(() => readControlGroup(h.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: `run-identity:${runId}` });
    } finally { await h.dispose(); }
  });
  it("batches run evidence validation through the same strict run and work snapshots", async () => {
    const { h, runId } = await claimed(3);
    const counter = installControlReadCounters(h.store);
    try {
      counter.reset(); expect(await readRunEvidence(counter.store, runId)).toEqual({ schema: "orca-run-evidence-v1", runId, entries: [] }); bounds(counter.snapshot(), true);
      save(h, "t00", { ...work(h, "t00"), dependsOn: "bad" });
      await expect(readRunEvidence(counter.store, runId)).rejects.toMatchObject({ code: "recovery-blocked", detail: `run-work-invalid:${runId}:Expected array, received string` });
    } finally { counter.restore(); await h.dispose(); }
  });
  it("shares lazy decoding with live M3 retry authority and still rejects corrupt source and missing marker", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", stopReason: () => "provider crashed" });
    try {
      const limit = readWebGroup(t.h.store, "g").limit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: { tokens: limit.tokens * 4, activeMs: limit.activeMs * 4, attempts: limit.attempts * 4, sessions: limit.sessions * 4 } }))).not.toHaveProperty("error");
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      await handoff(t, runId, driver);
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).not.toHaveProperty("error");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      const source = t.body(runId), original = work(t.h, "a");
      const foreign = await openControlStore({ stateDir: join(t.h.root, "foreign-state") });
      try {
        for (const scope of [{ store: foreign, groupId: "g" }, { store: t.h.store, groupId: "other" }]) {
          expect(() => validateRetryGrantSource(t.h.store, "g", original, { ...scope, runsByRowid: [], decodeRun: () => { throw new Error("foreign-reader-used"); } })).not.toThrow();
        }
      } finally { foreign.close(); }
      const counter = installControlReadCounters(t.h.store);
      try {
        counter.reset(); const view = readControlGroup(counter.store, "e", "g"); bounds(counter.snapshot(), true);
        expect(view.workItems[0]).toMatchObject({ taskId: "a", category: "idle", currentRunId: runId });
        expect(view.runs[0]).toMatchObject({ runId, state: "settled-failed" });
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...source, drive: { ...source.drive, outcome: "succeeded" } }), runId);
        expect(refusal(() => readControlGroup(counter.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: "retry-source:a:source-state" });
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(source), runId);
        const missing = { ...original }; delete missing.retryGrantSourceRunId; save(t.h, "a", missing);
        expect(refusal(() => readControlGroup(counter.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: "retry-source:a:missing" });
      } finally { counter.restore(); }
    } finally { await t.h.dispose(); }
  }, 30_000);
  it("preserves D9 settlement markers and strict rejection while decoding each work and run once", async () => {
    const { t, runId, driver } = await unknownFailure(undefined, true, { extraReserve: true });
    try {
      await handoff(t, runId, driver); expect(await settle(t, runId)).not.toHaveProperty("error");
      const source = t.body(runId);
      const foreign = await openControlStore({ stateDir: join(t.h.root, "foreign-state") });
      try {
        for (const scope of [{ store: foreign, groupId: "g" }, { store: t.h.store, groupId: "other" }]) {
          expect(refusal(() => settlementAdmission(t.h.store, source, { ...scope, readWork: () => { throw new Error("foreign-reader-used"); } }))).toEqual({ code: "run-usage-settled", detail: undefined });
        }
      } finally { foreign.close(); }
      const counter = installControlReadCounters(t.h.store);
      try {
        counter.reset(); const view = readControlGroup(counter.store, "e", "g"); bounds(counter.snapshot(), true);
        expect(view.runs[0]?.unknownUsageSettlement).toMatchObject({ allowed: false, refusalReason: "run-usage-settled", settlement: source.usageSettlement });
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...source, usageSettlement: { ...source.usageSettlement, principal: "user:foreign" } }), runId);
        expect(refusal(() => readControlGroup(counter.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: `run-usage-settlement:${runId}` });
      } finally { counter.restore(); }
    } finally { await t.h.dispose(); }
  }, 30_000);

  it("does not decode an unreferenced legacy run during summary and names it in strict detail", async () => {
    const h = await webFixture(profileSnapshot(), tasks(3));
    try {
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('unused-run','g','handoff-unused',1,0,'broken unused run')").run();
      const counter = installControlReadCounters(h.store);
      try {
        counter.reset(); expect(readGroupSummary(counter.store, "g")).toMatchObject({ completion: { done: 0, total: 3 }, counts: { idle: 3, waiting: 0, running: 0, blocked: 0, done: 0 } }); bounds(counter.snapshot(), false);
        expect(counter.snapshot().parses.has("runs:g:unused-run")).toBe(false);
        expect(refusal(() => readControlGroup(counter.store, "e", "g"))).toEqual({ code: "recovery-blocked", detail: "run-invalid:unused-run" });
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });

  it("counts identical fixture raw bytes once per actual JSON parse rather than multiplying row aliases", async () => {
    const h = await webFixture(profileSnapshot(), tasks(3));
    try {
      otherGroup(h);
      h.store.db.prepare("INSERT INTO work_items(id,group_id,target_version,body) SELECT id,'other',target_version,body FROM work_items WHERE group_id='g' AND id='t00'").run();
      const counter = installControlReadCounters(h.store);
      try {
        counter.reset(); expect(readGroupSummary(counter.store, "g").completion).toEqual({ done: 0, total: 3 }); bounds(counter.snapshot(), false);
        expect([...counter.snapshot().parses.keys()].filter(key => key.includes("|")).map(key => key.split("|").length)).toEqual([2]);
        expect([...counter.snapshot().parses.values()].reduce((sum, count) => sum + count, 0)).toBe(3);
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });

  it("shares the snapshot with a converted requirement's active work summary and preserves malformed active-run refusal", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }))).not.toHaveProperty("error");
      const hash = x.profile.profileHash;
      const selections = await resolveGroupSelections({ store: x.store, port: x.fake.port }, "r", "human");
      expect(await x.service.confirm(x.command("confirm", {
        planHash: readArchivedPlan(x.store, "r").planHash, proposalVersion: readBudgetProposal(x.store, "r").proposalVersion,
        budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
        profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: 800_000 }, selectionsHash: selections.selectionsHash!,
      }))).not.toHaveProperty("error");
      await exportRequirementDocument({ store: x.store, resolveRepository: () => x.repo }, "r");
      expect(await x.service.start(x.command("start", {}))).not.toHaveProperty("error");
      const claim = await deliverScheduledStart({ store: x.store, profileRouter: x.deps.router, admissionGate: x.deps.admissionGate }, "r");
      if (claim.kind !== "claimed") throw new Error(JSON.stringify(claim));
      const counter = installControlReadCounters(x.store);
      try {
        counter.reset(); const summary = readGroupSummary(counter.store, "r");
        expect(summary).toMatchObject({ requirement: { blockedRun: null, draftState: "accepted" }, completion: { done: 0, total: VALID_SPLIT.tasks.length } }); bounds(counter.snapshot(), false);
        counter.reset(); const view = readControlGroup(counter.store, "e", "r");
        expect(view.summary).toEqual(summary); expect(view.runs.find(run => run.runId === claim.runId)?.phase).toBe("work");
        expect(view.runs.some(run => run.phase === "single-call" && run.purpose === "split")).toBe(true); bounds(counter.snapshot(), true);
        const activeBody = String(x.store.db.prepare("SELECT body FROM runs WHERE id=?").get(claim.runId)!.body);
        const historyId = view.runs.find(run => run.phase === "single-call")!.runId;
        x.store.db.prepare("UPDATE runs SET body='broken converted active run' WHERE id=?").run(claim.runId);
        let expectedError: SyntaxError;
        try { JSON.parse("broken converted active run"); throw new Error("invalid fixture"); } catch (error) { expectedError = error as SyntaxError; }
        for (const read of [() => readGroupSummary(counter.store, "r"), () => readControlGroup(counter.store, "e", "r")]) {
          counter.reset(); let error: unknown;
          try { read(); } catch (failure) { error = failure; }
          expect(error).toBeInstanceOf(SyntaxError); expect((error as SyntaxError).message).toBe(expectedError.message); bounds(counter.snapshot(), false);
        }
        x.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(activeBody, claim.runId);
        x.store.db.prepare("UPDATE runs SET body='broken converted inactive run' WHERE id=?").run(historyId);
        counter.reset(); expect(readGroupSummary(counter.store, "r")).toEqual(summary); bounds(counter.snapshot(), false);
        expect(counter.snapshot().parses.has(`runs:r:${historyId}`)).toBe(false);
        counter.reset(); expect(refusal(() => readControlGroup(counter.store, "e", "r"))).toEqual({ code: "recovery-blocked", detail: `run-invalid:${historyId}` });
      } finally { counter.restore(); }
    } finally { await x.dispose(); }
  }, 30_000);

});
