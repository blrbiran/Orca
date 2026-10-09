import { createRequire } from "node:module";
import type { DatabaseSync as Db } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandClientFor, commandPrincipalFor, withCommandClient, withCommandContext } from "../../src/control/commandClient.js";
import { applyWebCommand, type WebCommandContext } from "../../src/control/commandLedger.js";
import { createGroup } from "../../src/control/commands.js";
import type { EffectiveAuthorityCommandV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
import { migrateSchema, schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";
import { groupRepoIdOf } from "../../src/control/usageLedger.js";
import { openTestStore } from "./fixtures/store.js";

// Vite cannot resolve the bare node:sqlite specifier; load it the way the store and commandClient.test.ts do.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function stateDir() { const root = await mkdtemp(join(tmpdir(), "s8-")); roots.push(root); return join(root, "s"); }
const NEW_TABLES = ["usage_ledger", "spend_caps", "usage_calendar", "spend_settings", "spend_cap_blocks"];
const tables = (db: Db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name));
const columns = (db: Db, table: string) => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
const version = (db: Db) => db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value;

/** A store as a version-7 build leaves it: no principal column, none of the five tables, meta at "7". */
async function version7Store(seed: (raw: Db) => void): Promise<string> {
  const dir = await stateDir();
  (await openControlStore({ stateDir: dir })).close();
  const raw = new DatabaseSync(join(dir, "control.sqlite"));
  for (const t of NEW_TABLES) raw.exec(`DROP TABLE ${t}`);
  raw.exec("ALTER TABLE commands DROP COLUMN principal");
  seed(raw);
  raw.prepare("UPDATE meta SET value='7' WHERE key='schemaVersion'").run();
  raw.close();
  return dir;
}
const groupBody = (extra: Record<string, unknown>, tokens: unknown) => JSON.stringify({ ...extra, used: { tokens, activeMs: 0, attempts: 0, sessions: 0 } });

describe("schema 7 to 8 (accounts spec §5, §6, D3)", () => {
  it("a fresh store is at the current version (10) with the usage, cap and principal surfaces", async () => {
    const store = await openControlStore({ stateDir: await stateDir() });
    try {
      // Rewritten for issue-fixes spec §5.2 (ruling H5, 2026-10-08): the store is now at schema version 9.
      expect(schemaVersion).toBe("10");
      expect(tables(store.db)).toEqual(expect.arrayContaining(NEW_TABLES));
      expect(columns(store.db, "commands")).toContain("principal");
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get()).toMatchObject({ n: 0 });
    } finally { store.close(); }
  });

  it("a version-7 store upgrades and books each group's existing usage as one pre-ledger row, in no period", async () => {
    const dir = await version7Store((raw) => {
      raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,?)").run("g1", groupBody({ plan: { repoId: "r1" } }, 1234));
      raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,?)").run("g2", groupBody({ requirement: { repoId: "r2" } }, 5));
    });
    const store = await openControlStore({ stateDir: dir });
    try {
      // Rewritten for issue-fixes spec §5.2 (ruling H5, 2026-10-08): the store is now at schema version 9.
      expect(version(store.db)).toBe("10");
      const rows = store.db.prepare("SELECT applied_at,group_id,repo_id,source,model,tokens,quality FROM usage_ledger ORDER BY group_id").all();
      expect(rows).toEqual([
        { applied_at: 0, group_id: "g1", repo_id: "r1", source: "pre-ledger", model: null, tokens: 1234, quality: "unattributed" },
        { applied_at: 0, group_id: "g2", repo_id: "r2", source: "pre-ledger", model: null, tokens: 5, quality: "unattributed" },
      ]);
    } finally { store.close(); }
  });

  // Final review Minor 2: the pre-ledger row names the repository groupRepoIdOf names for the same body, so caps and
  // usage scoped to a repository count a group's pre-ledger usage and its later usage under one id. An empty string
  // or a non-string at an earlier path is skipped, never booked as the repository.
  it("the pre-ledger repository is groupRepoIdOf's for every body shape, skipping \"\" and non-strings", async () => {
    const bodies: Record<string, Record<string, unknown>> = {
      a: { plan: { repoId: "" }, requirement: { repoId: "ra" } },
      b: { plan: { repoId: 5 }, projectKey: "pb" },
      c: { requirement: { repoId: { x: 1 } }, projectKey: "pc" },
      d: { plan: { repoId: true }, requirement: { repoId: "" }, projectKey: "" },
      e: { plan: { repoId: "re" }, projectKey: "pe" },
    };
    const dir = await version7Store((raw) => {
      for (const [id, body] of Object.entries(bodies)) raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,?)").run(id, groupBody(body, 1));
    });
    const store = await openControlStore({ stateDir: dir });
    try {
      const booked = Object.fromEntries(store.db.prepare("SELECT group_id,repo_id FROM usage_ledger").all().map((row) => [String(row.group_id), row.repo_id]));
      expect(booked).toEqual({ a: "ra", b: "pb", c: "pc", d: null, e: "re" });
      expect(booked).toEqual(Object.fromEntries(Object.entries(bodies).map(([id, body]) => [id, groupRepoIdOf(body)])));
    } finally { store.close(); }
  });

  // §9: the migration runs on the human's real store. Everything it found stays byte-identical, a command written by a
  // version-7 build keeps principal null (unknown, not invented), and running the step again books nothing twice.
  it("an upgrade leaves every existing row as it was, and repeating the 7-to-8 step adds no second pre-ledger row", async () => {
    const dir = await version7Store((raw) => {
      raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,3,2,?)").run("g1", groupBody({ projectKey: "p1" }, 40));
      raw.prepare("INSERT INTO commands(group_id,id,payload_hash,result,client) VALUES ('g1','old','h','{}','cli:claude')").run();
      raw.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-1','g1','w1',1,0,'{\"phase\":\"work\"}')").run();
    });
    const dump = (db: Db) => ["groups", "commands", "runs", "meta"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()
      .map((row) => { const { principal: _p, ...rest } = row as Record<string, unknown>; return t === "meta" && rest.key === "schemaVersion" ? null : rest; }));
    const raw = new DatabaseSync(join(dir, "control.sqlite"), { readOnly: true });
    const before = dump(raw); raw.close();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(dump(store.db)).toEqual(before);
      expect(store.db.prepare("SELECT client,principal FROM commands WHERE id='old'").get()).toMatchObject({ client: "cli:claude", principal: null });
      expect(store.db.prepare("SELECT group_id,repo_id,tokens FROM usage_ledger").all()).toEqual([{ group_id: "g1", repo_id: "p1", tokens: 40 }]);
      store.db.exec("BEGIN IMMEDIATE"); migrateSchema(store.db, "7"); store.db.exec("COMMIT");
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get()).toMatchObject({ n: 1 });
      // Rewritten for issue-fixes spec §5.2 (ruling H5, 2026-10-08): the store is now at schema version 9.
      expect(version(store.db)).toBe("10");
    } finally { store.close(); }
  });

  // Refuses rather than half-migrates: a row the ledger cannot hold fails the whole step, and the store is left at version 7
  // exactly as it was (the migration runs in one transaction), so the human can repair the row and open again.
  it("a group the ledger cannot book fails the upgrade and leaves the version-7 store unchanged", async () => {
    const dir = await version7Store((raw) => {
      raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,?)").run("bad", groupBody({ projectKey: "p" }, -1));
    });
    await expect(openControlStore({ stateDir: dir })).rejects.toThrow(/CHECK constraint failed/);
    const raw = new DatabaseSync(join(dir, "control.sqlite"), { readOnly: true });
    try {
      expect(version(raw)).toBe("7");
      expect(columns(raw, "commands")).not.toContain("principal");
      expect(tables(raw).filter((t) => NEW_TABLES.includes(t))).toEqual([]);
    } finally { raw.close(); }
  });

  it("the command context answers client and principal only for its own commandId", async () => {
    await withCommandContext("cmd-a", { client: "web", principal: "user:u1" }, async () => {
      expect(commandPrincipalFor("cmd-a")).toBe("user:u1");
      expect(commandClientFor("cmd-a")).toBe("web");
      expect(commandPrincipalFor("cmd-b")).toBe(null);
    });
    expect(commandPrincipalFor("cmd-a")).toBe(null);
  });

  // D3: the ledger row names who delivered the command; actorId (inside the raw command hash) is untouched.
  it("a command written inside the context carries its principal on the ledger row, and none outside it", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, { groupId: "g1", projectKey: "example/repo", goal: "Ship", successConditions: ["checks pass"], limit: { tokens: 100, activeMs: 10000, attempts: 10, sessions: 10 },
        reviewReserve: { tokens: 10, activeMs: 1000, attempts: 1, sessions: 1 }, deadlineAt: null }, { commandId: "create", expectedRevision: 0, by: "human" });
      const persist = (commandId: string, expectedRevision: number) => {
        const command: RawAuthorityCommandV1 = { schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "panel-operator", verb: "handoff-stop", target: { kind: "group", groupId: "g1" }, payload: {} };
        return applyWebCommand(h.store, {
          rawCommand: command,
          expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { handoffDeadlineAt: "2026-09-20T10:00:00.000Z" } }) as EffectiveAuthorityCommandV1,
          apply: (context: WebCommandContext) => ({ status: 202, body: {
            schema: "orca-command-success-v1", commandId, actorId: command.actorId, verb: command.verb, target: command.target,
            commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
            effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
            result: { kind: "handoff-stopped", stopRevision: context.nextCommandRevision, acceptedAt: "2026-09-20T10:00:00.000Z", handoffDeadlineAt: "2026-09-20T10:00:00.000Z", frozenRunIds: [], requestIds: [] },
          } }) as never,
        });
      };
      withCommandContext("c-user", { client: "web", principal: "user:u1" }, () => persist("c-user", 1));
      withCommandClient("c-agent", "cli:claude", () => persist("c-agent", 2));
      withCommandClient("c-web", "web", () => persist("c-web", 3));
      persist("c-none", 4);
      expect(h.store.db.prepare("SELECT id,actor_id,client,principal FROM commands WHERE group_id='g1' AND id != 'create' ORDER BY rowid").all()).toEqual([
        { id: "c-user", actor_id: "panel-operator", client: "web", principal: "user:u1" },
        { id: "c-agent", actor_id: "panel-operator", client: "cli:claude", principal: "agent:cli:claude" },
        { id: "c-web", actor_id: "panel-operator", client: "web", principal: "web" },
        { id: "c-none", actor_id: "panel-operator", client: null, principal: null },
      ]);
    } finally { await h.dispose(); }
  });
});

// D9 correction (Codex implement_settlement, 2026-10-09, base 2c14e73): final current version is 10; future reader refusal uses 11. Existing schema preservation assertions are retained.
