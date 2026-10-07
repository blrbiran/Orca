import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { claimWork } from "../../src/control/budget.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import { AgentCeilingRefusal, capStatuses, committedTokens, readCaps, spendCapBlocking } from "../../src/control/spendCaps.js";
import { applySpendCommand, type SpendCommand } from "../../src/control/spendCommands.js";
import { readUsageCalendar } from "../../src/control/usageCalendar.js";
import { readUsageView } from "../../src/control/usageQuery.js";
import { rawAuthorityCommandSchema, usageViewSchema } from "../../src/control/webProtocol.js";
import { openTestStore, seedBudgetCase } from "./fixtures/store.js";

const DAY = 86_400_000;
// Thursday 2026-10-08 12:00 UTC; with the calendar pinned to UTC and Monday, its week is [Mon 10-05, Mon 10-12).
const t0 = Date.UTC(2026, 9, 8, 12);
const weekFrom = Date.UTC(2026, 9, 5), weekTo = Date.UTC(2026, 9, 12);
// seedBudgetCase's group g1 has no plan or requirement, so its repository is its projectKey (groupRepoIdOf), set to r1 here.
const r1 = "r1";

type Store = Awaited<ReturnType<typeof openTestStore>>["store"];
function seedHeadroomCase(store: Store) {
  store.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'UTC',1)").run();
  const seeded = seedBudgetCase(store);
  store.db.prepare("UPDATE groups SET body=json_set(body,'$.projectKey',?) WHERE id='g1'").run(r1);
  const claim = claimWork(store, seeded.t1Claim);
  // R: what the active run still holds, read from its row rather than restated from the fixture's grant.
  const run = JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=? AND active=1").get(claim.runId)!.body)) as { remaining: { work: { tokens: number }; handoff: { tokens: number } } };
  const R = run.remaining.work.tokens + run.remaining.handoff.tokens;
  const insert = store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,tokens,quality) VALUES (?,?,?,?,?,?,?,?)");
  insert.run(t0, "g1", r1, null, "run-work", null, 100, "unattributed");
  insert.run(t0 - 30 * DAY, "g1", r1, null, "run-work", null, 50, "unattributed");
  insert.run(0, "g1", r1, null, "pre-ledger", null, 7, "unattributed");
  const cap = store.db.prepare("INSERT INTO spend_caps(scope,period,tokens,updated_at,updated_by) VALUES (?,?,?,?,?)");
  cap.run("all", "total", 1000, 1, "user:u1");
  cap.run(`repo:${r1}`, "week", 400, 2, "user:u1");
  return { R, groupId: "g1" };
}

describe("headroom (spec §6.2, D4)", () => {
  it("is tokens minus used in the period minus what active runs still hold, per applying cap; the binding one is the least", async () => {
    const h = await openTestStore(); try {
      const { R, groupId } = seedHeadroomCase(h.store);
      expect(R).toBeGreaterThan(0);
      expect(capStatuses(h.store, r1, t0)).toEqual([
        { scope: `repo:${r1}`, period: "week", tokens: 400, updatedAt: 2, updatedBy: "user:u1", used: 100, committed: R, headroom: 300 - R, from: weekFrom, to: weekTo },
        { scope: "all", period: "total", tokens: 1000, updatedAt: 1, updatedBy: "user:u1", used: 157, committed: R, headroom: 843 - R, from: null, to: null },
      ]);
      expect(spendCapBlocking(h.store, r1, 300 - R + 1, t0)?.scope).toBe(`repo:${r1}`);
      expect(spendCapBlocking(h.store, r1, 300 - R, t0)).toBe(null);
      // Without the group's own runs nothing is held (the agent ceiling judges a group against the others).
      expect(capStatuses(h.store, r1, t0, groupId).map((cap) => cap.committed)).toEqual([0, 0]);
      // Another repository: only the overall cap applies, and it still counts every active run.
      expect(capStatuses(h.store, "r2", t0).map((cap) => [cap.scope, cap.committed])).toEqual([["all", R]]);
      expect(committedTokens(h.store, "repo:r2", null)).toBe(0);
      expect(committedTokens(h.store, `repo:${r1}`, null)).toBe(R);
      expect(committedTokens(h.store, "all", null)).toBe(R);
      // No cap set: no gate.
      h.store.db.prepare("DELETE FROM spend_caps").run();
      expect(capStatuses(h.store, r1, t0)).toEqual([]);
      expect(spendCapBlocking(h.store, r1, Number.MAX_SAFE_INTEGER, t0)).toBe(null);
    } finally { await h.dispose(); }
  });

  it("refuses to read an active run whose remaining grant is not a number, rather than open the gate", async () => {
    const h = await openTestStore(); try {
      seedHeadroomCase(h.store);
      h.store.db.prepare("UPDATE runs SET body=json_set(body,'$.remaining.work.tokens','x') WHERE active=1").run();
      expect(() => committedTokens(h.store, "all", null)).toThrow("run-remaining-invalid");
    } finally { await h.dispose(); }
  });

  it("the usage view carries the caps of its scope: `all` the overall ones, a repository both", async () => {
    const h = await openTestStore(); try {
      const { R } = seedHeadroomCase(h.store);
      const view = (scope: "all" | `repo:${string}`) => usageViewSchema.parse(readUsageView(h.store, { scope, from: null, to: null, groupBy: "model" }, t0));
      expect(view("all").caps.map((cap) => [cap.scope, cap.period, cap.headroom])).toEqual([["all", "total", 843 - R]]);
      expect(view(`repo:${r1}`).caps.map((cap) => [cap.scope, cap.period, cap.headroom])).toEqual([[`repo:${r1}`, "week", 300 - R], ["all", "total", 843 - R]]);
    } finally { await h.dispose(); }
  });

  it("names the cap and the limit in the agent-ceiling refusal, which is not a ControlError (D10)", () => {
    const cap = { scope: "all" as const, period: "week" as const, tokens: 10, updatedAt: 0, updatedBy: "user:u1", used: 4, committed: 1, headroom: 5, from: 0, to: 1 };
    const refusal = new AgentCeilingRefusal(cap, 9);
    expect(refusal).toBeInstanceOf(Error);
    expect([refusal.cap, refusal.limitTokens]).toEqual([cap, 9]);
  });
});

const spend = (commandId: string, expectedRevision: number, verb: SpendCommand["verb"], payload: unknown) =>
  ({ schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "operator-1", verb, target: { kind: "spend" }, payload }) as SpendCommand;
const asUser = (command: SpendCommand, now = 5_000) =>
  withCommandContext(command.commandId, { client: "web", principal: "user:u1" }, () => applySpendCommand({ store: h!.store, now: () => new Date(now) }, command));
let h: Awaited<ReturnType<typeof openTestStore>> | undefined;

describe("the cap verbs (spec §6.1, D5)", () => {
  it("set, replace, clear and set-usage-calendar under the @spend revision, recording the principal", async () => {
    h = await openTestStore(); try {
      const changeSeq = readProjectionState(h.store).changeSeq;
      const set = asUser(spend("cap-1", 0, "set-spend-cap", { scope: "all", period: "week", tokens: 500 }));
      expect(set).toMatchObject({ schema: "orca-command-success-v1", verb: "set-spend-cap", target: { kind: "spend" }, commandRevision: 1, projectionSeq: null, result: { kind: "spend-cap-set", revision: 1 } });
      expect(readCaps(h.store)).toEqual([{ scope: "all", period: "week", tokens: 500, updatedAt: 5_000, updatedBy: "user:u1" }]);
      expect(h.store.db.prepare("SELECT group_id,scope_kind,scope_id,principal FROM commands WHERE id='cap-1'").get())
        .toEqual({ group_id: "@spend", scope_kind: "spend", scope_id: "spend", principal: "user:u1" });
      expect(lookupCommandResult(h.store, "@spend", "cap-1")).toMatchObject({ originalStatus: 200, body: set });
      // No group revision or projection moves.
      expect(readProjectionState(h.store).changeSeq).toBe(changeSeq);

      // The same state again under a new id: refused, the revision stays.
      expect(asUser(spend("cap-2", 1, "set-spend-cap", { scope: "all", period: "week", tokens: 500 }))).toMatchObject({ error: { code: "no-op-command", commandRevision: 1 } });
      // Replace.
      expect(asUser(spend("cap-3", 1, "set-spend-cap", { scope: "all", period: "week", tokens: 800 }), 6_000)).toMatchObject({ commandRevision: 2, result: { kind: "spend-cap-set", revision: 2 } });
      expect(readCaps(h.store)).toEqual([{ scope: "all", period: "week", tokens: 800, updatedAt: 6_000, updatedBy: "user:u1" }]);
      // Stale.
      expect(asUser(spend("cap-4", 1, "set-spend-cap", { scope: "all", period: "week", tokens: 900 }))).toMatchObject({ error: { code: "revision-conflict", commandRevision: 2 } });
      expect(readCaps(h.store)[0]!.tokens).toBe(800);
      // Clear; clearing what is not there is a no-op.
      expect(asUser(spend("cap-5", 2, "clear-spend-cap", { scope: "all", period: "week" }))).toMatchObject({ commandRevision: 3, result: { kind: "spend-cap-cleared", revision: 3 } });
      expect(readCaps(h.store)).toEqual([]);
      expect(asUser(spend("cap-6", 3, "clear-spend-cap", { scope: "all", period: "week" }))).toMatchObject({ error: { code: "no-op-command" } });

      // The calendar.
      expect(asUser(spend("cal-1", 3, "set-usage-calendar", { timeZone: "Asia/Tokyo", weekStart: 7 }))).toMatchObject({ commandRevision: 4, result: { kind: "usage-calendar-set", revision: 4 } });
      expect(readUsageCalendar(h.store)).toEqual({ timeZone: "Asia/Tokyo", weekStart: 7 });
      expect(asUser(spend("cal-2", 4, "set-usage-calendar", { timeZone: "Asia/Tokyo", weekStart: 7 }))).toMatchObject({ error: { code: "no-op-command" } });
      // An unknown zone is refused by the payload schema, by name, before anything is booked.
      const mars = spend("cal-3", 4, "set-usage-calendar", { timeZone: "Mars/Base", weekStart: 1 });
      const parsed = rawAuthorityCommandSchema.safeParse(mars);
      expect(parsed.success ? [] : parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([["payload.timeZone", "time-zone-invalid"]]);
      expect(() => asUser(mars)).toThrow(ZodError);
      expect(h.store.db.prepare("SELECT id FROM commands WHERE id='cal-3'").get()).toBeUndefined();
      expect(readUsageCalendar(h.store)).toEqual({ timeZone: "Asia/Tokyo", weekStart: 7 });

      // The revision lives in spend_settings, and every ledger row names the principal.
      expect(h.store.db.prepare("SELECT revision FROM spend_settings").all()).toEqual([{ revision: 4 }]);
      expect(h.store.db.prepare("SELECT DISTINCT principal FROM commands WHERE group_id='@spend'").all()).toEqual([{ principal: "user:u1" }]);
      // A cap is per scope and period; a repository scope must carry a valid id.
      expect(asUser(spend("cap-7", 4, "set-spend-cap", { scope: "repo:r1", period: "month", tokens: 1 }))).toMatchObject({ result: { revision: 5 } });
      expect(rawAuthorityCommandSchema.safeParse(spend("cap-8", 5, "set-spend-cap", { scope: "repo:", period: "month", tokens: 1 })).success).toBe(false);
      expect(rawAuthorityCommandSchema.safeParse(spend("cap-8", 5, "set-spend-cap", { scope: "all", period: "day", tokens: 1 })).success).toBe(false);
      expect(rawAuthorityCommandSchema.safeParse(spend("cap-8", 5, "set-spend-cap", { scope: "all", period: "week", tokens: 0 })).success).toBe(false);
    } finally { await h.dispose(); h = undefined; }
  });
});
