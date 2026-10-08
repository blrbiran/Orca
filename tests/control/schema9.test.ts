import { createRequire } from "node:module";
import type { DatabaseSync as Db } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";

// Vite cannot resolve the bare node:sqlite specifier; load it the way schema8.test.ts does.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function stateDir() { const root = await mkdtemp(join(tmpdir(), "s9-")); roots.push(root); return join(root, "s"); }
const version = (db: Db) => db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value;
const hasActivity = (db: Db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity'").get() !== undefined;

/** A store as a version-8 build leaves it: no activity table, meta at "8", rows seeded by `seed`. */
async function version8Store(seed: (raw: Db) => void): Promise<string> {
  const dir = await stateDir();
  (await openControlStore({ stateDir: dir })).close();
  const raw = new DatabaseSync(join(dir, "control.sqlite"));
  raw.exec("DROP TABLE activity");
  seed(raw);
  raw.prepare("UPDATE meta SET value='8' WHERE key='schemaVersion'").run();
  raw.close();
  return dir;
}

describe("schema 8 to 9 (issue-fixes spec §5.2, ruling H5)", () => {
  it("a fresh store is version 9 with the activity table: STRICT, group-referencing, both indexes", async () => {
    const store = await openControlStore({ stateDir: await stateDir() });
    try {
      expect(schemaVersion).toBe("9");
      expect(version(store.db)).toBe("9");
      expect(String(store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity'").get()!.sql)).toMatch(/STRICT\s*$/);
      expect(store.db.prepare("PRAGMA table_info(activity)").all().map((row) => [row.name, row.type, row.notnull])).toEqual([
        ["seq", "INTEGER", 0], ["group_id", "TEXT", 1], ["task_id", "TEXT", 0], ["run_id", "TEXT", 0], ["at", "INTEGER", 1], ["kind", "TEXT", 1], ["body", "TEXT", 1],
      ]);
      expect(store.db.prepare("PRAGMA foreign_key_list(activity)").all().map((row) => [row.from, row.table, row.to])).toEqual([["group_id", "groups", "id"]]);
      expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activity' ORDER BY name").all().map((row) => row.name))
        .toEqual(["activity_group_seq", "activity_run_seq"]);
    } finally { store.close(); }
  });

  // §5.3: the migration runs on the human's real store; every row it found stays byte-identical and the new table is empty.
  it("a populated version-8 store upgrades in place: every existing row kept, the activity table added and empty", async () => {
    const dir = await version8Store((raw) => {
      raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g1',3,2,'{\"groupId\":\"g1\"}')").run();
      raw.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-1','g1','w1',1,0,'{\"state\":\"settled\"}')").run();
      raw.prepare("INSERT INTO commands(group_id,id,payload_hash,result,client,principal) VALUES ('g1','old','h','{}','web','web')").run();
      raw.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (5,'g1','r',NULL,'run-work','m',1,2,3,4,10,'reported')").run();
    });
    const dump = (db: Db) => ["groups", "runs", "commands", "usage_ledger", "meta"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()
      .map((row) => (t === "meta" && (row as { key?: unknown }).key === "schemaVersion" ? null : row)));
    const raw = new DatabaseSync(join(dir, "control.sqlite"), { readOnly: true });
    const before = dump(raw);
    expect(hasActivity(raw)).toBe(false);
    raw.close();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(version(store.db)).toBe("9");
      expect(dump(store.db)).toEqual(before);
      expect(hasActivity(store.db)).toBe(true);
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM activity").get()).toMatchObject({ n: 0 });
    } finally { store.close(); }
  });

  // One-way (as 7 to 8 was): a store from a later build is refused, byte for byte unchanged.
  it("refuses a version-10 store and leaves its bytes unchanged", async () => {
    const dir = await stateDir();
    (await openControlStore({ stateDir: dir })).close();
    const raw = new DatabaseSync(join(dir, "control.sqlite"));
    raw.prepare("UPDATE meta SET value='10' WHERE key='schemaVersion'").run();
    raw.close();
    const bytes = await readFile(join(dir, "control.sqlite"));
    await expect(openControlStore({ stateDir: dir })).rejects.toThrow("control-schema-unsupported");
    expect(await readFile(join(dir, "control.sqlite"))).toEqual(bytes);
  });
});
