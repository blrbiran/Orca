import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { schemaVersion } from "../../src/control/migrations.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("acceptance failure identity schema", () => {
  it("creates the exact-key baseline table on a fresh schema 26 store", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-schema26-fresh-"));
    const store = await openControlStore({ stateDir: root });
    try {
      expect(schemaVersion).toBe("26");
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("26");
      expect(store.db.prepare("PRAGMA table_info(acceptance_failure_baselines)").all().map((row) => row.name)).toEqual([
        "repo_id", "base", "command", "setup_digest", "reporter", "identity", "file", "test_path_json", "diagnostic_hash",
        "source", "group_id", "run_id", "first_seen_at", "last_seen_at", "tests", "exit",
      ]);
      const primary = store.db.prepare("PRAGMA table_info(acceptance_failure_baselines)").all()
        .filter((row) => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((row) => row.name);
      expect(primary).toEqual(["repo_id", "base", "command", "setup_digest", "reporter", "identity"]);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("migrates a genuine schema 25 store and preserves existing rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-schema26-migrate-"));
    let store = await openControlStore({ stateDir: root });
    try {
      store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,?)").run('{"groupId":"g"}');
      store.close();
      const raw = new DatabaseSync(join(root, "control.sqlite"));
      raw.exec("DROP TABLE acceptance_failure_baselines");
      raw.prepare("UPDATE meta SET value='25' WHERE key='schemaVersion'").run();
      const before = raw.prepare("SELECT * FROM groups").all();
      raw.close();
      store = await openControlStore({ stateDir: root });
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("26");
      expect(store.db.prepare("SELECT * FROM groups").all()).toEqual(before);
      expect(store.db.prepare("SELECT count(*) AS n FROM acceptance_failure_baselines").get()!.n).toBe(0);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
});
