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
  it("opens fresh stores at version 10", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      expect(schemaVersion).toBe("10");
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("10");
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
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("10");
      expect(["groups", "runs", "usage_ledger", "activity"].map(t => store.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("refuses future schema11 before changing the database bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "s11-")), dir = join(root, "s");
    try {
      (await openControlStore({ stateDir: dir })).close(); const db = new DatabaseSync(join(dir, "control.sqlite"));
      db.prepare("UPDATE meta SET value='11' WHERE key='schemaVersion'").run(); db.close();
      const before = await readFile(join(dir, "control.sqlite"));
      await expect(openControlStore({ stateDir: dir })).rejects.toThrow("control-schema-unsupported");
      expect(await readFile(join(dir, "control.sqlite"))).toEqual(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
