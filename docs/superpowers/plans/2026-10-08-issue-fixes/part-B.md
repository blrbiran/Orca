## Part B — Activity record and run times (spec §5)

Spec: `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §5 (ruling H5), §8, §9 step 3. Worktree
`/Users/biran/code/skills/loop/Orca-issues`, branch `fix/issues-20261008`. Line numbers below were measured on the
commit whose subject is `docs(spec): revise the issue-fixes design after independent review`; executors re-locate by
the quoted anchor text, never by number alone.

### B.0 Design decisions this part fixes (read before any task)

**1. How a projection change is recorded today, and why recordActivity never double-advances.**
`src/control/projectionJournal.ts` keeps one `TransactionState { changeSeq, groups: Set<string> }` per store for the
open transaction (`beginProjectionTransaction` / `finishProjectionTransaction`, called by `store.transaction`,
`store.ts:130,141`). `recordProjectionChange(store, groupIds)` (lines 64-67) → `recordInTransaction` (lines 29-62)
filters out every group already in `transaction.groups` (lines 32-33) and only then bumps `groups.projection_seq` and
journals it (lines 49-53); the global `change_seq` is bumped once per transaction (lines 41-46). So **calling
`recordProjectionChange(store, [groupId])` a second time in the same transaction is a no-op, whichever call comes
first.** `recordActivity` therefore simply inserts the row and calls `recordProjectionChange(store, [row.groupId])`:
if the writing site already recorded the group (before or after), nothing moves twice; if it did not (e.g.
`saveDispatchRun`, a raw `UPDATE`), the activity insert is what makes the 2-second summary poll re-read the open group
(`web/src/App.tsx` re-reads the open group when the summary's `changeSeq` is newer than the cached body's).

The one exception is the `command` row. `applyWebCommand` (`src/control/commandLedger.ts`) asserts after the apply that
the success body's `projectionSeq` equals the group's final `projection_seq` (`assertFinalVersions`, called at
line 366). A row that moved `projection_seq` after the body was built would make every such command fail
`control-command-result-invalid`. Every successful **group-scoped** command already records its group's projection
change (default `projectionGroupIds` = `[groupId]` when `authorityChanged`, line 355-359; the only five callers that pass
`projectionGroupIds: []` are global/repository/spend/operator scopes: `src/panel/controlLifecycle.ts:189`,
`src/control/workspaceSettings.ts:59`, `src/control/spendCommands.ts:27`, `src/control/integrationCommands.ts:42`,
`src/control/agentPreferences.ts:42`). So the command row is written with `appendActivity` (insert + retention, **no**
projection call), placed after the ledger's own `recordProjectionChange`. A future group command that records no
projection change would still get its row; the open view would show it on its next refresh.

**2. Transaction requirement.** `appendActivity` refuses with `control-projection-transaction-missing` (an existing
`internal` code, `errors.ts:228`) when no store transaction is open — a new projection-journal helper
`inProjectionTransaction(store)` answers that. This is what makes "a row exists iff its change committed" mechanical:
no site can write a row outside the change's transaction.

**3. Run state transitions go through one choke point.** Rather than hunting every `state = "settled…"` assignment, the
three functions that write a run body with a state change call `noteRunWrite(store, run)` (in `activity.ts`) before
writing: `saveRun` (`src/control/budget.ts:26`, which `saveDriverRun` wraps, so every driver step), `saveRunBody`
(`src/control/stopIntent.ts:173`, used by `terminaliseRun`), and `saveDispatchRun` (`src/control/webDispatch.ts:48`,
used by `settleProviderAttempt` and the attempt reservation). `noteRunWrite` reads the stored state
(`json_extract(body,'$.state')`) and, only when it differs:
- new state `blocked` → `run-blocked {blockedAt, reason}` from `drive.blockedAt` / `drive.blockedReason`;
- new state in `RUN_ENDED_STATES` (`landed`, `settled`, `settled-recoverable`, `settled-restartable`,
  `settled-unrecoverable`, `failed-before-provider`) → stamps `endedAt = store.now()` on the body about to be written
  **only if absent**, and writes `run-settled {state, outcome, stopReason?}` (`outcome` = `drive.outcome ?? null`;
  `stopReason` copied when the drive record carries a string `stopReason`, which Part D adds).
Every other raw run-body writer was checked: `driveRecord.ts:106` (resume — handled explicitly as `run-resumed`),
`requirementCalls.ts:152` (adds `overview`, no state change), and the `INSERT INTO runs` sites (claims). There is no
`json_set` write of runs in `src/`.

Verified sites (each is inside a `store.transaction`): `executionDriver.ts` `blockRun` (line 147), `stepA1` refuse
(227), `persistStatus` block (396), `stepC` landed (550), `stepCSingleCall` settled-restartable (645);
`driverLanding.ts` landed (46, 364); `budget.ts` `releaseRunReserve` settled (169, 176); `driverHandoff.ts` H-settle
(346); `stopIntent.ts` `terminaliseRun` (via `saveRunBody`); `webDispatch.ts` `settleProviderAttempt`
failed-before-provider (371). A run that is re-blocked while already `blocked` (the driver's catch path keeps it
blocked and appends the new error) writes no second row — the state did not change.

**4. Kind by kind: the writing site, its transaction, and whether the activity insert itself moves the projection.**

| Kind | Site (task) | Transaction | Site already records the group's projection change? | Net effect of recordActivity's projection call |
|---|---|---|---|---|
| `command` | `applyWebCommand`, after line 359 (B7) | `applyWebCommand`'s own | yes, always, for group scope (see 1) | n/a — `appendActivity`, no call |
| `run-claimed` | `createStartingRun`, after `saveWork` (B5) | `deliverScheduledStart`'s (webDispatch.ts:206) | yes — `saveWork` changes `status`/`currentRunId` | no-op |
| `run-started` | `reserveProviderAttemptInTransaction` (B5) | `stepA1`'s `write` / `beginProviderAttempt`'s | **no** — `saveDispatchRun` is a raw UPDATE; A1's later `saveDriverRun` does, `beginProviderAttempt` alone does not | records it (A1: deduped with the later `saveDriverRun`) |
| `phase` | `collectInto` progress write (B6) | its `write` | yes — `saveDriverRun` with a changed body | no-op (existing criterion `driverProgress.test.ts` "P3: … each change moves changeSeq exactly once" keeps guarding it) |
| `run-blocked` | `noteRunWrite` (B4) | caller's | `saveRun`: yes (body changed); `saveRunBody`/`saveDispatchRun`: no | records when needed |
| `run-resumed` | `retryRun` in `stopIntent.ts` (B8) | `applyRecoveryRetry`'s command | yes — `resumeBlockedDriverRun` line 107 and the ledger | no-op |
| `run-settled` | `noteRunWrite` (B4) | caller's | as `run-blocked` | records when needed |
| `stop` | `applyPauseDispatch`, `applyHandoffStop` applies; `applyPanelShutdown` apply (B9) | the command's | pause/handoff: the ledger, after the apply (deduped either way; the body's `projectionSeq` is `nextProjectionSeq`, so the order is immaterial); shutdown: `shutdownGroup` line 172 | no-op |
| `integration` | `integrationPass.ts` `settle`, after `saveGroup` (B10) | its `write` | yes — `saveGroup` | no-op |

`stop-cleared`, `task-retried`, `archived`, `unarchived` are written by Parts C, D, E with `recordActivity`.

**5. Why `stop` and `run-resumed` are written at the command sites, not in `saveStopIntent` / `resumeBlockedDriverRun`.**
Existing criteria call those two helpers directly, outside any transaction
(`tests/panel/shutdownDriverGroup.test.ts` calls `shutdownGroup` 8 times, `tests/panel/controlLifecycle.test.ts:245`,
`tests/control/driveRecord.test.ts:78` calls `resumeBlockedDriverRun`). Writing the row inside the helpers would make
those criteria throw `control-projection-transaction-missing` and need rewriting; writing at the transactional callers
needs no rewrite and covers every production path (`saveStopIntent` has exactly three callers: pause, handoff,
shutdown; `resumeBlockedDriverRun` has one: `retryRun`).

**6. Clock injection in tests.** `openControlStore` gains `now?: () => number`; `tests/control/fixtures/store.ts`
`openTestStore(options?: { now?: () => number })`; `webFixture` gains option `storeNow?: () => number` and
`driverHarness` option `storeNow?: () => number`, passed through. (`storeNow`, not `now`, because driver/stop deps
already have a Date-valued `now` for handoff grace.) Tests drive a mutable `let clock` through `storeNow: () => clock`.

**7. Wire shape.** New fields on the server zod schemas are `.optional()` on the wire with the server always giving them
(the precedent of run `git` and work item `progress`), and optional on the Web mirror: no existing literal fixture
(`tests/control/webProtocol.test.ts:338`, the Web fixtures) needs an edit, and the parity criterion's assignability
holds both ways without normalisation. A criterion asserts the server does give them.

### B.1 Existing tests rewritten by this part (spec §5.2 "`schemaVersion` becomes "9"", §5.3 first bullet)

| File | Test name | Current line | Current | Replacement |
|---|---|---|---|---|
| `tests/control/requirementRecords.test.ts` | "migrates a version-5 store by adding the two tables, leaving every existing row byte-identical" | 27 | `expect(schemaVersion).toBe("8");` | `expect(schemaVersion).toBe("9");` |
| `tests/control/schema8.test.ts` | "a fresh store is version 8 with the usage, cap and principal surfaces" → renamed "a fresh store is at the current version (9) with the usage, cap and principal surfaces" | 41, 44 | `expect(schemaVersion).toBe("8");` | `expect(schemaVersion).toBe("9");` |
| `tests/control/schema8.test.ts` | "a version-7 store upgrades and books each group's existing usage as one pre-ledger row, in no period" | 58 | `expect(version(store.db)).toBe("8");` | `expect(version(store.db)).toBe("9");` |
| `tests/control/schema8.test.ts` | "an upgrade leaves every existing row as it was, and repeating the 7-to-8 step adds no second pre-ledger row" | 108 | `expect(version(store.db)).toBe("8");` | `expect(version(store.db)).toBe("9");` |
| `tests/control/commandClient.test.ts` | "a fresh store has commands.client and is at the current version (8)" → renamed "… (9)" | 41, 44 | `expect(schemaVersion).toBe("8");` | `expect(schemaVersion).toBe("9");` |
| `tests/control/commandClient.test.ts` | "a version-6 store upgrades, and a row written before keeps client null" | 60 | `.toMatchObject({ value: "8" });` | `.toMatchObject({ value: "9" });` |

Each rewritten line gets a comment above it:
`// Rewritten for issue-fixes spec §5.2 (ruling H5, 2026-10-08): the store is now at schema version 9.`

No other existing assertion changes. The downgrade criteria of older steps (`schema8.test.ts` `version7Store`,
`requirementRecords.test.ts`, `commandClient.test.ts`, `agentPreferences.test.ts`, `workspaceSettings.test.ts`,
`store.test.ts` "migrates schema 1") keep the `activity` table in place and re-run the chain; they pass unchanged
because the 8→9 step is `IF NOT EXISTS` (the repo's convention, `migrations.ts:69-70`).

### B.2 Executor notes (all tasks)

- `SCRATCH` = the executor's session scratchpad. Test runs: `cd /Users/biran/code/skills/loop/Orca-issues &&
  ./node_modules/.bin/vitest run <files> > $SCRATCH/<task>.txt 2>&1; echo rc=$?`, then read the whole file.
- Mutations: after Step 6's commit, `git clone --local /Users/biran/code/skills/loop/Orca-issues $SCRATCH/mut-<task>`,
  `ln -s /Users/biran/code/skills/loop/Orca-issues/node_modules $SCRATCH/mut-<task>/node_modules` (and
  `ln -s /Users/biran/code/skills/loop/Orca-issues/web/node_modules $SCRATCH/mut-<task>/web/node_modules` for B11),
  apply the named edit there, run the named test, see it red, delete nothing in the worktree. A mutation not seen red
  is fixed by strengthening the criterion in a follow-up commit (no amend).
- If any existing criterion fails with `control-projection-transaction-missing` after B4, a run-state write happens
  outside a transaction somewhere this plan did not find: stop and report the stack (do not wrap the call site blindly).
- `git add` explicit paths only.

---

### Task B1: Injectable store clock

**Files:**
- Modify `src/control/store.ts` lines 36-44 (`export interface ControlStore`), 45 (`openControlStore` signature),
  118-120 (store object literal).
- Modify `tests/control/fixtures/store.ts` lines 5-9 (`openTestStore`).
- Modify `tests/control/fixtures/web.ts` lines 39-50 (`WebFixtureOptions`), 56 (`const h = await openTestStore();`).
- Modify `tests/control/fixtures/driverHarness.ts` lines 20-41 (`HarnessOptions`), 48 (`webFixture(...)` call).
- Test: create `tests/control/activity.test.ts`.

**Interfaces:**
- Produces: `ControlStore.now(): number`; `openControlStore(options: { stateDir: string; recovery?: boolean; now?: () => number })`;
  `openTestStore(options?: { now?: () => number })`; `WebFixtureOptions.storeNow?: () => number`;
  `HarnessOptions.storeNow?: () => number`.

- [ ] **Step 1: Write the failing test** — create `tests/control/activity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openTestStore } from "./fixtures/store.js";
import { webFixture } from "./fixtures/web.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Issue-fixes spec §5 (ruling H5): Orca's own wall-clock record. Every time it writes comes from the store's clock,
// which tests inject so a criterion can name the exact instant a row or a run time must carry.
describe("the control store's clock (issue-fixes spec §5.2)", () => {
  it("answers the injected clock, and Date.now when none is given", async () => {
    let clock = 1_234;
    const fixed = await openTestStore({ now: () => clock });
    const plain = await openTestStore();
    try {
      expect(fixed.store.now()).toBe(1_234);
      clock = 5_678;
      expect(fixed.store.now()).toBe(5_678);
      const before = Date.now();
      const read = plain.store.now();
      expect(read).toBeGreaterThanOrEqual(before);
      expect(read).toBeLessThanOrEqual(Date.now());
    } finally { await fixed.dispose(); await plain.dispose(); }
  });

  it("reaches the store through the Web fixture and the driver harness", async () => {
    const h = await webFixture(undefined, undefined, { storeNow: () => 42 });
    try { expect(h.store.now()).toBe(42); } finally { await h.dispose(); }
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => 7 });
    try { expect(t.h.store.now()).toBe(7); } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activity.test.ts > $SCRATCH/B1.txt 2>&1; echo rc=$?`.
  Expected: both tests fail with `TypeError: fixed.store.now is not a function` / `h.store.now is not a function`.

- [ ] **Step 3: Implement.**

`src/control/store.ts` — the interface:

```ts
export interface ControlStore {
  readonly stateDir:string;
  readonly db:DatabaseSync;
  dispatchBlocked:boolean;
  /** Issue-fixes spec §5.2: the store's clock, ms since the epoch; injected at open (tests), Date.now otherwise. */
  now():number;
  transaction<T>(fn:()=>T):T;
  assertOwner():void;
  beginOperation():()=>void;
  close():void;
}
export async function openControlStore(options:{stateDir:string;recovery?:boolean;now?:()=>number}):Promise<ControlStore> {
```

and the object literal (anchor `stateDir, db:connection, dispatchBlocked:`):

```ts
    const store:ControlStore = {
      stateDir, db:connection, dispatchBlocked:recovered || !!connection.prepare("SELECT id FROM runs WHERE active=1 LIMIT 1").get(),
      now:options.now ?? Date.now,
      assertOwner,
```

`tests/control/fixtures/store.ts`:

```ts
/** Issue-fixes spec §5.2: `now` is the store's clock (ms); absent, the store reads Date.now. */
export async function openTestStore(options: { now?: () => number } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-control-")));
  const store = await openControlStore({ stateDir: join(root, "state"), ...(options.now ? { now: options.now } : {}) });
  return { root, store, async dispose() { store.close(); await rm(root, { recursive: true, force: true }); } };
}
```

`tests/control/fixtures/web.ts` — add to `WebFixtureOptions` after `requiredChecks?: string[];`:

```ts
  /** Issue-fixes spec §5.2: the control store's clock (ms); absent, Date.now. */
  storeNow?: () => number;
```

and replace `const h = await openTestStore();` (line 56) with:

```ts
  const h = await openTestStore(options.storeNow ? { now: options.storeNow } : {});
```

`tests/control/fixtures/driverHarness.ts` — add to `HarnessOptions` after `agentKinds?: AgentsView;`:

```ts
  /** Issue-fixes spec §5.2: the control store's clock (ms); absent, Date.now. */
  storeNow?: () => number;
```

and replace the `webFixture(...)` call (line 48) with:

```ts
  const h = await webFixture(snapshot, tasks, { killGraceMs: options.killGraceMs, planAgents: options.planAgents, ...(options.distinctConfigHash ? { distinctConfigHash: true } : {}), ...(options.storeNow ? { storeNow: options.storeNow } : {}) });
```

- [ ] **Step 4: Run, expect PASS** — same command; then `npm run typecheck > $SCRATCH/B1-tsc.txt 2>&1; echo rc=$?` (rc=0).

- [ ] **Step 5: Mutation** — in the clone, `src/control/store.ts`: `now:options.now ?? Date.now,` → `now:Date.now,`.
  Red: "answers the injected clock, and Date.now when none is given" (`expected 1234`). Second mutation: in
  `tests/control/fixtures/web.ts` revert to `openTestStore()`; red: "reaches the store through the Web fixture and the
  driver harness".

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/store.ts tests/control/fixtures/store.ts tests/control/fixtures/web.ts tests/control/fixtures/driverHarness.ts tests/control/activity.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): give the control store an injectable clock

Issue-fixes spec §5.2: the store's now() is Date.now unless a caller injects one; the
test store, Web fixture and driver harness pass a clock through.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

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

### Task B3: `src/control/activity.ts` — writer, retention, readers

**Files:**
- Create `src/control/activity.ts`.
- Modify `src/control/projectionJournal.ts` after line 67 (`recordProjectionChange`).
- Test: extend `tests/control/activity.test.ts`.

**Interfaces:**
- Consumes: `recordProjectionChange` (projectionJournal.ts:64), `ControlStore.now()` (B1), table `activity` (B2).
- Produces (shared, exact names): `ActivityKind`, `ActivityRow`, `ActivityEntry`,
  `recordActivity(store, row): void`, `readGroupActivity(store, groupId, limit): ActivityEntry[]`,
  `readRunActivity(store, runId, limit): ActivityEntry[]`, `latestGroupActivityAt(store, groupId): number | null`.
  Also `ACTIVITY_KINDS` (readonly tuple of the 13 kinds), `ACTIVITY_RETENTION = 500`,
  `appendActivity(store, row): void` (insert + retention, no projection call — commandLedger only), and in
  projectionJournal.ts `inProjectionTransaction(store): boolean`.

- [ ] **Step 1: Write the failing test** — append to `tests/control/activity.test.ts` (add these imports at the top):

```ts
import { ACTIVITY_RETENTION, latestGroupActivityAt, readGroupActivity, readRunActivity, recordActivity, type ActivityRow } from "../../src/control/activity.js";
import { createGroup } from "../../src/control/commands.js";
import { readProjectionState, recordProjectionChange } from "../../src/control/projectionJournal.js";
import type { ControlStore } from "../../src/control/store.js";
```

```ts
function seedGroup(store: ControlStore, groupId: string): void {
  createGroup(store, { groupId, projectKey: "example/repo", goal: "Ship", successConditions: ["checks pass"], limit: { tokens: 100, activeMs: 10000, attempts: 10, sessions: 10 },
    reviewReserve: { tokens: 10, activeMs: 1000, attempts: 1, sessions: 1 }, deadlineAt: null }, { commandId: "create", expectedRevision: 0, by: "human" });
}
const projectionSeq = (store: ControlStore, groupId: string): number => Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id=?").get(groupId)!.projection_seq);
const rowCount = (store: ControlStore): number => Number(store.db.prepare("SELECT COUNT(*) AS n FROM activity").get()!.n);
const phase = (groupId: string, i: number): ActivityRow => ({ groupId, taskId: "t1", runId: "r1", kind: "phase", body: { step: "planning", attempt: i } });

describe("recordActivity (issue-fixes spec §5.2)", () => {
  it("writes one row stamped with the store's clock and moves the group's projection once, so the open view refreshes", async () => {
    let clock = 10;
    const h = await openTestStore({ now: () => clock });
    try {
      seedGroup(h.store, "g1");
      const before = projectionSeq(h.store, "g1"), change = readProjectionState(h.store).changeSeq;
      clock = 20;
      h.store.transaction(() => recordActivity(h.store, phase("g1", 1)));
      expect(readGroupActivity(h.store, "g1", 10)).toEqual([
        { seq: expect.any(Number), groupId: "g1", taskId: "t1", runId: "r1", at: 20, kind: "phase", body: { step: "planning", attempt: 1 } },
      ]);
      expect(projectionSeq(h.store, "g1")).toBe(before + 1);
      expect(readProjectionState(h.store).changeSeq).toBe(change + 1);
    } finally { await h.dispose(); }
  });

  // §5.2 "Change notification": a change that recorded its own projection change is not advanced a second time.
  it("never moves projection_seq twice in one transaction: not after the site's own change, not for a second row", async () => {
    const h = await openTestStore();
    try {
      seedGroup(h.store, "g1");
      const before = projectionSeq(h.store, "g1"), change = readProjectionState(h.store).changeSeq;
      h.store.transaction(() => { recordProjectionChange(h.store, ["g1"]); recordActivity(h.store, phase("g1", 1)); recordActivity(h.store, phase("g1", 2)); });
      expect(rowCount(h.store)).toBe(2);
      expect(projectionSeq(h.store, "g1")).toBe(before + 1);
      expect(readProjectionState(h.store).changeSeq).toBe(change + 1);
    } finally { await h.dispose(); }
  });

  // §5.3: a rolled-back change writes no row; no caller can write one outside its change's transaction.
  it("refuses to write outside a transaction, and a rolled-back transaction leaves no row and no projection move", async () => {
    const h = await openTestStore();
    try {
      seedGroup(h.store, "g1");
      const before = projectionSeq(h.store, "g1");
      expect(() => recordActivity(h.store, phase("g1", 1))).toThrow("control-projection-transaction-missing");
      expect(() => h.store.transaction(() => { recordActivity(h.store, phase("g1", 2)); throw new Error("rolled back"); })).toThrow("rolled back");
      expect(rowCount(h.store)).toBe(0);
      expect(projectionSeq(h.store, "g1")).toBe(before);
    } finally { await h.dispose(); }
  });

  // §5.2 Retention: the newest 500 of a group, and never another group's rows (g2's are the oldest in the table).
  it("keeps exactly a group's newest 500 rows and never touches another group's", async () => {
    const h = await openTestStore();
    try {
      seedGroup(h.store, "g1"); seedGroup(h.store, "g2");
      expect(ACTIVITY_RETENTION).toBe(500);
      h.store.transaction(() => {
        for (let i = 0; i < 3; i += 1) recordActivity(h.store, { groupId: "g2", kind: "stop", body: { i } });
        for (let i = 0; i < 505; i += 1) recordActivity(h.store, { groupId: "g1", kind: "stop", body: { i } });
      });
      expect(readGroupActivity(h.store, "g1", 1_000).map((entry) => entry.body.i)).toEqual(Array.from({ length: 500 }, (_, k) => 504 - k));
      expect(readGroupActivity(h.store, "g2", 1_000).map((entry) => entry.body.i)).toEqual([2, 1, 0]);
    } finally { await h.dispose(); }
  });

  // §5.2 Reads: newest first by seq; a run's rows only; the group's newest row is by seq, not by the largest time.
  it("reads newest first by seq, filters a run's rows, and answers the newest row's time even when the clock went back", async () => {
    let clock = 50;
    const h = await openTestStore({ now: () => clock });
    try {
      seedGroup(h.store, "g1"); seedGroup(h.store, "g2");
      h.store.transaction(() => recordActivity(h.store, { groupId: "g1", runId: "r1", kind: "run-claimed", body: { claimOrdinal: 1 } }));
      clock = 10;
      h.store.transaction(() => recordActivity(h.store, { groupId: "g1", runId: "r2", kind: "run-claimed", body: { claimOrdinal: 1 } }));
      clock = 30;
      h.store.transaction(() => recordActivity(h.store, { groupId: "g1", runId: "r1", kind: "run-started", body: { providerAttemptOrdinal: 1 } }));
      expect(readRunActivity(h.store, "r1", 10).map((entry) => [entry.kind, entry.at])).toEqual([["run-started", 30], ["run-claimed", 50]]);
      expect(readGroupActivity(h.store, "g1", 2).map((entry) => entry.at)).toEqual([30, 10]);
      expect(latestGroupActivityAt(h.store, "g1")).toBe(30);
      expect(latestGroupActivityAt(h.store, "g2")).toBeNull();
      expect(() => readGroupActivity(h.store, "g1", 0)).toThrow("query-invalid");
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activity.test.ts > $SCRATCH/B3.txt 2>&1; echo rc=$?`.
  Expected: the file fails to load: `Failed to resolve import "../../src/control/activity.js"`.

- [ ] **Step 3: Implement.**

`src/control/projectionJournal.ts`, after `recordProjectionChange` (line 67):

```ts
/** Issue-fixes spec §5.2: whether `store` has a transaction open -- an activity row is written only inside one. */
export function inProjectionTransaction(store: ControlStore): boolean {
  return transactions.has(store);
}
```

Create `src/control/activity.ts`:

```ts
import { ControlError } from "./errors.js";
import { inProjectionTransaction, recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";

/**
 * Issue-fixes spec §5 (ruling H5): Orca's own wall-clock record of what happened in a group. A row is written inside the
 * transaction that makes its change, so it exists if and only if the change committed; a replayed command writes none.
 * Group-scoped kinds only (§1 non-goals).
 */
export type ActivityKind = "command" | "run-claimed" | "run-started" | "phase" | "run-blocked" | "run-resumed" | "run-settled" | "task-retried" | "integration" | "stop" | "stop-cleared" | "archived" | "unarchived";
export const ACTIVITY_KINDS = [
  "command", "run-claimed", "run-started", "phase", "run-blocked", "run-resumed", "run-settled", "task-retried", "integration", "stop", "stop-cleared", "archived", "unarchived",
] as const satisfies readonly ActivityKind[];
export type ActivityRow = { groupId: string; taskId?: string | null; runId?: string | null; kind: ActivityKind; body: Record<string, unknown> };
export type ActivityEntry = { seq: number; groupId: string; taskId: string | null; runId: string | null; at: number; kind: ActivityKind; body: Record<string, unknown> };

/** §5.2 Retention: a group keeps its newest 500 rows. Run times live on the run body, so this only shortens the feed. */
export const ACTIVITY_RETENTION = 500;

/**
 * The insert (stamped with the store's clock) and the group's retention, with no projection change. Only
 * applyWebCommand calls it directly: a command's success body has already named its projectionSeq, and every
 * group-scoped command records its group's projection change itself (commandLedger.ts). Everyone else calls recordActivity.
 */
export function appendActivity(store: ControlStore, row: ActivityRow): void {
  if (!inProjectionTransaction(store)) throw new ControlError("control-projection-transaction-missing", "activity");
  store.db.prepare("INSERT INTO activity(group_id,task_id,run_id,at,kind,body) VALUES (?,?,?,?,?,?)")
    .run(row.groupId, row.taskId ?? null, row.runId ?? null, store.now(), row.kind, JSON.stringify(row.body));
  store.db.prepare("DELETE FROM activity WHERE group_id=? AND seq <= (SELECT seq FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT 1 OFFSET ?)")
    .run(row.groupId, row.groupId, ACTIVITY_RETENTION);
}

/**
 * §5.2 "Change notification": the row, then the group's projection change, so the summary poll re-reads the open group.
 * recordProjectionChange moves a group at most once per transaction (projectionJournal.ts skips a group the transaction
 * already recorded, whichever call came first), so a change that recorded its own is never advanced a second time.
 */
export function recordActivity(store: ControlStore, row: ActivityRow): void {
  appendActivity(store, row);
  recordProjectionChange(store, [row.groupId]);
}

const COLUMNS = "seq,group_id,task_id,run_id,at,kind,body";

function entryOf(row: Record<string, unknown>): ActivityEntry {
  const seq = Number(row.seq), kind = String(row.kind);
  let body: unknown = null;
  try { body = JSON.parse(String(row.body)); } catch { body = null; }
  if (body === null || typeof body !== "object" || Array.isArray(body) || !(ACTIVITY_KINDS as readonly string[]).includes(kind)) {
    throw new ControlError("recovery-blocked", `activity-invalid:${seq}`);
  }
  return {
    seq, groupId: String(row.group_id), taskId: row.task_id === null ? null : String(row.task_id), runId: row.run_id === null ? null : String(row.run_id),
    at: Number(row.at), kind: kind as ActivityKind, body: body as Record<string, unknown>,
  };
}

function checkedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new ControlError("query-invalid");
  return limit;
}

/** §5.2 Reads: a group's newest rows, newest first (by seq). */
export function readGroupActivity(store: ControlStore, groupId: string, limit: number): ActivityEntry[] {
  return store.db.prepare(`SELECT ${COLUMNS} FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT ?`).all(groupId, checkedLimit(limit)).map(entryOf);
}

/** §5.2 Reads: a run's newest rows, newest first (by seq). */
export function readRunActivity(store: ControlStore, runId: string, limit: number): ActivityEntry[] {
  return store.db.prepare(`SELECT ${COLUMNS} FROM activity WHERE run_id=? ORDER BY seq DESC LIMIT ?`).all(runId, checkedLimit(limit)).map(entryOf);
}

/** §5.2: the `at` of the group's newest row by seq (the group summary's updatedAt, Part E); null with no row. */
export function latestGroupActivityAt(store: ControlStore, groupId: string): number | null {
  const row = store.db.prepare("SELECT at FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT 1").get(groupId);
  return row === undefined ? null : Number(row.at);
}
```

- [ ] **Step 4: Run, expect PASS** — same command (rc=0); `npm run typecheck` (rc=0).

- [ ] **Step 5: Mutation** — (a) `appendActivity`: delete the `inProjectionTransaction` line → red: "refuses to write outside a
  transaction…" (the outside call no longer throws; with no transaction the row commits on its own). (b)
  `recordActivity`: delete `recordProjectionChange(...)` → red: "writes one row … moves the group's projection once".
  (c) retention: drop `group_id=? AND ` and the first bind from the DELETE (global retention) → red: "keeps exactly a
  group's newest 500 rows and never touches another group's" (g2's rows deleted). (d) `latestGroupActivityAt`:
  `ORDER BY seq DESC` → `ORDER BY at DESC` → red: "reads newest first by seq…" (answers 50).

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/activity.ts src/control/projectionJournal.ts tests/control/activity.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record group activity inside the change's transaction

Issue-fixes spec §5.2: recordActivity inserts a row stamped with the store clock, keeps a
group's newest 500 and records the group's projection change through the existing
once-per-transaction helper; it refuses to write outside a transaction. Readers answer a
group's or a run's rows newest first and the group's latest time.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B4: Run state transitions — `run-blocked`, `run-settled`, `endedAt`

**Files:**
- Modify `src/control/activity.ts` (append).
- Modify `src/control/budget.ts` lines 14-21 (`RunRecord`), 26-27 (`saveRun`), imports (line 11).
- Modify `src/control/stopIntent.ts` lines 173-176 (`saveRunBody`), imports.
- Modify `src/control/webDispatch.ts` lines 48-50 (`saveDispatchRun`), imports.
- Modify `src/panel/controlViews.ts` lines 180-183 (`persistedRunSchema`, before `drive:`).
- Test: create `tests/control/activityRuns.test.ts`.

**Interfaces:**
- Produces: `RUN_ENDED_STATES: ReadonlySet<string>` (Part D adds `"settled-failed"` to it and then gets `endedAt` and the
  `run-settled` row with no other code), `RunTransitionSubject`, `noteRunWrite(store, run): void`; run body optional
  `startedAt?: number`, `endedAt?: number` (persisted-run schema accepts both).

- [ ] **Step 1: Write the failing test** — create `tests/control/activityRuns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readRunActivity } from "../../src/control/activity.js";
import { settleProviderAttempt, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { WebControlService } from "../../src/control/webService.js";
import type { ControlStore } from "../../src/control/store.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { webFixture } from "./fixtures/web.js";

// Issue-fixes spec §5.2, §5.3: a run's activity rows and wall-clock times, each written in the transaction of the change
// that causes it and stamped by the injected store clock.
type Clock = { value: number };
async function claimedSoft(clock: Clock) {
  const h = await webFixture(undefined, undefined, { storeNow: () => clock.value });
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), budgetMode: "soft" }));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  if (claim.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(claim)}`);
  return { h, service, runId: claim.runId };
}
const runBody = (store: ControlStore, runId: string) =>
  JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
const rowsOf = (store: ControlStore, runId: string, kind: string) =>
  readRunActivity(store, runId, 1_000).filter((entry) => entry.kind === kind).reverse().map((entry) => [entry.at, entry.body]);

describe("run-settled and endedAt (issue-fixes spec §5.2)", () => {
  it("a driver run gets endedAt when it lands, kept through settle, and a run-settled row for each of landed and settled", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => clock }); try {
      const runId = await t.claim();
      const driver = t.driver();
      clock = 2_000;
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(t.body(runId).endedAt).toBe(2_000);
      clock = 3_000;
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId)).toMatchObject({ state: "settled", endedAt: 2_000 });
      expect(rowsOf(t.h.store, runId, "run-settled")).toEqual([
        [2_000, { state: "landed", outcome: "succeeded" }],
        [3_000, { state: "settled", outcome: "succeeded" }],
      ]);
    } finally { await t.h.dispose(); }
  });

  it("a first attempt proved never started settles failed-before-provider with endedAt and its row (saveDispatchRun)", async () => {
    const clock = { value: 1_000 };
    const { h, runId } = await claimedSoft(clock); try {
      clock.value = 4_000;
      await settleProviderAttempt({ store: h.store, profileRouter: h.deps.profileRouter }, { runId, phase: "work", firstAttemptProof: "invalid" });
      expect(runBody(h.store, runId)).toMatchObject({ state: "failed-before-provider", endedAt: 4_000 });
      expect(rowsOf(h.store, runId, "run-settled")).toEqual([[4_000, { state: "failed-before-provider", outcome: null }]]);
    } finally { await h.dispose(); }
  });

  it("a handoff-stopped run settled unrecoverable gets endedAt and its row (saveRunBody)", async () => {
    const clock = { value: 1_000 };
    const { h, service, runId } = await claimedSoft(clock); try {
      await service.handoffStop(h.command("handoff-stop", {}));
      const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(runId)!.id);
      clock.value = 5_000;
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, { requestId, outcome: "settled-unrecoverable", reasonCode: "profile-changed" });
      expect(runBody(h.store, runId)).toMatchObject({ state: "settled-unrecoverable", endedAt: 5_000 });
      expect(rowsOf(h.store, runId, "run-settled")).toEqual([[5_000, { state: "settled-unrecoverable", outcome: null }]]);
    } finally { await h.dispose(); }
  });
});

describe("run-blocked (issue-fixes spec §5.2)", () => {
  it("a run entering blocked writes one row with the step and reason, and no second row while it stays blocked", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted", storeNow: () => clock }); try {
      const runId = await t.claim();
      const driver = t.driver();
      clock = 6_000;
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(rowsOf(t.h.store, runId, "run-blocked")).toEqual([[6_000, { blockedAt: "C", reason: "terminal:exhausted" }]]);
      expect(t.body(runId).endedAt).toBeUndefined();
      await driver.round();
      await driver.round();
      expect(rowsOf(t.h.store, runId, "run-blocked")).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts > $SCRATCH/B4.txt 2>&1; echo rc=$?`.
  Expected: every test fails on `endedAt` `undefined` / the row list `[]`.

- [ ] **Step 3: Implement.**

Append to `src/control/activity.ts`:

```ts
/**
 * §5.2 Run times: the states a run has ended in. endedAt is stamped the first time a run enters one, and every entry
 * writes `run-settled`. Part D adds "settled-failed" here and needs nothing else for its time and row.
 */
export const RUN_ENDED_STATES: ReadonlySet<string> = new Set([
  "landed", "settled", "settled-recoverable", "settled-restartable", "settled-unrecoverable", "failed-before-provider",
]);

/** What noteRunWrite reads off a run body; loose so every run body type (RunRecord, RunBody, DispatchRun, DriverRun) fits. */
export interface RunTransitionSubject { runId: string; groupId: string; taskId?: unknown; state: string; endedAt?: unknown; drive?: unknown }

/**
 * §5.2: every writer of a run body (budget.ts saveRun -- and so saveDriverRun --, stopIntent.ts saveRunBody,
 * webDispatch.ts saveDispatchRun) calls this before it writes, inside its transaction. A move into `blocked` writes
 * `run-blocked`; a move into an ended state stamps endedAt on the body about to be written (first time only) and writes
 * `run-settled`. A write that keeps the stored state writes nothing.
 */
export function noteRunWrite(store: ControlStore, run: RunTransitionSubject): void {
  const prior = store.db.prepare("SELECT json_extract(body,'$.state') AS state FROM runs WHERE id=?").get(run.runId);
  if (prior === undefined || prior.state === run.state) return;
  const taskId = typeof run.taskId === "string" ? run.taskId : null;
  const drive = (typeof run.drive === "object" && run.drive !== null ? run.drive : {}) as { blockedAt?: unknown; blockedReason?: unknown; outcome?: unknown; stopReason?: unknown };
  if (run.state === "blocked") {
    recordActivity(store, { groupId: run.groupId, taskId, runId: run.runId, kind: "run-blocked", body: { blockedAt: drive.blockedAt ?? null, reason: drive.blockedReason ?? null } });
  } else if (RUN_ENDED_STATES.has(run.state)) {
    if (run.endedAt === undefined) run.endedAt = store.now();
    recordActivity(store, {
      groupId: run.groupId, taskId, runId: run.runId, kind: "run-settled",
      body: { state: run.state, outcome: drive.outcome ?? null, ...(typeof drive.stopReason === "string" ? { stopReason: drive.stopReason } : {}) },
    });
  }
}
```

`src/control/budget.ts` — add `import { noteRunWrite } from "./activity.js";` after line 11; `RunRecord` gains the two
times (after `handoffProfile?:ExecutionProfileBinding;`):

```ts
  /** Issue-fixes spec §5.2: ms; set when A1 reserves the first provider attempt / when the run first ends. Absent before schema 9. */
  startedAt?:number;
  endedAt?:number;
```

`saveRun`:

```ts
export function saveRun(store:ControlStore,run:RunRecord):void {
  // Issue-fixes spec §5.2: a state change writes its activity row (and endedAt) in this same transaction.
  noteRunWrite(store,run);
  const body=JSON.stringify(run);
```

`src/control/stopIntent.ts` — add `import { noteRunWrite } from "./activity.js";` to the imports; `saveRunBody`:

```ts
export function saveRunBody(store: ControlStore, run: RunBody, active: boolean | null = null): void {
  // Issue-fixes spec §5.2: a state change writes its activity row (and endedAt) in this same transaction.
  noteRunWrite(store, run);
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId);
```

`src/control/webDispatch.ts` — add `import { noteRunWrite } from "./activity.js";` to the imports; `saveDispatchRun`:

```ts
function saveDispatchRun(store: ControlStore, run: DispatchRun): void {
  // Issue-fixes spec §5.2: a state change writes its activity row (and endedAt) in this same transaction.
  noteRunWrite(store, run);
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId);
}
```

`src/panel/controlViews.ts` `persistedRunSchema` — before `drive: driveRecordSchema.optional(),`:

```ts
  // Issue-fixes spec §5.2: wall-clock run times (ms); a run written before schema 9 has neither. Never back-filled.
  startedAt: safeInteger.optional(),
  endedAt: safeInteger.optional(),
```

- [ ] **Step 4: Run, expect PASS** — the new file (rc=0); then the full suite, because every run-state write now goes
  through `noteRunWrite`: `npm test > $SCRATCH/B4-all.txt 2>&1; echo rc=$?` — read it whole; only the load flakes the
  handoff registers may fail (name each one). `npm run typecheck` (rc=0).

- [ ] **Step 5: Mutation** — (a) delete `if (run.endedAt === undefined) run.endedAt = store.now();` → red: all three
  run-settled tests. (b) make it unconditional (`run.endedAt = store.now();`) → red: "a driver run gets endedAt when it
  lands, kept through settle…" (settled body carries 3000). (c) delete the `run-settled` `recordActivity` → red: the
  three row assertions. (d) delete the `run-blocked` branch → red: "a run entering blocked writes one row…". (e) delete
  `noteRunWrite(store, run);` from `saveRunBody` → red: "a handoff-stopped run settled unrecoverable…"; from
  `saveDispatchRun` → red: "a first attempt proved never started…". (f) `prior.state === run.state` check removed (write
  on every save) → red: "…no second row while it stays blocked".

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/activity.ts src/control/budget.ts src/control/stopIntent.ts src/control/webDispatch.ts src/panel/controlViews.ts tests/control/activityRuns.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record run-blocked, run-settled and endedAt at every run-state write

Issue-fixes spec §5.2: the three writers of a run body note a state change before writing;
entering blocked writes run-blocked, entering an ended state stamps endedAt once and writes
run-settled. The persisted-run schema accepts the two run times.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B5: `run-claimed`, `run-started` and `startedAt`

**Files:**
- Modify `src/control/webDispatch.ts` `createStartingRun` (anchor `saveWork(store, groupId, record as never);\n  return run;`,
  lines 355-357) and `reserveProviderAttemptInTransaction` (anchor `run.providerAttemptOrdinal += 1;`, lines 466-468).
- Modify the B4 import line to `import { noteRunWrite, recordActivity } from "./activity.js";`.
- Test: extend `tests/control/activityRuns.test.ts`.

**Interfaces:** Consumes `recordActivity`, `store.now()`. Produces run body `startedAt` (ms, first reservation only).

- [ ] **Step 1: Write the failing test** — add `beginProviderAttempt` to the webDispatch import of
  `tests/control/activityRuns.test.ts`, and append:

```ts
describe("run-claimed, run-started and startedAt (issue-fixes spec §5.2)", () => {
  it("a claim writes run-claimed with its claim ordinal; the run has no startedAt yet", async () => {
    const clock = { value: 1_000 };
    const { h, runId } = await claimedSoft(clock); try {
      expect(readRunActivity(h.store, runId, 10).map((entry) => [entry.kind, entry.at, entry.taskId, entry.body])).toEqual([["run-claimed", 1_000, "a", { claimOrdinal: 1 }]]);
      expect(runBody(h.store, runId).startedAt).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("each reserved attempt writes run-started; startedAt is the first reservation's time and never moves", async () => {
    const clock = { value: 1_000 };
    const { h, runId } = await claimedSoft(clock); try {
      const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
      clock.value = 2_000;
      beginProviderAttempt(deps, runId, "work");
      clock.value = 3_000;
      beginProviderAttempt(deps, runId, "work");
      expect(runBody(h.store, runId).startedAt).toBe(2_000);
      expect(rowsOf(h.store, runId, "run-started")).toEqual([[2_000, { providerAttemptOrdinal: 1 }], [3_000, { providerAttemptOrdinal: 2 }]]);
    } finally { await h.dispose(); }
  });

  it("the driver's A1 sets startedAt with the store clock", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => clock }); try {
      const runId = await t.claim();
      clock = 7_000;
      await t.until(t.driver(), () => t.body(runId).state !== "starting");
      expect(t.body(runId).startedAt).toBe(7_000);
      expect(rowsOf(t.h.store, runId, "run-started")).toEqual([[7_000, { providerAttemptOrdinal: 1 }]]);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts > $SCRATCH/B5.txt 2>&1; echo rc=$?`.
  Expected: the three new tests fail (`[]` rows, `startedAt` `undefined`); the B4 tests still pass.

- [ ] **Step 3: Implement** — `createStartingRun`:

```ts
  saveWork(store, groupId, record as never);
  // Issue-fixes spec §5.2: a claim that creates a run.
  recordActivity(store, { groupId, taskId: work.taskId, runId, kind: "run-claimed", body: { claimOrdinal } });
  return run;
}
```

`reserveProviderAttemptInTransaction`:

```ts
  run.providerAttemptOrdinal += 1;
  // Issue-fixes spec §5.2: the run started when its first provider attempt was reserved; later attempts keep that time.
  if (run.startedAt === undefined) run.startedAt = store.now();
  saveDispatchRun(store, run);
  recordActivity(store, { groupId: run.groupId, taskId: run.taskId, runId, kind: "run-started", body: { providerAttemptOrdinal: run.providerAttemptOrdinal } });
  return { kind: "reserved", providerAttemptOrdinal: run.providerAttemptOrdinal, envelope: phase === "estimate" || phase === "single-call" ? readSingleCallClaimEnvelope(store, run.groupId, runId) : readWorkClaimEnvelope(store, run.groupId, runId) };
```

- [ ] **Step 4: Run, expect PASS** — the file (rc=0), then `./node_modules/.bin/vitest run tests/control/webDispatch.test.ts tests/control/contextControl.test.ts tests/control/webContinuation.test.ts tests/control/webFaults.test.ts tests/control/executionDriver.test.ts > $SCRATCH/B5-near.txt 2>&1; echo rc=$?` (rc=0); `npm run typecheck`.

- [ ] **Step 5: Mutation** — (a) delete the `run-claimed` line → red: "a claim writes run-claimed…". (b) delete the
  `startedAt` line → red: both startedAt tests. (c) make it unconditional → red: "…startedAt is the first reservation's
  time and never moves" (3000). (d) delete the `run-started` line → red: both run-started row assertions.

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/webDispatch.ts tests/control/activityRuns.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record run-claimed, run-started and the run's startedAt

Issue-fixes spec §5.2: a claim writes run-claimed; every reserved provider attempt writes
run-started, and the first one stamps startedAt on the run body.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B6: `phase` rows from ccloop's progress

**Files:**
- Modify `src/control/executionDriver.ts` lines 499-507 (`if (report.progress !== undefined) {` block in `collectInto`),
  imports (add `import { recordActivity } from "./activity.js";` and `import type { RunProgress } from "./schema.js";`).
- Test: extend `tests/control/activityRuns.test.ts`.

**Interfaces:** Consumes `recordActivity`. Row body `{ step: RunProgress["status"], attempt: RunProgress["currentAttempt"] }`
(ccloop's own status string; the panel's display mapping `STEP_OF` stays in `controlViews.ts`).

- [ ] **Step 1: Write the failing test** — add imports `collectInto, readDriverRun` from
  `../../src/control/executionDriver.js` and `type RunProgress` from `../../src/control/schema.js`; append:

```ts
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const progress = (status: RunProgress["status"], over: Partial<RunProgress> = {}): RunProgress => ({
  status, currentAttempt: 1, attemptsUsed: 1, attemptsRemaining: 2, lastTransitionAt: "2026-10-08T00:00:00.000Z", ...over,
});
/** As driverProgress.test.ts: wraps the router (it binds the port's methods when built) to add a progress answer. */
function answerProgress(t: Harness, next: () => RunProgress | null): void {
  const router = t.deps.router;
  t.deps.router = {
    ...router,
    resolve(workKind, profileId, expectedHash) {
      const profile = router.resolve(workKind, profileId, expectedHash);
      const collect = profile.port.collect.bind(profile.port);
      return { ...profile, port: { ...profile.port, async collect(envelope, afterSeq) { return { ...(await collect(envelope, afterSeq)), progress: next() }; } } };
    },
  };
}

describe("phase (issue-fixes spec §5.2)", () => {
  it("writes a row only when the step or the attempt differs from the stored progress", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => clock }); try {
      let answer: RunProgress | null = progress("planning");
      answerProgress(t, () => answer);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const collect = () => collectInto(t.deps, readDriverRun(t.h.store, runId));
      clock = 2_000; await collect();
      clock = 3_000; await collect();
      answer = progress("planning", { lastTransitionAt: "2026-10-08T00:01:00.000Z" }); clock = 4_000; await collect();
      answer = progress("executing"); clock = 5_000; await collect();
      answer = progress("executing", { currentAttempt: 2 }); clock = 6_000; await collect();
      answer = null; clock = 7_000; await collect();
      expect(rowsOf(t.h.store, runId, "phase")).toEqual([
        [2_000, { step: "planning", attempt: 1 }],
        [5_000, { step: "executing", attempt: 1 }],
        [6_000, { step: "executing", attempt: 2 }],
      ]);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts > $SCRATCH/B6.txt 2>&1; echo rc=$?`.
  Expected: "writes a row only when…" fails: rows `[]`.

- [ ] **Step 3: Implement** — the block becomes:

```ts
  if (report.progress !== undefined) {
    const progress = report.progress;
    write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.progress === undefined && progress === null) return;
      const before = (current.progress ?? null) as RunProgress | null;
      current.progress = progress;
      saveDriverRun(store, current);
      // Issue-fixes spec §5.2: a collect whose step or attempt differs from the stored one (a null answer is no phase).
      if (progress !== null && (before === null || before.status !== progress.status || before.currentAttempt !== progress.currentAttempt)) {
        recordActivity(store, { groupId: current.groupId, taskId: current.taskId, runId, kind: "phase", body: { step: progress.status, attempt: progress.currentAttempt } });
      }
    });
  }
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts tests/control/driverProgress.test.ts tests/control/progressE2E.test.ts > $SCRATCH/B6.txt 2>&1; echo rc=$?`
  (rc=0; `driverProgress.test.ts` "P3: … each change moves changeSeq exactly once" must stay green — it is the existing
  guard that the phase row adds no second projection change); `npm run typecheck`.

- [ ] **Step 5: Mutation** — (a) delete the `recordActivity` call → red: "writes a row only when…". (b) replace the
  condition with `progress !== null` → red (rows at 3000 and 4000 appear). (c) drop `|| before.currentAttempt !==
  progress.currentAttempt` → red (no 6000 row).

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/executionDriver.ts tests/control/activityRuns.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record a phase row when ccloop's step or attempt changes

Issue-fixes spec §5.2: the collect that stores a progress whose status or current attempt
differs from the stored one writes a phase row in the same write.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B7: `command` rows for group-targeted commands

**Files:**
- Modify `src/control/commandLedger.ts` imports (add `import { appendActivity } from "./activity.js";`) and after line
  359 (`if (projectionGroups.length > 0) recordProjectionChange(store, projectionGroups);`).
- Test: extend `tests/control/activity.test.ts`.

**Interfaces:** Consumes `appendActivity`. Row: `kind "command"`, `taskId` = target's task (task target), `runId` =
target's run (run target), body `{ verb, actor }` (`actor` = the raw command's `actorId`).

- [ ] **Step 1: Write the failing test** — add imports to `tests/control/activity.test.ts`:

```ts
import { applyWebCommand, type WebCommandContext } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import type { EffectiveAuthorityCommandV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
```

and append:

```ts
/** As schema8.test.ts: a handoff-stop on g1 whose apply only answers (or refuses with a durable domain error). */
function handoffStop(store: ControlStore, commandId: string, expectedRevision: number, refuse = false) {
  const command: RawAuthorityCommandV1 = { schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "panel-operator", verb: "handoff-stop", target: { kind: "group", groupId: "g1" }, payload: {} };
  return applyWebCommand(store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { handoffDeadlineAt: "2026-09-20T10:00:00.000Z" } }) as EffectiveAuthorityCommandV1,
    apply: (context: WebCommandContext) => {
      if (refuse) throw new ControlError("stop-already-active");
      return { status: 202, body: {
        schema: "orca-command-success-v1", commandId, actorId: command.actorId, verb: command.verb, target: command.target,
        commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "handoff-stopped", stopRevision: context.nextCommandRevision, acceptedAt: "2026-09-20T10:00:00.000Z", handoffDeadlineAt: "2026-09-20T10:00:00.000Z", frozenRunIds: [], requestIds: [] },
      } } as never;
    },
  });
}

describe("command rows (issue-fixes spec §5.2)", () => {
  it("an accepted group command writes one row; its replay, a stale one and a refused one write none", async () => {
    let clock = 100;
    const h = await openTestStore({ now: () => clock }); try {
      seedGroup(h.store, "g1");
      clock = 200;
      const first = handoffStop(h.store, "c1", 1);
      const rows = () => readGroupActivity(h.store, "g1", 10).map((entry) => [entry.kind, entry.at, entry.taskId, entry.runId, entry.body]);
      expect(rows()).toEqual([["command", 200, null, null, { verb: "handoff-stop", actor: "panel-operator" }]]);
      // The row did not move the group past the projectionSeq the success body promised (assertFinalVersions).
      expect(projectionSeq(h.store, "g1")).toBe((first.body as { projectionSeq: number }).projectionSeq);
      clock = 300;
      expect(handoffStop(h.store, "c1", 1)).toEqual(first);
      expect(handoffStop(h.store, "c-stale", 1).status).toBe(409);
      expect(handoffStop(h.store, "c-refused", 2, true).status).toBe(409);
      expect(rows()).toHaveLength(1);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activity.test.ts > $SCRATCH/B7.txt 2>&1; echo rc=$?`.
  Expected: rows `[]`.

- [ ] **Step 3: Implement** — after line 359:

```ts
    if (projectionGroups.length > 0) recordProjectionChange(store, projectionGroups);
    // Issue-fixes spec §5.2: a group-targeted command first accepted writes its `command` row (a replay returned above,
    // a refusal is not `succeeded`). appendActivity, not recordActivity: the success body already names its
    // projectionSeq (assertFinalVersions below), and every group-scoped command recorded that change just above.
    if (succeeded && commandScope.groupId !== null) {
      const target = rawCommand.target;
      appendActivity(store, {
        groupId: commandScope.groupId, taskId: target.kind === "task" ? target.taskId : null, runId: target.kind === "run" ? target.runId : null,
        kind: "command", body: { verb: rawCommand.verb, actor: rawCommand.actorId },
      });
    }
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/activity.test.ts tests/control/commandLedger.test.ts tests/control/schema8.test.ts tests/control/webMutations.test.ts > $SCRATCH/B7.txt 2>&1; echo rc=$?` (rc=0); then `npm test > $SCRATCH/B7-all.txt 2>&1; echo rc=$?` (every group command now inserts a row; read the file whole); `npm run typecheck`.

- [ ] **Step 5: Mutation** — (a) delete the block → red: "an accepted group command writes one row…". (b) drop
  `succeeded && ` → red: same test (the refused command writes a row; length 2).

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/commandLedger.ts tests/control/activity.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record a command row for every accepted group command

Issue-fixes spec §5.2: applyWebCommand writes {verb, actor} for a group-scoped success in the
command's transaction, after its own projection change; replays and refusals write nothing.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B8: `run-resumed` on a run-scope recovery-retry

**Files:**
- Modify `src/control/stopIntent.ts` `retryRun` (anchor `const resumedDriverRun = resumeBlockedDriverRun(store, runId);`,
  line 473); the B4 import becomes `import { noteRunWrite, recordActivity } from "./activity.js";`.
- Test: extend `tests/control/activityRuns.test.ts`.

**Interfaces:** Consumes `recordActivity`. Row `run-resumed`, body `{}`.

- [ ] **Step 1: Write the failing test** — append:

```ts
describe("run-resumed (issue-fixes spec §5.2)", () => {
  it("a run-scope recovery-retry of a blocked run writes run-resumed and its run-targeted command row; its replay writes none", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted", storeNow: () => clock }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      clock = 8_000;
      const command = t.h.runCommand("recovery-retry", runId, { scope: "run", runId });
      const retried = await t.service.recoveryRetry(command);
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId).state).toBe("accepted");
      const newest = () => readRunActivity(t.h.store, runId, 2).map((entry) => [entry.kind, entry.at, entry.runId, entry.body]);
      expect(newest()).toEqual([
        ["command", 8_000, runId, { verb: "recovery-retry", actor: "human" }],
        ["run-resumed", 8_000, runId, {}],
      ]);
      const count = readRunActivity(t.h.store, runId, 1_000).length;
      await t.service.recoveryRetry(command);
      expect(readRunActivity(t.h.store, runId, 1_000)).toHaveLength(count);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts > $SCRATCH/B8.txt 2>&1; echo rc=$?`.
  Expected: newest two rows are `["command", …]` and `["run-blocked", …]`.

- [ ] **Step 3: Implement** — in `retryRun`:

```ts
  const resumedDriverRun = resumeBlockedDriverRun(store, runId);
  // Issue-fixes spec §5.2: a blocked run resumed by recovery-retry (here, in the command's transaction).
  if (resumedDriverRun) recordActivity(store, { groupId, taskId: run.taskId, runId, kind: "run-resumed", body: {} });
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts tests/control/blockedStaysPut.test.ts tests/control/driverRecovery.test.ts tests/control/driveRecord.test.ts > $SCRATCH/B8.txt 2>&1; echo rc=$?` (rc=0); `npm run typecheck`.

- [ ] **Step 5: Mutation** — delete the `if (resumedDriverRun) recordActivity(...)` line → red: "a run-scope
  recovery-retry of a blocked run writes run-resumed…". The `if (resumedDriverRun)` guard itself (no row when nothing
  was resumed) is not pinned by a criterion here; record it in the ledger as unpinned rather than claim it is covered.

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/stopIntent.ts tests/control/activityRuns.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record run-resumed when recovery-retry resumes a blocked run

Issue-fixes spec §5.2: written in retryRun, inside the recovery-retry command's transaction.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B9: `stop` rows when a group stop intent is created or strengthened

**Files:**
- Modify `src/control/stopIntent.ts` `applyPauseDispatch` (after the `saveStopIntent(store, groupId, "pause", …)` call,
  lines 343-345) and `applyHandoffStop` (after `saveStopIntent(store, groupId, "handoff", …)`, lines 373-375).
- Modify `src/panel/controlLifecycle.ts` `applyPanelShutdown` apply (anchor `const groups = groupIds.map(groupId => shutdownGroup(`),
  imports (add `import { recordActivity } from "../control/activity.js";`).
- Test: extend `tests/control/activityRuns.test.ts`.

**Interfaces:** Row `stop`, body `{ mode: "pause" | "handoff" | "shutdown" }`, `taskId`/`runId` null. Not written:
`stop-cleared` (Part C), shutdown dispositions that create nothing (`preserved-*`, `skipped-driver-owned`,
`blocked-inconsistent`).

- [ ] **Step 1: Write the failing test** — add `import { applyPanelShutdown } from "../../src/panel/controlLifecycle.js";`
  and `import { readGroupActivity } from "../../src/control/activity.js";` (merge with the existing activity import);
  append:

```ts
describe("stop (issue-fixes spec §5.2)", () => {
  const stops = (store: ControlStore) =>
    readGroupActivity(store, "g", 1_000).filter((entry) => entry.kind === "stop").reverse().map((entry) => [entry.at, entry.body]);

  it("pause and its strengthening to a handoff-stop each write a row; a refused or replayed stop writes none", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => clock }); try {
      clock = 2_000;
      const pause = t.h.command("pause-dispatch", {});
      await t.service.pauseDispatch(pause);
      clock = 3_000;
      await t.service.handoffStop(t.h.command("handoff-stop", {}));
      clock = 4_000;
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).toMatchObject({ error: { code: "stop-mode-conflict" } });
      await t.service.pauseDispatch(pause);
      expect(stops(t.h.store)).toEqual([[2_000, { mode: "pause" }], [3_000, { mode: "handoff" }]]);
    } finally { await t.h.dispose(); }
  });

  it("a shutdown that creates a group's intent writes a shutdown row; one that preserves it writes none", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => clock }); try {
      const shutdown = (epoch: string) => applyPanelShutdown({ store: t.h.store, profileRouter: t.h.deps.profileRouter, epoch, now: () => new Date("2026-10-08T00:00:00.000Z"), shutdownGraceMs: 1_000 });
      clock = 9_000;
      await shutdown("epoch-one");
      await shutdown("epoch-two");
      expect(stops(t.h.store)).toEqual([[9_000, { mode: "shutdown" }]]);
    } finally { await t.h.dispose(); }
  });
});
```

(The shutdown deps omit `admissionGate` on purpose: `applyPanelShutdown` would begin draining the harness gate, which the
`dispose` does not need.)

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts > $SCRATCH/B9.txt 2>&1; echo rc=$?`.
  Expected: both new tests see `[]`.

- [ ] **Step 3: Implement.** `applyPauseDispatch`:

```ts
        saveStopIntent(store, groupId, "pause", context.nextCommandRevision, {
          mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null,
        });
        // Issue-fixes spec §5.2: a group stop intent created.
        recordActivity(store, { groupId, kind: "stop", body: { mode: "pause" } });
```

`applyHandoffStop`:

```ts
        saveStopIntent(store, groupId, "handoff", context.nextCommandRevision, {
          mode: "handoff", state, frozenRunIds: frozen, acceptedAt, deadlineAt,
        });
        // Issue-fixes spec §5.2: a group stop intent created (or a pause strengthened to a handoff-stop).
        recordActivity(store, { groupId, kind: "stop", body: { mode: "handoff" } });
```

`applyPanelShutdown` apply:

```ts
      const groups = groupIds.map(groupId => shutdownGroup(store, groupId, window, command.commandId, deps.exemptDriverRuns === true));
      // Issue-fixes spec §5.2: a group stop intent the shutdown created or strengthened (shutdownGroup itself stays
      // row-free: criteria call it outside a transaction).
      for (const entry of groups) {
        if (entry.disposition === "created" || entry.disposition === "strengthened-pause") recordActivity(store, { groupId: entry.groupId, kind: "stop", body: { mode: "shutdown" } });
      }
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts tests/control/stopIntent.test.ts tests/panel/controlLifecycle.test.ts tests/panel/shutdownDriverGroup.test.ts tests/control/handoffStop.test.ts > $SCRATCH/B9.txt 2>&1; echo rc=$?` (rc=0); `npm run typecheck`.

- [ ] **Step 5: Mutation** — delete each of the three `recordActivity` lines in turn → red respectively: the pause row
  (`[2000, pause]` missing), the handoff row, the shutdown test. Replace the shutdown condition with `true` → red: "a
  shutdown that … one that preserves it writes none" (a second row from `preserved-shutdown`).

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/stopIntent.ts src/panel/controlLifecycle.ts tests/control/activityRuns.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record a stop row when a group stop intent is created

Issue-fixes spec §5.2: pause-dispatch, handoff-stop and a shutdown that creates or
strengthens a group's intent write {mode} in the command's transaction.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B10: `integration` rows from the integration pass

**Files:**
- Modify `src/control/integrationPass.ts` `settle` (anchor `saveGroup(deps.store, { ...group, integration: next } as typeof group);`,
  line 481), imports (add `import { recordActivity } from "./activity.js";`).
- Test: extend `tests/control/integrationGit.test.ts` (a new `describe` at the end; no existing case changes).

**Interfaces:** Row `integration`, body `{ state: GroupIntegration["state"], reason: string | null }`. Not written for
`transient` (a backoff, not a result) and `dropped` (returns before any write).

- [ ] **Step 1: Write the failing test** — add `import { readGroupActivity } from "../../src/control/activity.js";` and
  append at the end of `tests/control/integrationGit.test.ts`:

```ts
describe("integration activity (issue-fixes spec §5.2)", { timeout: 60_000 }, () => {
  it("each result the pass records writes one integration row; a pass with nothing to do writes none", async () => {
    const w = await world(PB); try {
      const rows = () => readGroupActivity(w.store, "g", 100).filter((entry) => entry.kind === "integration").reverse().map((entry) => entry.body);
      expect(await w.pass()).toBe(false);
      expect(rows()).toEqual([]);
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(rows()).toEqual([{ state: "idle", reason: null }]);
      w.pushFromOther("orca/g", { "theirs.txt": "x\n" });
      w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(rows()).toEqual([{ state: "idle", reason: null }, { state: "blocked", reason: "integration-work-branch-diverged" }]);
    } finally { await w.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/integrationGit.test.ts -t "integration activity" > $SCRATCH/B10.txt 2>&1; echo rc=$?`.
  Expected: `rows()` is `[]` after the first landing.

- [ ] **Step 3: Implement** — in `settle`:

```ts
    saveGroup(deps.store, { ...group, integration: next } as typeof group);
    // Issue-fixes spec §5.2: a result the pass records; a transient retry only schedules the next try and is not one.
    if (outcome.kind !== "transient") recordActivity(deps.store, { groupId, kind: "integration", body: { state: next.state, reason: next.reason } });
    return outcome.kind !== "transient";
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/integrationGit.test.ts tests/control/integrationCrash.test.ts tests/control/integrationResolve.test.ts > $SCRATCH/B10.txt 2>&1; echo rc=$?` (rc=0); `npm run typecheck`.

- [ ] **Step 5: Mutation** — delete the `recordActivity` line → red: "each result the pass records…". Drop the
  `outcome.kind !== "transient"` guard → no case here goes red (no transient outcome is produced); state it in the
  ledger as an unpinned guard rather than claim it is covered.

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/integrationPass.ts tests/control/integrationGit.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record an integration row for each result the pass records

Issue-fixes spec §5.2: settle writes {state, reason} with the group's new integration record;
a transient backoff writes none.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task B11: Views, the run-activity route, wire schemas and Web mirror

**Files:**
- Modify `src/control/webProtocol.ts`: before `export const runViewSchema = z` (line 1152) add the activity schemas;
  inside `runViewSchema` after the `skills` field (before `  })\n  .strict();\n\nexport const estimateViewSchema`, line
  ~1207) add three fields; inside `groupViewSchema` after `integration: groupIntegrationViewSchema.optional(),` add
  `activity`; after `evidenceManifestSchema` (line ~1398) add `runActivitySchema`; types next to
  `export type EvidenceManifestV1` (line ~1598).
- Modify `src/panel/controlViews.ts`: imports; `runViews` return (lines 757-768); `readControlGroup` view (before
  `...integrationView(body),`, line ~841); new `readRunActivityView` after `readRunEvidence`.
- Modify `src/panel/controlApi.ts`: import `readRunActivityView` (line 24); route after the evidence routes (after
  line 297).
- Modify `web/src/controlTypes.ts` (`RunViewV1` lines 213-235, `GroupViewV1` lines 274-306, after `EvidenceManifestV1`
  line 345-349) and `web/src/controlApi.ts` (import list line 14-…, after `fetchRunEvidence` line 112).
- Test: extend `tests/panel/controlReadApi.test.ts` (one new `it` in "canonical control read API"),
  `tests/panel/webParity.test.ts` (one new pair, additive), `tests/control/activity.test.ts` (kind-list parity).

**Interfaces:**
- Produces wire: `activityKindSchema`, `activityEntrySchema`, `runActivitySchema`, types `ActivityEntryV1`,
  `RunActivityV1` (server and Web); `RunViewV1.startedAt/endedAt/lastActivityAt?: number | null`;
  `GroupViewV1.activity?: ActivityEntryV1[]` (newest 50, newest first); route `GET /api/control/runs/:runId/activity`
  → `RunActivityV1` (newest 200); `readRunActivityView(store, runId): RunActivityV1`; Web `fetchRunActivity(runId)`.
- Part E reads `latestGroupActivityAt` for the summary's `updatedAt`; this task does not touch the summary.

- [ ] **Step 1: Write the failing tests.**

`tests/control/activity.test.ts` — add `import { activityKindSchema } from "../../src/control/webProtocol.js";`
(merge into the existing webProtocol type import as a value import) and `ACTIVITY_KINDS` to the activity import; append:

```ts
describe("the wire's activity kinds (issue-fixes spec §5.2)", () => {
  it("are exactly the kinds the writer knows", () => {
    expect([...activityKindSchema.options].sort()).toEqual([...ACTIVITY_KINDS].sort());
  });
});
```

`tests/panel/controlReadApi.test.ts` — add imports `import { recordActivity } from "../../src/control/activity.js";`,
`import { createGroup } from "../../src/control/commands.js";`, and `RunActivityV1` to the `webProtocol.js` type
import; append inside `describe("canonical control read API", …)`:

```ts
  // Issue-fixes spec §5.2 Reads, §5.3: the group view's newest 50 rows, the run view's times (null for a run written
  // before schema 9), and the run-activity route under the evidence route's checks: logged in, and a run of this store.
  it("shows a group's newest activity, a run's times, and a run's activity only for a run of this store", async () => {
    await confirmGroup(h, "group-a");
    insertValidTaskRun(h, "group-a");
    h.store.transaction(() => {
      for (let i = 1; i <= 201; i += 1) recordActivity(h.store, { groupId: "group-a", taskId: "a", runId: "run-one", kind: "phase", body: { step: "executing", attempt: i } });
      recordActivity(h.store, { groupId: "group-a", kind: "stop", body: { mode: "pause" } });
    });
    const newestGroupSeq = Number(h.store.db.prepare("SELECT MAX(seq) AS seq FROM activity WHERE group_id='group-a'").get()!.seq);
    const newestRun = h.store.db.prepare("SELECT seq,at FROM activity WHERE run_id='run-one' ORDER BY seq DESC LIMIT 1").get()!;

    const groupResponse = await request(h, "/api/control/groups/group-a");
    expect(groupResponse.status).toBe(200);
    const view = await groupResponse.json() as GroupViewV1;
    expect(view.activity).toHaveLength(50);
    expect(view.activity![0]).toMatchObject({ seq: newestGroupSeq, kind: "stop", taskId: null, runId: null, body: { mode: "pause" } });
    expect(view.activity!.map((entry) => entry.seq)).toEqual([...view.activity!.map((entry) => entry.seq)].sort((a, b) => b - a));
    expect(view.runs.find((run) => run.runId === "run-one")).toMatchObject({ startedAt: null, endedAt: null, lastActivityAt: Number(newestRun.at) });

    const response = await request(h, "/api/control/runs/run-one/activity");
    expect(response.status).toBe(200);
    const activity = await response.json() as RunActivityV1;
    expect(activity).toMatchObject({ schema: "orca-run-activity-v1", runId: "run-one" });
    expect(activity.entries).toHaveLength(200);
    expect(activity.entries[0]).toMatchObject({ seq: Number(newestRun.seq), kind: "phase", body: { attempt: 201 } });
    expect(activity.entries.every((entry) => entry.runId === "run-one")).toBe(true);

    expect((await request(h, "/api/control/runs/run-one/activity", false)).status).toBe(401);

    // Another project's run lives in another control store; this panel does not know it.
    const other = await openTestStore();
    try {
      createGroup(other.store, { groupId: "elsewhere", projectKey: "other/repo", goal: "Other", successConditions: ["ok"], limit: amount(100), reviewReserve: amount(10), deadlineAt: null },
        { commandId: "create", expectedRevision: 0, by: "human" });
      other.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-other-project','elsewhere','w',1,0,'{}')").run();
      const foreign = await request(h, "/api/control/runs/run-other-project/activity");
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toMatchObject({ error: { code: "run-not-found" } });
    } finally { await other.dispose(); }
    const malformed = await request(h, "/api/control/runs/%20bad/activity");
    expect(malformed.status).toBe(404);
  });
```

`tests/panel/webParity.test.ts` — add `RunActivityV1 as ServerRunActivityV1,` to the server type import (alphabetical,
after `RequirementViewV1 as ServerRequirementViewV1,`), `RunActivityV1 as WebRunActivityV1,` to the Web import, the
pair after `evidenceWebToServer`:

```ts
// Issue-fixes spec §5.2: the run-activity read, checked both ways like the evidence manifest.
function runActivityServerToWeb(x: ServerRunActivityV1): WebRunActivityV1 { return x; }
function runActivityWebToServer(x: WebRunActivityV1): ServerRunActivityV1 { return x; }
```

and `runActivityServerToWeb, runActivityWebToServer,` after `evidenceWebToServer,` in `__webParityAssignabilityChecks__`.

- [ ] **Step 2: Run, expect FAIL** — `./node_modules/.bin/vitest run tests/panel/controlReadApi.test.ts tests/control/activity.test.ts > $SCRATCH/B11.txt 2>&1; echo rc=$?`:
  `activityKindSchema` is undefined (TypeError on `.options`); the route answers 404 `route-not-found` and
  `view.activity` is undefined. `npm run typecheck > $SCRATCH/B11-tsc.txt 2>&1; echo rc=$?`: rc≠0, `RunActivityV1` not
  exported by either module.

- [ ] **Step 3: Implement.**

`src/control/webProtocol.ts`, before `export const runViewSchema = z`:

```ts
// Issue-fixes spec §5.2 (ruling H5): one row of Orca's activity record as the views show it (src/control/activity.ts).
export const activityKindSchema = z.enum([
  "command", "run-claimed", "run-started", "phase", "run-blocked", "run-resumed", "run-settled", "task-retried", "integration", "stop", "stop-cleared", "archived", "unarchived",
]);
export const activityEntrySchema = z
  .object({
    seq: positiveSafeInteger, groupId: idSchema, taskId: idSchema.nullable(), runId: idSchema.nullable(), at: safeInteger,
    kind: activityKindSchema, body: z.record(z.unknown()),
  })
  .strict();
```

`runViewSchema`, after the `skills` field's closing `.optional(),`:

```ts
    // Issue-fixes spec §5.2: wall-clock times (ms) -- started when A1 reserved the first attempt, ended when it first
    // landed or settled, and the time of its newest activity row. null for a run written before schema 9. Optional on
    // the wire so older fixtures still parse; the server always gives them.
    startedAt: safeInteger.nullable().optional(),
    endedAt: safeInteger.nullable().optional(),
    lastActivityAt: safeInteger.nullable().optional(),
```

`groupViewSchema`, after `integration: groupIntegrationViewSchema.optional(),`:

```ts
    // Issue-fixes spec §5.2 Reads: the group's newest 50 activity rows, newest first. Optional on the wire so older
    // fixtures still parse; the server always gives it.
    activity: z.array(activityEntrySchema).optional(),
```

after `evidenceManifestSchema`'s closing `);`:

```ts
// Issue-fixes spec §5.2 Reads: GET /api/control/runs/:runId/activity -- the run's newest 200 rows, newest first.
export const runActivitySchema = z
  .object({ schema: z.literal("orca-run-activity-v1"), runId: idSchema, entries: z.array(activityEntrySchema) })
  .strict();
```

types, after `export type EvidenceManifestV1 = …;`:

```ts
export type ActivityEntryV1 = z.infer<typeof activityEntrySchema>;
export type RunActivityV1 = z.infer<typeof runActivitySchema>;
```

`src/panel/controlViews.ts` — add `import { readGroupActivity, readRunActivity } from "../control/activity.js";`; add
`runActivitySchema,` and `type RunActivityV1,` to the `../control/webProtocol.js` import list. `runViews` return —
after the `skills` spread line:

```ts
      ...(run.drive?.skills == null ? {} : { skills: { profile: run.drive.skills.profile, lock: run.drive.skills.lock } }),
      // Issue-fixes spec §5.2: the run's times; null for a run written before schema 9.
      startedAt: run.startedAt ?? null,
      endedAt: run.endedAt ?? null,
      lastActivityAt: readRunActivity(store, runId, 1)[0]?.at ?? null,
    };
```

`readControlGroup` view — before `...integrationView(body),`:

```ts
    // Issue-fixes spec §5.2 Reads: the newest 50 rows of the group.
    activity: readGroupActivity(store, groupId, 50),
```

after `readRunEvidence`:

```ts
/**
 * Issue-fixes spec §5.2 Reads: GET /api/control/runs/:runId/activity. The evidence route's scope checks: an id that is
 * not an id, or a run this store does not hold (another project's), is run-not-found.
 */
export function readRunActivityView(store: ControlStore, runId: string): RunActivityV1 {
  const row = idSchema.safeParse(runId).success ? store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId) : undefined;
  if (!row) throw new ControlError("run-not-found");
  const parsed = runActivitySchema.safeParse({ schema: "orca-run-activity-v1", runId, entries: readRunActivity(store, runId, 200) });
  if (!parsed.success) return blocked(`run-activity:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}
```

`src/panel/controlApi.ts` — import line 24 adds `readRunActivityView`; after the evidence-artifact route's closing
`}));` (line 297):

```ts
  // Issue-fixes spec §5.2: a run's newest 200 activity rows, under the evidence route's checks (the panel's login, and a
  // run of this store -- another project's is run-not-found).
  app.get("/api/control/runs/:runId/activity", (req, res) => {
    const runId = String(req.params.runId);
    try { res.json(readRunActivityView(deps.store, runId)); }
    catch (error) {
      const run = deps.store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
      sendMappedControlError(res, error, run ? readErrorContext(deps.store, String(run.group_id)) : undefined);
    }
  });
```

`web/src/controlTypes.ts` — `RunViewV1` after the `skills?:` field:

```ts
  /** Issue-fixes spec §5.2: wall-clock times (ms); null for a run written before schema 9. Optional so literal fixtures need no edit; the server always sends them. */
  startedAt?: number | null;
  endedAt?: number | null;
  lastActivityAt?: number | null;
```

`GroupViewV1` after `integration?: GroupIntegrationViewV1;`:

```ts
  /** Issue-fixes spec §5.2: the group's newest 50 activity rows, newest first. Optional so literal fixtures need no edit. */
  activity?: ActivityEntryV1[];
```

after `EvidenceManifestV1`:

```ts
/** Issue-fixes spec §5.2: one row of Orca's activity record. */
export type ActivityKindV1 = "command" | "run-claimed" | "run-started" | "phase" | "run-blocked" | "run-resumed" | "run-settled" | "task-retried" | "integration" | "stop" | "stop-cleared" | "archived" | "unarchived";
export type ActivityEntryV1 = { seq: number; groupId: string; taskId: string | null; runId: string | null; at: number; kind: ActivityKindV1; body: Record<string, unknown> };
/** GET /api/control/runs/:runId/activity -- the run's newest 200 rows, newest first. */
export type RunActivityV1 = { schema: "orca-run-activity-v1"; runId: string; entries: ActivityEntryV1[] };
```

`web/src/controlApi.ts` — add `RunActivityV1,` to the `import type { … } from "./controlTypes.js"` list; after
`fetchRunEvidence`:

```ts
/** GET /api/control/runs/:runId/activity -- issue-fixes spec §5.2: the run's newest 200 activity rows. */
export const fetchRunActivity = (runId: string): Promise<RunActivityV1> =>
  controlGet<RunActivityV1>(`/api/control/runs/${segment(runId)}/activity`);
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/panel/controlReadApi.test.ts tests/control/activity.test.ts tests/control/webProtocol.test.ts tests/panel/runContinuable.test.ts > $SCRATCH/B11.txt 2>&1; echo rc=$?` (rc=0);
  `npm run typecheck > $SCRATCH/B11-tsc.txt 2>&1; echo rc=$?` (rc=0); `npm run build --workspace web > $SCRATCH/B11-web.txt 2>&1; echo rc=$?` (rc=0);
  `npm run --workspace web check > $SCRATCH/B11-webcheck.txt 2>&1; echo rc=$?` (rc=0); then `npm test > $SCRATCH/B11-all.txt 2>&1; echo rc=$?` read whole.

- [ ] **Step 5: Mutation** — (a) `readRunActivityView`: delete `if (!row) throw new ControlError("run-not-found");` →
  red: "…only for a run of this store" (the foreign run answers 200 with no entries). (b) delete the `activity:` line in
  `readControlGroup` → red (`view.activity` undefined). (c) `lastActivityAt: null` constant → red. (d) remove
  `"unarchived"` from `activityKindSchema` → red: "are exactly the kinds the writer knows". (e) in
  `web/src/controlTypes.ts` change `RunActivityV1.entries` to `ActivityEntryV1[] | null` → `npm run typecheck` red
  (`runActivityWebToServer`). Run (e) after `npm run build --workspace web` in the clone.

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/webProtocol.ts src/panel/controlViews.ts src/panel/controlApi.ts web/src/controlTypes.ts web/src/controlApi.ts tests/panel/controlReadApi.test.ts tests/panel/webParity.test.ts tests/control/activity.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(panel): show group activity, run times and a run-activity route

Issue-fixes spec §5.2 Reads: the group view carries the newest 50 activity rows, the run view
startedAt/endedAt/lastActivityAt (null before schema 9), and GET /api/control/runs/:runId/activity
answers the run's newest 200 rows under the evidence route's checks. Wire schemas, the Web
mirror and the parity pair are added.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### B.3 Spec §5.3 criteria → where they are pinned

| §5.3 criterion | Test |
|---|---|
| Migration 8→9 keeps every row and adds the table; an unknown version is refused | `schema9.test.ts` tests 2, 3 (and `store.test.ts` "does not migrate or rewrite an unknown schema version") |
| Per kind: committing change writes its row(s) | `activityRuns.test.ts` (run-claimed, run-started, phase, run-blocked, run-resumed, run-settled ×3 writers, stop ×3), `activity.test.ts` (command), `integrationGit.test.ts` (integration) |
| A rolled-back change writes none (mutation: write outside the transaction) | `activity.test.ts` "refuses to write outside a transaction, and a rolled-back transaction leaves no row…" + B3 mutation (a); refused commands/stops in B7/B9 |
| A replayed command writes none | B7 (`c1` replay), B8 (recovery-retry replay), B9 (pause replay) |
| Retention keeps exactly the newest 500, never another group's | `activity.test.ts` retention test |
| startedAt/endedAt at the specified moments with the injected clock; null for pre-v9 runs | B4, B5 driver/web tests; B11 `startedAt: null, endedAt: null` for `insertValidTaskRun`'s run |
| The run-activity route refuses another project's run | B11 `run-other-project` → 404 `run-not-found` |
