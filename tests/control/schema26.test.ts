import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { schemaVersion } from "../../src/control/migrations.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("acceptance baseline schema", () => {
  it("creates exact-key failure and suite-count baseline tables on a fresh schema 27 store", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-schema27-fresh-"));
    const store = await openControlStore({ stateDir: root });
    try {
      expect(schemaVersion).toBe("27");
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("27");
      expect(store.db.prepare("PRAGMA table_info(acceptance_failure_baselines)").all().map((row) => row.name)).toEqual([
        "repo_id", "base", "command", "setup_digest", "reporter", "identity", "file", "test_path_json", "diagnostic_hash",
        "source", "group_id", "run_id", "first_seen_at", "last_seen_at", "tests", "exit",
      ]);
      const failurePrimary = store.db.prepare("PRAGMA table_info(acceptance_failure_baselines)").all()
        .filter((row) => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((row) => row.name);
      expect(failurePrimary).toEqual(["repo_id", "base", "command", "setup_digest", "reporter", "identity"]);
      expect(store.db.prepare("PRAGMA table_info(acceptance_suite_baselines)").all().map((row) => row.name)).toEqual([
        "repo_id", "base", "command", "setup_digest", "reporter", "state", "tests", "exit", "source", "observed_at",
      ]);
      const suitePrimary = store.db.prepare("PRAGMA table_info(acceptance_suite_baselines)").all()
        .filter((row) => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((row) => row.name);
      expect(suitePrimary).toEqual(["repo_id", "base", "command", "setup_digest", "reporter"]);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("migrates a genuine schema 25 store and preserves existing rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-schema27-migrate-25-"));
    let store = await openControlStore({ stateDir: root });
    try {
      store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,?)").run('{"groupId":"g"}');
      store.close();
      const raw = new DatabaseSync(join(root, "control.sqlite"));
      raw.exec("DROP TABLE acceptance_failure_baselines; DROP TABLE acceptance_suite_baselines;");
      raw.prepare("UPDATE meta SET value='25' WHERE key='schemaVersion'").run();
      const before = raw.prepare("SELECT * FROM groups").all();
      raw.close();
      store = await openControlStore({ stateDir: root });
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("27");
      expect(store.db.prepare("SELECT * FROM groups").all()).toEqual(before);
      expect(store.db.prepare("SELECT count(*) AS n FROM acceptance_failure_baselines").get()!.n).toBe(0);
      expect(store.db.prepare("SELECT count(*) AS n FROM acceptance_suite_baselines").get()!.n).toBe(0);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("migrates a schema 26 store by adding only the suite-count table", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-schema27-migrate-26-"));
    let store = await openControlStore({ stateDir: root });
    try {
      store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,?)").run('{"groupId":"g"}');
      store.close();
      const raw = new DatabaseSync(join(root, "control.sqlite"));
      raw.exec("DROP TABLE acceptance_suite_baselines");
      raw.prepare("UPDATE meta SET value='26' WHERE key='schemaVersion'").run();
      raw.close();
      store = await openControlStore({ stateDir: root });
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("27");
      expect(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body).toBe('{"groupId":"g"}');
      expect(store.db.prepare("SELECT count(*) AS n FROM acceptance_suite_baselines").get()!.n).toBe(0);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("keeps an already-present suite-count table on a re-entered pre-26 migration path", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-schema27-existing-table-"));
    let store = await openControlStore({ stateDir: root });
    try {
      store.db.prepare(`INSERT INTO acceptance_suite_baselines
        (repo_id,base,command,setup_digest,reporter,state,tests,exit,source,observed_at)
        VALUES ('repo','base','npm test','setup','node-test-tap-v1','counted',552,'0','base-suite',123)`).run();
      store.close();
      const raw = new DatabaseSync(join(root, "control.sqlite"));
      raw.prepare("UPDATE meta SET value='25' WHERE key='schemaVersion'").run();
      raw.close();
      store = await openControlStore({ stateDir: root });
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("27");
      expect(store.db.prepare("SELECT tests, observed_at FROM acceptance_suite_baselines WHERE repo_id='repo'").get()).toEqual({ tests: 552, observed_at: 123 });
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
});
