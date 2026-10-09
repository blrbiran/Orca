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

