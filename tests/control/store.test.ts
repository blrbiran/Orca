import { describe, it, expect } from "vitest";
import { chmod, cp, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { openControlStore } from "../../src/control/store.js";
import { legacySchema, schemaVersion } from "../../src/control/migrations.js";
import { openTestStore } from "./fixtures/store.js";

describe("control storage", () => {
  it("rolls back thrown transactions and persists committed rows across reopen", async () => {
    const h = await openTestStore();
    try {
      expect(() => h.store.transaction(() => {
        h.store.db.prepare("INSERT INTO meta VALUES (?,?)").run("probe", "one");
        throw new Error("abort");
      })).toThrow("abort");
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='probe'").get()).toBeUndefined();
      h.store.transaction(() => h.store.db.prepare("INSERT INTO meta VALUES (?,?)").run("saved", "two"));
      h.store.close();
      const reopened = await openControlStore({ stateDir: join(h.root, "state") });
      try { expect(reopened.db.prepare("SELECT value FROM meta WHERE key='saved'").get()?.value).toBe("two"); }
      finally { reopened.close(); }
    } finally { await h.dispose(); }
  });
  it("rejects async transaction callbacks and rolls back their synchronous writes", async () => {
    const h = await openTestStore();
    try {
      expect(() => h.store.transaction(async () => {
        h.store.db.prepare("INSERT INTO meta VALUES ('async','bad')").run();
      })).toThrow("control-async-transaction");
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='async'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });
  it("creates private files without changing existing permissions", async () => {
    const h = await openTestStore();
    try {
      expect((await stat(h.store.stateDir)).mode & 0o777).toBe(0o700);
      const db = join(h.store.stateDir, "control.sqlite");
      expect((await stat(db)).mode & 0o777).toBe(0o600);
      await chmod(db, 0o640); h.store.close();
      const reopened = await openControlStore({stateDir: h.store.stateDir});
      try { expect((await stat(db)).mode & 0o777).toBe(0o640); } finally { reopened.close(); }
    } finally { await h.dispose(); }
  });
  it("refuses a symlink state directory and a symlink ancestor below the canonical temp root", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-links-"));
    try {
      await symlink(root, join(root, "link"));
      await expect(openControlStore({ stateDir: join(root, "link") })).rejects.toThrow("control-path-symlink");
      await expect(openControlStore({ stateDir: join(root, "link", "nested") })).rejects.toThrow("control-path-symlink");
    } finally { await rm(root, {recursive:true, force:true}); }
  });
  it("rejects a second writer including recovery while the first owner is alive", async () => {
    const h = await openTestStore();
    try {
      await expect(openControlStore({stateDir:h.store.stateDir})).rejects.toThrow("control-writer-active");
      await expect(openControlStore({stateDir:h.store.stateDir,recovery:true})).rejects.toThrow("control-writer-active");
      h.store.transaction(() => h.store.db.prepare("INSERT INTO meta VALUES ('owner','alive')").run());
    } finally { await h.dispose(); }
  });
  it("does not migrate or rewrite an unknown schema version", async () => {
    const h = await openTestStore();
    try {
      h.store.db.prepare("UPDATE meta SET value='999' WHERE key='schemaVersion'").run();
      h.store.close();
      const before = await readFile(join(h.store.stateDir,"control.sqlite"));
      await expect(openControlStore({stateDir:h.store.stateDir})).rejects.toThrow("control-schema-unsupported");
      expect(await readFile(join(h.store.stateDir,"control.sqlite"))).toEqual(before);
    } finally { await h.dispose(); }
  });
  it("migrates schema 1 atomically and creates the durable Web control tables", async () => {
    const h = await openTestStore();
    const dbPath = join(h.store.stateDir,"control.sqlite");
    try {
      const identity = String(h.store.db.prepare("SELECT value FROM meta WHERE key='identity'").get()?.value);
      h.store.close();
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
      const legacy = new DatabaseSync(dbPath);
      try {
        legacy.exec("PRAGMA foreign_keys=OFF");
        for (const row of legacy.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as Array<{name:string;type:string}>) {
          if (row.type === "table") legacy.exec(`DROP TABLE ${row.name}`);
        }
        legacy.exec(legacySchema);
        legacy.prepare("INSERT INTO meta VALUES ('schemaVersion','1')").run();
        legacy.prepare("INSERT INTO meta VALUES ('identity',?)").run(identity);
        legacy.prepare("INSERT INTO groups VALUES ('legacy',4,1,'{}')").run();
      } finally {
        legacy.close();
      }

      const migrated = await openControlStore({stateDir:h.store.stateDir});
      try {
        expect(migrated.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value).toBe(schemaVersion);
        expect(migrated.db.prepare("SELECT revision,projection_seq FROM groups WHERE id='legacy'").get()).toEqual({revision:4,projection_seq:1});
        const tables = new Set(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));
        for (const table of ["projection_state","projection_journal","budget_proposals","estimates","execution_snapshots","stop_intents","recovery_blockers","scheduler_wakes","handoff_requests","handoff_request_joins"]) expect(tables).toContain(table);
      } finally {
        migrated.close();
      }
    } finally {
      await h.dispose();
    }
  });
  it("rejects a copied database at another canonical path", async () => {
    const h = await openTestStore();
    try {
      h.store.close();
      await cp(h.store.stateDir,join(h.root,"backup"),{recursive:true});
      await expect(openControlStore({stateDir:join(h.root,"backup")})).rejects.toThrow("control-host-mismatch");
    } finally { await h.dispose(); }
  });
  it("recovers a killed writer without retaining half a transaction or silently enabling dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(),"orca-crash-"));
    const child = spawn(process.execPath,["--import","tsx",resolve("tests/control/fixtures/store-crash.ts"),join(root,"state")],{stdio:["ignore","pipe","pipe"]});
    let output = ""; child.stderr.on("data", b => { output += b; });
    try {
      await new Promise<void>((ok,fail) => {
        const timer = setTimeout(() => fail(new Error("marker-timeout: "+output)),10000);
        child.stdout.on("data",b => { if (String(b).includes("IN_TRANSACTION")) { clearTimeout(timer); ok(); } });
        child.once("exit",code => {clearTimeout(timer);fail(new Error("early-exit: "+code+output));});
      });
      const exited = once(child,"exit"); child.kill("SIGKILL"); await exited;
      await expect(openControlStore({stateDir:join(root,"state")})).rejects.toThrow("control-writer-active");
      const recovered = await openControlStore({stateDir:join(root,"state"),recovery:true});
      try {
        expect(recovered.db.prepare("SELECT value FROM meta WHERE key='half'").get()).toBeUndefined();
        expect(recovered.dispatchBlocked).toBe(true);
      } finally { recovered.close(); }
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await rm(root,{recursive:true,force:true}); }
  });
});
