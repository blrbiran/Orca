import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openControlStore } from "../../src/control/store.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { describe, expect, it } from "vitest";
import { webFixture, profileSnapshot } from "./fixtures/web.js";
import { schemaVersion } from "../../src/control/migrations.js";
describe("D9 one-way schema gate", () => {
  it("opens fresh stores at current version 16", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      expect(schemaVersion).toBe("19");
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("19");
    } finally { await h.dispose(); }
  });
});

describe("D9 migration preservation", () => {
  it("opens a populated genuine version9 schema without changing any existing row", async () => {
    const root = await mkdtemp(join(tmpdir(), "s10-")), dir = join(root, "s");
    let store = await openControlStore({ stateDir: dir });
    try {
      store.transaction(() => { store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',3,1,?)").run('{"groupId":"g","old":true}'); store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('r','g','a',1,0,?)").run('{"runId":"r","state":"settled"}'); });
      store.close();
      const raw = new DatabaseSync(join(dir, "control.sqlite")); raw.prepare("UPDATE meta SET value='9' WHERE key='schemaVersion'").run();
      const before = ["groups", "runs", "usage_ledger", "activity"].map(t => raw.prepare(`SELECT * FROM ${t}`).all()); raw.close();
      store = await openControlStore({ stateDir: dir });
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("19");
      expect(["groups", "runs", "usage_ledger", "activity"].map(t => store.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("opens a populated version13 store at 16 with every row byte-identical and an empty pending_decisions table", async () => {
    const root = await mkdtemp(join(tmpdir(), "s13-")), dir = join(root, "s");
    let store = await openControlStore({ stateDir: dir });
    try {
      store.transaction(() => { store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',3,1,?)").run('{"groupId":"g"}'); store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('r','g','a',1,0,?)").run('{"runId":"r"}'); });
      store.close();
      const raw = new DatabaseSync(join(dir, "control.sqlite")); raw.exec("DROP TABLE pending_decisions"); raw.prepare("UPDATE meta SET value='13' WHERE key='schemaVersion'").run();
      const before = ["groups", "runs", "usage_ledger", "activity"].map(t => raw.prepare(`SELECT * FROM ${t}`).all()); raw.close();
      store = await openControlStore({ stateDir: dir });
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("19");
      expect(["groups", "runs", "usage_ledger", "activity"].map(t => store.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
      expect(store.db.prepare("SELECT count(*) AS n FROM pending_decisions").get()!.n).toBe(0);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("opens a populated version14 store at 16 with every row byte-identical and the four orchestration tables empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "s14-")), dir = join(root, "s");
    let store = await openControlStore({ stateDir: dir });
    const added = ["flagged_decisions", "group_orchestration", "group_edges", "orchestration_settings"];
    try {
      store.transaction(() => { store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',3,1,?)").run('{"groupId":"g"}'); store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('r','g','a',1,0,?)").run('{"runId":"r"}'); });
      store.close();
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      for (const table of added) raw.exec(`DROP TABLE ${table}`);
      raw.prepare("UPDATE meta SET value='14' WHERE key='schemaVersion'").run();
      const before = ["groups", "runs", "usage_ledger", "activity", "pending_decisions"].map(t => raw.prepare(`SELECT * FROM ${t}`).all()); raw.close();
      store = await openControlStore({ stateDir: dir });
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("19");
      expect(["groups", "runs", "usage_ledger", "activity", "pending_decisions"].map(t => store.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
      expect(added.map((t) => store.db.prepare(`SELECT count(*) AS n FROM ${t}`).get()!.n)).toEqual([0, 0, 0, 0]);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("refuses future schema20 before changing the database bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "s11-")), dir = join(root, "s");
    try {
      (await openControlStore({ stateDir: dir })).close(); const db = new DatabaseSync(join(dir, "control.sqlite"));
      db.prepare("UPDATE meta SET value='20' WHERE key='schemaVersion'").run(); db.close();
      const before = await readFile(join(dir, "control.sqlite"));
      await expect(openControlStore({ stateDir: dir })).rejects.toThrow("control-schema-unsupported");
      expect(await readFile(join(dir, "control.sqlite"))).toEqual(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
