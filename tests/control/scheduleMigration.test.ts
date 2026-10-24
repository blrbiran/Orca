import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";
import { insertFlowRun } from "../../src/flow/store.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Scheduled flows and groups spec §12, criterion C11: the schema step adds `plan_library`, `plan_library_versions`,
 * `schedules` and `schedule_fires`, empty, and rewrites nothing that existed. The predecessor version is read from the
 * current one (never hard-coded), so this criterion follows the step to whatever number it takes at merge. Temp stores only.
 */
const NEW_TABLES = ["plan_library", "plan_library_versions", "schedule_fires", "schedules"];
const NEW_INDEXES = ["plan_library_by_project", "schedules_by_project"];
const predecessor = String(Number(schemaVersion) - 1);

type Db = InstanceType<typeof DatabaseSync>;
const tableSql = (db: Db) =>
  db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
const version = (db: Db) => String(db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value);

/** A populated predecessor store: groups, a flow run and repository settings, without the four tables. */
async function predecessorStore() {
  const root = await mkdtemp(join(tmpdir(), "s20-"));
  const dir = join(root, "s");
  const first = await openControlStore({ stateDir: dir, now: () => 1000 });
  first.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,3,1,?)").run("g1", JSON.stringify({ status: "draft", name: "one" }));
  first.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,'{}')").run("g-fr1");
  insertFlowRun(first, {
    id: "fr1", groupId: "g-fr1", templateRef: "t@1", templateSha256: "a".repeat(64), workspace: {}, vaultId: null, paramsSha256: "b".repeat(64),
    poolTokens: 10, poolDrawn: 0, state: "running", revision: 0, body: {},
  });
  first.db.prepare("INSERT INTO repository_settings(repo_id, body) VALUES (?,?)").run("repo1", JSON.stringify({ checks: {} }));
  first.close();
  const raw = new DatabaseSync(join(dir, "control.sqlite"));
  for (const index of NEW_INDEXES) raw.exec(`DROP INDEX ${index}`);
  for (const table of ["schedule_fires", "schedules", "plan_library_versions", "plan_library"]) raw.exec(`DROP TABLE ${table}`);
  raw.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(predecessor);
  const sql = tableSql(raw);
  const rows = Object.fromEntries(sql.map(({ name }) => [name, raw.prepare(`SELECT * FROM "${name}"`).all()]));
  raw.close();
  return { root, dir, sql, rows };
}

describe("schema step: plan library and schedules (C11)", () => {
  it("a fresh store is at the current version and has the four tables and both indexes", async () => {
    const root = await mkdtemp(join(tmpdir(), "s20-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try {
      expect(version(store.db)).toBe(schemaVersion);
      const names = tableSql(store.db).map((t) => t.name);
      for (const table of NEW_TABLES) expect(names).toContain(table);
      const indexes = store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
      for (const index of NEW_INDEXES) expect(indexes).toContain(index);
      for (const table of NEW_TABLES) expect(String(store.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table)!.sql).trimEnd().endsWith("STRICT")).toBe(true);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it(`${predecessor} -> ${schemaVersion}: the four tables exist and are empty, every pre-existing table's SQL and rows byte-equal, one backup`, async () => {
    const { root, dir, sql, rows } = await predecessorStore();
    expect(sql.map((t) => t.name)).not.toContain("schedules");
    const store = await openControlStore({ stateDir: dir, now: () => 2000 });
    try {
      expect(version(store.db)).toBe(schemaVersion);
      const after = tableSql(store.db);
      expect(after.filter((t) => NEW_TABLES.includes(t.name)).map((t) => t.name)).toEqual(NEW_TABLES);
      for (const table of NEW_TABLES) expect(store.db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()!.n).toBe(0);
      expect(after.filter((t) => !NEW_TABLES.includes(t.name))).toEqual(sql);
      for (const { name } of sql) {
        const now = store.db.prepare(`SELECT * FROM "${name}"`).all();
        const keep = (list: unknown[]) => name === "meta" ? list.filter((r) => (r as { key: string }).key !== "schemaVersion") : list;
        expect(keep(now)).toEqual(keep(rows[name]!));
      }
      const backups = (await readdir(dir)).filter((name) => name.startsWith("control.sqlite.pre-"));
      expect(backups).toEqual([`control.sqlite.pre-v${predecessor}-2000`]);
      const backup = new DatabaseSync(join(dir, backups[0]!), { readOnly: true });
      try { expect(version(backup)).toBe(predecessor); expect(tableSql(backup)).toEqual(sql); } finally { backup.close(); }
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("the tables carry the §12 constraints: UNIQUE(schedule_id, slot), UNIQUE(entry_id, sha256), state and outcome CHECKs", async () => {
    const root = await mkdtemp(join(tmpdir(), "s20-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try {
      const db = store.db;
      db.prepare("INSERT INTO plan_library VALUES ('pl-1','r','n','active','{}')").run();
      expect(() => db.prepare("INSERT INTO plan_library VALUES ('pl-2','r','n','gone','{}')").run()).toThrow(/CHECK/);
      const version = (v: number, sha: string) => db.prepare("INSERT INTO plan_library_versions VALUES ('pl-1',?,?,'{}','{}','p','web',1)").run(v, sha);
      version(1, "a");
      expect(() => version(2, "a")).toThrow(/UNIQUE/);
      expect(() => db.prepare("INSERT INTO plan_library_versions VALUES ('pl-x',1,'b','{}','{}','p','web',1)").run()).toThrow(/FOREIGN KEY/);
      db.prepare("INSERT INTO schedules(id,project_id,kind,revision,body) VALUES ('sch-a','r','group',0,'{}')").run();
      expect(() => db.prepare("INSERT INTO schedules(id,project_id,kind,revision,body) VALUES ('sch-b','r','cron',0,'{}')").run()).toThrow(/CHECK/);
      const fire = (seq: number, slot: number, outcome = "starting") =>
        db.prepare("INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,\"by\",via,body) VALUES ('sch-a',?,?,1,?,NULL,NULL,NULL,'orca-auto','schedule:sch-a','{}')").run(seq, slot, outcome);
      fire(1, 100);
      expect(() => fire(2, 100)).toThrow(/UNIQUE/);
      expect(() => fire(3, 200, "late")).toThrow(/CHECK/);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
});
