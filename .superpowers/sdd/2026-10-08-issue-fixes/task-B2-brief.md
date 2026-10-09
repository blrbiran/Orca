### Task B2: Schema v9 — the `activity` table, the allowlist and the migration chain

**Files:**
- Modify `src/control/migrations.ts` line 3 (`schemaVersion`), lines 99-102 (`schema7To8` / `initialSchema`),
  lines 117-127 (`migrateSchema`).
- Modify `src/control/store.ts` line 86 (the open allowlist).
- Modify `README.md` lines 146-147.
- Rewrite the six assertions of B.1 (`tests/control/requirementRecords.test.ts`, `tests/control/schema8.test.ts`,
  `tests/control/commandClient.test.ts`).
- Test: create `tests/control/schema9.test.ts`.

**Interfaces:**
- Produces: `schemaVersion === "9"`; `export const schema8To9: string`; table `activity(seq, group_id, task_id,
  run_id, at, kind, body)` with indexes `activity_group_seq`, `activity_run_seq`.

- [ ] **Step 1: Write the failing test** — create `tests/control/schema9.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/schema9.test.ts > $SCRATCH/B2.txt 2>&1; echo rc=$?`.
  Expected: test 1 `expected '8' to be '9'`; test 2 throws from `version8Store` (`no such table: activity`); test 3
  passes already (an unknown version was already refused) — that is fine, it pins the one-way bound.

- [ ] **Step 3: Implement.**

`src/control/migrations.ts` line 3: `export const schemaVersion = "9";`

After `export const schema7To8 = schema7To8Principal + schema7To8Tables + schema7To8PreLedger;` (line 99) add:

```ts
// Issue-fixes spec §5.2 (ruling H5): Orca's own wall-clock record of what happened in a group (activity.ts writes it).
// The spec's table, in the repo's style (STRICT, REFERENCES). IF NOT EXISTS for the reason schema5To6 gives: the older
// steps' downgrade criteria drop only their own tables, so a re-run chain meets this one already there.
export const schema8To9 = `CREATE TABLE IF NOT EXISTS activity(seq INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL REFERENCES groups(id), task_id TEXT, run_id TEXT, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS activity_group_seq ON activity(group_id,seq);
CREATE INDEX IF NOT EXISTS activity_run_seq ON activity(run_id,seq);
`;
```

`initialSchema` (line 102):

```ts
export const initialSchema = legacySchema + schema1To2 + schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7 + schema7To8 + schema8To9;
```

`migrateSchema` (lines 117-127) becomes:

```ts
export function migrateSchema(store: DatabaseSync, fromVersion: string): void {
  if (fromVersion === "1") store.exec(schema1To2 + schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "2") store.exec(schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "3") store.exec(schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "4") store.exec(schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "5") store.exec(schema5To6 + schema6To7);
  else if (fromVersion === "6") store.exec(schema6To7);
  else if (fromVersion !== "7" && fromVersion !== "8") throw new Error("control-schema-unsupported");
  // Every version before 8 goes through 7 to 8 first; 8 itself only gains the activity table (spec §5.2).
  if (fromVersion !== "8") migrate7To8(store);
  store.exec(schema8To9);
  store.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(schemaVersion);
}
```

`src/control/store.ts` line 86 — append `&& version !== "8"` before `) throw new ControlError("control-schema-unsupported");`:

```ts
        if (version !== schemaVersion && version !== "1" && version !== "2" && version !== "3" && version !== "4" && version !== "5" && version !== "6" && version !== "7" && version !== "8") throw new ControlError("control-schema-unsupported");
```

The six assertions of B.1, each with the comment line quoted there.

`README.md` lines 146-147 become:

```
  This build upgrades that store (`control.sqlite`) to schema version 9 on its first start (from 7 or 8; version 9 adds
  the activity record), and the upgrade is one-way (an older build refuses a version-9 store with
  `control-schema-unsupported`), so back up `control.sqlite` before you first start it.
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/schema9.test.ts tests/control/schema8.test.ts tests/control/commandClient.test.ts tests/control/requirementRecords.test.ts tests/control/store.test.ts tests/control/agentPreferences.test.ts tests/control/workspaceSettings.test.ts > $SCRATCH/B2.txt 2>&1; echo rc=$?` (rc=0, read whole file), then `npm run typecheck`.

- [ ] **Step 5: Mutation** — (a) store.ts: delete `&& version !== "8"` → red: "a populated version-8 store upgrades in place…"
  (`control-schema-unsupported`). (b) migrations.ts: delete `store.exec(schema8To9);` in `migrateSchema` → same test
  red (`hasActivity` false). (c) delete `+ schema8To9` from `initialSchema` → red: "a fresh store is version 9 with the
  activity table…".

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/migrations.ts src/control/store.ts README.md tests/control/schema9.test.ts tests/control/schema8.test.ts tests/control/commandClient.test.ts tests/control/requirementRecords.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): schema 9 adds the activity table, one-way from 8

Issue-fixes spec §5.2 (ruling H5): the activity table in the repo's STRICT/REFERENCES style,
the open allowlist accepts 8 and migrates every older version through 8 to 9. Six existing
version assertions move from 8 to 9 (spec §5.2); the README notes the one-way upgrade.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

