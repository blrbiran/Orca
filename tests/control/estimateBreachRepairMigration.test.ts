import { readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { recordUsage } from "../../src/control/usage.js";
import { budgetBalance } from "../../src/control/budget.js";
import type { Amount } from "../../src/control/types.js";
import { webFixture } from "./fixtures/web.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Tester round 2 spec §4.3: the schema 18 -> 19 repair of groups stuck `blocked` only by an estimate breach. Stores are
 * built by today's code in temp dirs (Rule 17), then put back into the pre-H1 shape by raw SQL: status `blocked`, marker
 * `"18"`. Every assertion reads what the migration wrote, never the seed (Rule 9).
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const REPAIR_AT = 4242;
const runBody = (store: ControlStore, runId: string) => JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
let artifact = 0;
const book = (store: ControlStore, runId: string, cumulative: Amount) => recordUsage(store, {
  runId, generation: 1, eventSeq: 1, bucket: "work", cumulative, source: { artifactId: `repair-${++artifact}`, hash: "a".repeat(64) } });

interface Stuck { h: Fixture; runId: string; stateDir: string; dbPath: string; extraRuns: Array<Record<string, unknown>> }
/**
 * A group "g" whose estimate run breached its grant (recorded on the run by today's code), confirmed first when asked,
 * plus extra run rows of the same group; then closed and rewritten to the pre-H1 shape (blocked, schema 18).
 */
async function stuck(options: { confirm?: boolean; tokens?: number; extraRuns?: Array<Record<string, unknown>>; finite?: boolean; before?: (raw: InstanceType<typeof DatabaseSync>) => void } = {}): Promise<Stuck> {
  const h = await webFixture(undefined, [{ taskId: "a" }], options.finite === false ? { tokenPolicy: "optional-v1" } : {});
  const service = new WebControlService(h.deps);
  const run = await service.claimEstimate("g", h.estimateId);
  const runId = run!.runId as string;
  if (options.confirm) { const answer = await service.confirm(h.command("confirm", await h.confirmPayload())); if ("error" in answer) throw new Error(JSON.stringify(answer)); }
  const grant = runBody(h.store, runId).grant.work as Amount;
  book(h.store, runId, { ...grant, tokens: grant.tokens + (options.tokens ?? 1) });
  const stateDir = h.store.stateDir;
  h.store.close();
  const dbPath = join(stateDir, "control.sqlite");
  const raw = new DatabaseSync(dbPath);
  const body = JSON.parse(String(raw.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  body.status = "blocked";
  raw.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
  const extraRuns = options.extraRuns ?? [];
  extraRuns.forEach((extra, index) => {
    const id = `run-extra-${index}`;
    raw.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,0,?)").run(id, "g", `extra-${index}`, JSON.stringify({ runId: id, groupId: "g", breaches: [], ...extra }));
  });
  options.before?.(raw);
  raw.prepare("UPDATE meta SET value='18' WHERE key='schemaVersion'").run();
  raw.close();
  return { h, runId, stateDir, dbPath, extraRuns };
}
const reopen = (s: Stuck) => openControlStore({ stateDir: s.stateDir, now: () => REPAIR_AT });
const dispose = async (s: Stuck, store: ControlStore | null) => { store?.close(); await rm(s.h.root, { recursive: true, force: true }); };
const group = (store: ControlStore, id = "g") => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body));
const tables = (store: ControlStore) => store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
const rowsOf = (db: { prepare(sql: string): { all(): unknown[] } }, table: string) => JSON.stringify(db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(), (_key, value) => typeof value === "bigint" ? String(value) : value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value);
const REPAIRED_TABLES = ["groups", "budget_proposals", "work_items", "group_orchestration", "token_policies", "meta"];

describe("schema 19: the one-time repair of estimate-stuck groups", () => {
  it("C5: a stuck draft group opens as draft, attributed, its revision unchanged", async () => {
    const s = await stuck(); let store: ControlStore | null = null; try {
      const revisionBefore = Number(new DatabaseSync(s.dbPath, { readOnly: true }).prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      store = await reopen(s);
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("21");
      const body = group(store);
      expect(body.status).toBe("draft");
      expect(body.statusRepairs).toEqual([{ from: "blocked", to: "draft", reopened: false, cause: "estimate-breach", runIds: [s.runId], by: "migration-18-to-19", at: REPAIR_AT }]);
      expect(Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision)).toBe(revisionBefore);
      expect(body.revision).toBe(revisionBefore);
    } finally { await dispose(s, store); }
  });

  it("C6: a stuck group whose proposal was confirmed is reopened to draft, its start authorization gone", async () => {
    const s = await stuck({ confirm: true }); let store: ControlStore | null = null; try {
      const before = new DatabaseSync(s.dbPath, { readOnly: true });
      const versionBefore = JSON.parse(String(before.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body)).proposalVersion;
      expect(before.prepare("SELECT body FROM group_orchestration WHERE group_id='g'").get()).toBeDefined();
      before.close();
      store = await reopen(s);
      const body = group(store), proposal = JSON.parse(String(store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body));
      expect(body.status).toBe("draft");
      expect(body.statusRepairs).toMatchObject([{ reopened: true, runIds: [s.runId] }]);
      expect(proposal).toMatchObject({ state: "editable", proposalVersion: versionBefore + 1, budgetMode: null, profiles: null, executionSnapshotHash: null });
      expect(body.proposal).toMatchObject({ state: "editable", proposalVersion: versionBefore + 1 });
      const work = JSON.parse(String(store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      expect(work).toMatchObject({ status: "draft", configHash: null, derivedContractHash: null });
      expect(work).not.toHaveProperty("agent");
      expect(store.db.prepare("SELECT body FROM group_orchestration WHERE group_id='g'").get()).toBeUndefined();
      // The next pump's auto-start does not start it.
      const service = new WebControlService({ ...s.h.deps, store });
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      expect(group(store).status).toBe("draft");
    } finally { await dispose(s, store); }
  });

  it("C7: a blocked group with a work-run breach stays blocked, alone or beside an estimate breach", async () => {
    for (const extraRuns of [[{ phase: "work", breaches: [1] }]]) {
      const s = await stuck({ extraRuns }); let store: ControlStore | null = null; try {
        store = await reopen(s);
        expect(group(store).status).toBe("blocked");
        expect(group(store)).not.toHaveProperty("statusRepairs");
      } finally { await dispose(s, store); }
    }
    // Alone: no estimate breach at all (the estimate run's breach removed before the open).
    const s = await stuck({ extraRuns: [{ phase: "work", breaches: [1] }], before: raw => {
      for (const row of raw.prepare("SELECT id,body FROM runs WHERE group_id='g'").all()) {
        const body = JSON.parse(String(row.body)); if (body.phase !== "estimate") continue;
        body.breaches = []; raw.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), String(row.id));
      }
    } }); let store: ControlStore | null = null; try {
      store = await reopen(s);
      expect(group(store).status).toBe("blocked");
    } finally { await dispose(s, store); }
  });

  it("C7a: clarify and split breaches cannot have blocked; another single-call breach can", async () => {
    for (const purpose of ["clarify", "split"]) {
      const s = await stuck({ extraRuns: [{ phase: "single-call", purpose, breaches: [3] }] }); let store: ControlStore | null = null; try {
        store = await reopen(s);
        expect(group(store).status).toBe("draft");
        expect(group(store).statusRepairs[0].runIds).toEqual([s.runId]);
      } finally { await dispose(s, store); }
    }
    const s = await stuck({ extraRuns: [{ phase: "single-call", purpose: "flow-draft", breaches: [3] }] }); let store: ControlStore | null = null; try {
      store = await reopen(s);
      expect(group(store).status).toBe("blocked");
    } finally { await dispose(s, store); }
  });

  it("C8: a group with a work run (not breached) stays blocked", async () => {
    const s = await stuck({ extraRuns: [{ phase: "work", breaches: [] }] }); let store: ControlStore | null = null; try {
      store = await reopen(s);
      expect(group(store).status).toBe("blocked");
    } finally { await dispose(s, store); }
  });

  it("review M3: a run of any phase other than estimate or single-call (not breached) keeps the group blocked", async () => {
    for (const phase of ["reconcile", "goal-review", undefined]) {
      const s = await stuck({ extraRuns: [{ phase, breaches: [] }] }); let store: ControlStore | null = null; try {
        store = await reopen(s);
        expect([phase, group(store).status]).toEqual([phase, "blocked"]);
      } finally { await dispose(s, store); }
    }
  });

  it("C9: one backup of the v18 store; a second open adds none and changes no group byte", async () => {
    const s = await stuck(); let store: ControlStore | null = null; try {
      store = await reopen(s);
      const groups = rowsOf(store.db, "groups");
      store.close(); store = null;
      expect((await readdir(s.stateDir)).filter(name => name.startsWith("control.sqlite.pre-v18-"))).toHaveLength(1);
      store = await reopen(s);
      expect((await readdir(s.stateDir)).filter(name => name.startsWith("control.sqlite.pre-"))).toHaveLength(1);
      expect(rowsOf(store.db, "groups")).toBe(groups);
    } finally { await dispose(s, store); }
  });

  it("C9a: the step itself is idempotent -- the marker reset to 18 and re-opened changes no row", async () => {
    const s = await stuck({ confirm: true }); let store: ControlStore | null = null; try {
      store = await reopen(s);
      const first = Object.fromEntries(["groups", "budget_proposals", "work_items", "group_orchestration"].map(t => [t, rowsOf(store!.db, t)]));
      store.close(); store = null;
      const raw = new DatabaseSync(s.dbPath); raw.prepare("UPDATE meta SET value='18' WHERE key='schemaVersion'").run(); raw.close();
      store = await reopen(s);
      for (const table of Object.keys(first)) expect(rowsOf(store.db, table)).toBe(first[table]);
      expect(group(store).statusRepairs).toHaveLength(1);
    } finally { await dispose(s, store); }
  });

  it("C9b: never throws -- a limited confirmed group with a token deficit is repaired; an unreadable proposal is left alone", async () => {
    const s = await stuck({ confirm: true, tokens: 40_000_000, before: raw => {
      // A second stuck group whose budget_proposals body cannot be read.
      const g = JSON.parse(String(raw.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      raw.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('g2',1,1,0,?)").run(JSON.stringify({ ...g, groupId: "g2" }));
      raw.prepare("INSERT INTO budget_proposals(group_id,proposal_version,body) VALUES ('g2',1,'not json')").run();
      raw.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-g2','g2','estimate-g2',1,0,?)").run(JSON.stringify({ runId: "run-g2", groupId: "g2", phase: "estimate", breaches: [1] }));
    } }); let store: ControlStore | null = null; try {
      const before = new DatabaseSync(s.dbPath, { readOnly: true });
      const g2Before = String(before.prepare("SELECT body FROM groups WHERE id='g2'").get()!.body);
      const ledgerBefore = JSON.parse(String(before.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).ledger;
      const policiesBefore = rowsOf(before, "token_policies");
      before.close();
      expect(ledgerBefore.budgetDeficit.tokens).toBeGreaterThan(0);
      store = await reopen(s);
      const body = group(store);
      const row = store.db.prepare("SELECT proposal_version,body FROM budget_proposals WHERE group_id='g'").get()!;
      const proposal = JSON.parse(String(row.body));
      expect(body.status).toBe("draft");
      expect(Number(row.proposal_version)).toBe(proposal.proposalVersion);
      expect(proposal.state).toBe("editable");
      const balance = budgetBalance(proposal.groupLimit, body.used, body.ledger.committedRemaining);
      expect(body.ledger.budgetDeficit).toEqual(balance.deficit);
      expect(body.ledger.budgetDeficit.tokens).toBeGreaterThan(0);
      expect(proposal.explicitUnallocatedReserve).toEqual(balance.reserve);
      expect(proposal.allocations.find((a: { ownerKind: string }) => a.ownerKind === "reserve").amount).toEqual(balance.reserve);
      expect(proposal.allocations.every((a: { state: string }) => a.state === "draft-encumbered")).toBe(true);
      expect(body.ledger).toMatchObject({ groupLimit: proposal.groupLimit, used: body.used, explicitUnallocatedReserve: balance.reserve, committedRemaining: ledgerBefore.committedRemaining });
      expect(body.limit).toEqual(proposal.groupLimit);
      expect(body.reserved).toEqual(ledgerBefore.committedRemaining);
      const review = proposal.allocations.find((a: { ownerKind: string }) => a.ownerKind === "goal-review").amount;
      expect(body.reviewReserve).toEqual(review);
      expect(body.reviewRemaining).toEqual(review);
      expect(body.proposal).toEqual({ state: "editable", proposalVersion: proposal.proposalVersion, planHash: proposal.planHash, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null });
      expect(body.reconcileSlot).toBeNull();
      expect(rowsOf(store.db, "token_policies")).toBe(policiesBefore);
      expect(String(store.db.prepare("SELECT body FROM groups WHERE id='g2'").get()!.body)).toBe(g2Before);
    } finally { await dispose(s, store); }
  });

  it("review I2: a group whose repair fails part-way is left byte-equal in every table, and the store opens at 20", async () => {
    // A confirmed stuck group under the optional token policy whose task work allocation holds tokens "x": the proposal
    // and work-item writes succeed, then the task's token_policies write (an INTEGER column) throws.
    const s = await stuck({ confirm: true, finite: false, before: raw => {
      const proposal = JSON.parse(String(raw.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body));
      proposal.allocations.find((a: { ownerId: string; bucket: string }) => a.ownerId === "a" && a.bucket === "work").amount.tokens = "x";
      raw.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(JSON.stringify(proposal));
    } }); let store: ControlStore | null = null; try {
      const before = new DatabaseSync(s.dbPath, { readOnly: true });
      const names = (before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map(row => row.name);
      const rows = Object.fromEntries(names.map(name => [name, rowsOf(before, name)]));
      before.close();
      store = await reopen(s);
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("21");
      for (const name of names.filter(n => n !== "meta")) expect([name, rowsOf(store.db, name)]).toEqual([name, rows[name]]);
      expect(group(store).status).toBe("blocked");
    } finally { await dispose(s, store); }
  });

  it("C10: every other table's rows are byte-equal", async () => {
    const s = await stuck({ confirm: true }); let store: ControlStore | null = null; try {
      const before = new DatabaseSync(s.dbPath, { readOnly: true });
      const names = (before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map(row => row.name);
      const rows = Object.fromEntries(names.map(name => [name, rowsOf(before, name)]));
      before.close();
      store = await reopen(s);
      expect(tables(store)).toEqual(names);
      for (const name of names.filter(n => !REPAIRED_TABLES.includes(n))) expect([name, rowsOf(store.db, name)]).toEqual([name, rows[name]]);
      expect(group(store).status).toBe("draft");
    } finally { await dispose(s, store); }
  });
});
