### Task C2: Startup recovery heals empty-frozen-set shutdown intents

**Files:**
- Modify `src/control/recovery.ts`: imports after line 11; new function before line 13 (`/** Recovery never creates…`);
  call inserted after line 54 (`store.dispatchBlocked=blocked.size>0;`), i.e. before `deliverSchedulerWakes` (line 58).
- Create test `tests/control/shutdownHealing.test.ts`.

**Interfaces:**
- Consumes (Part B, fixed): `recordActivity(store: ControlStore, row: ActivityRow): void` and
  `readGroupActivity(store: ControlStore, groupId: string, limit: number): ActivityEntry[]` from `src/control/activity.ts`;
  `ActivityKind` includes `"stop-cleared"`. Existing: `readGroupBody`, `saveGroupBody` (`src/control/stopIntent.ts`),
  `recordProjectionChange` (`src/control/projectionJournal.ts`), `store.transaction`.
- Produces: non-exported `healEmptyShutdownIntents(store: ControlStore): void`, called once per `recoverControl`.
  Effect per healed group: `stop_intents` row deleted, group `stopped = false`, one projection change, one activity row
  `{ kind: "stop-cleared", body: { reason: "empty-shutdown-intent" } }`, command revision untouched. Rows of mode
  `shutdown` with a non-empty `frozenRunIds`, and every `pause`/`handoff` row, are untouched.

- [ ] **Step 1: Write the failing test** — create `tests/control/shutdownHealing.test.ts`:
```ts
/**
 * Issue-fixes spec §3.2 (2) and §3.4, invariant S1: a persisted `shutdown` stop intent exists only when a shutdown froze
 * at least one active run. Stores written by an older Orca hold empty-frozen-set shutdown intents on idle groups, which
 * refuse `start` with `stop-mode-conflict` and offer no way out; startup recovery deletes them. The seed below writes the
 * row exactly as the older `shutdownGroup` did (state `handoff-complete`, frozen set empty, group `stopped`).
 */
import { describe, expect, it } from "vitest";
import { recoverControl } from "../../src/control/recovery.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { WebControlService } from "../../src/control/webService.js";
import { webFixture } from "./fixtures/web.js";
import type { ControlStore } from "../../src/control/store.js";

const ACCEPTED_AT = "2026-10-07T10:00:00.000Z";
const DEADLINE_AT = "2026-10-07T10:02:00.000Z";

const revisionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
const projectionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id='g'").get()!.projection_seq);
const stopped = (store: ControlStore): boolean => (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { stopped: boolean }).stopped;
const stopRow = (store: ControlStore): { mode: string; revision: number; body: string } | undefined => {
  const row = store.db.prepare("SELECT mode,revision,body FROM stop_intents WHERE group_id='g'").get();
  return row ? { mode: String(row.mode), revision: Number(row.revision), body: String(row.body) } : undefined;
};
const cleared = (store: ControlStore) => readGroupActivity(store, "g", 50).filter((entry) => entry.kind === "stop-cleared");

/** The row an older Orca's shutdown left on an idle group: a shutdown intent at the current revision, group stopped. */
function seedShutdownIntent(store: ControlStore, frozenRunIds: string[]): void {
  const state = frozenRunIds.length === 0 ? "handoff-complete" : "handoff-pending";
  const body = canonicalBytes({ mode: "shutdown", state, frozenRunIds, acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT }).toString("utf8");
  store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES ('g','shutdown',?,?)").run(revisionOf(store), body);
  const group = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  group.stopped = true;
  store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
}

async function confirmedGroup() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  const confirmed = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in confirmed) throw new Error(JSON.stringify(confirmed));
  return { h, service };
}

describe("startup recovery heals empty-frozen-set shutdown intents (issue-fixes spec §3.2 (2))", () => {
  it("deletes the intent, clears stopped, keeps the revision, advances the projection once, records stop-cleared, and start then succeeds", async () => {
    const { h, service } = await confirmedGroup(); try {
      seedShutdownIntent(h.store, []);
      // The dead end the healing removes: start is refused while the stale intent exists.
      const refused = await service.start(h.command("start", {}));
      expect("error" in refused ? refused.error.code : "accepted").toBe("stop-mode-conflict");
      const before = { revision: revisionOf(h.store), projection: projectionOf(h.store) };
      await recoverControl(h.store, h.deps.port);
      expect(stopRow(h.store)).toBeUndefined();
      expect(stopped(h.store)).toBe(false);
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(projectionOf(h.store)).toBe(before.projection + 1);
      expect(cleared(h.store).map((entry) => entry.body)).toEqual([{ reason: "empty-shutdown-intent" }]);
      // A second start of the same store finds nothing to heal: no second row, no second projection change.
      await recoverControl(h.store, h.deps.port);
      expect(cleared(h.store)).toHaveLength(1);
      expect(projectionOf(h.store)).toBe(before.projection + 1);
      const started = await service.start(h.command("start", {}));
      expect("error" in started ? started.error.code : started.result.kind).toBe("scheduled");
    } finally { await h.dispose(); }
  });

  it("leaves a shutdown intent that froze a run untouched", async () => {
    const { h } = await confirmedGroup(); try {
      seedShutdownIntent(h.store, ["run-frozen"]);
      const before = { intent: stopRow(h.store), revision: revisionOf(h.store), projection: projectionOf(h.store) };
      await recoverControl(h.store, h.deps.port);
      expect(stopRow(h.store)).toEqual(before.intent);
      expect(stopped(h.store)).toBe(true);
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(projectionOf(h.store)).toBe(before.projection);
      expect(cleared(h.store)).toEqual([]);
    } finally { await h.dispose(); }
  });
});
```
(If Part B's fixture injects a clock into the store, nothing here depends on `at`.)

- [ ] **Step 2: Run, expect FAIL**
```
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/control/shutdownHealing.test.ts > $SCRATCH/c2-red.txt 2>&1; echo rc=$?
```
Expected rc=1: the first test fails at `expect(stopRow(h.store)).toBeUndefined()` (a row is still there); the second passes.

- [ ] **Step 3: Implement** — `src/control/recovery.ts`. After line 11 (`import { acquireRepoLock } from "../scheduler/repoLock.js";`) add:
```ts
import { readGroupBody, saveGroupBody } from "./stopIntent.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { recordActivity } from "./activity.js";

/**
 * Issue-fixes spec §3.2 (2), invariant S1: a `shutdown` stop intent whose frozen set is empty froze nothing; it is the dead
 * end an older Orca left on idle groups. Each is deleted and its group un-stopped, in one transaction of its own. The
 * command revision is not advanced (recovery changes projection state, not command revision); the projection advances
 * once per healed group and one `stop-cleared` activity row records why. An empty frozen set has no requests or
 * outboxes, so crash-after-commit redelivery of a real shutdown is unaffected.
 */
function healEmptyShutdownIntents(store:ControlStore):void {
 store.transaction(()=>{
  for(const row of store.db.prepare("SELECT group_id,body FROM stop_intents WHERE mode='shutdown' ORDER BY group_id").all()) {
   const frozen=(JSON.parse(String(row.body)) as {frozenRunIds?:unknown[]}).frozenRunIds;
   if(!Array.isArray(frozen)||frozen.length!==0)continue;
   const groupId=String(row.group_id);
   store.db.prepare("DELETE FROM stop_intents WHERE group_id=?").run(groupId);
   const group=readGroupBody(store,groupId);group.stopped=false;saveGroupBody(store,group);
   recordProjectionChange(store,[groupId]);
   recordActivity(store,{groupId,kind:"stop-cleared",body:{reason:"empty-shutdown-intent"}});
  }
 });
}
```
(The file's compact style is kept, Rule 11.) Then, anchor line 54:
```ts
 store.dispatchBlocked=blocked.size>0;
```
becomes:
```ts
 store.dispatchBlocked=blocked.size>0;
 // Healed before any wake is delivered, so a pending start wake never meets a stale shutdown intent.
 healEmptyShutdownIntents(store);
```

- [ ] **Step 4: Run, expect PASS**
```
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/control/shutdownHealing.test.ts tests/control/recovery.test.ts tests/control/driverRecovery.test.ts tests/control/webFaults.test.ts tests/panel/controlStartup.test.ts tests/panel/controlRecoveryApi.test.ts > $SCRATCH/c2-green.txt 2>&1; echo rc=$?
npm run typecheck > $SCRATCH/c2-tc.txt 2>&1; echo rc=$?
```
Both rc=0.

- [ ] **Step 5: Mutation** (clone copy only; each seen red, observed while planning)
  1. `if(!Array.isArray(frozen)||frozen.length!==0)continue;` → `if(!Array.isArray(frozen))continue;` ⇒ "leaves a shutdown intent that froze a run untouched" red.
  2. Delete the `DELETE FROM stop_intents` line ⇒ first test red.
  3. Delete the `recordActivity(...)` line ⇒ first test red (`cleared` empty).
  4. Delete the `healEmptyShutdownIntents(store);` call ⇒ first test red.
  Known equivalent mutant (stated, not hidden): deleting only `recordProjectionChange(store,[groupId]);` stays green,
  because Part B's `recordActivity` records the group's projection change when the transaction has not. The explicit call
  is kept because spec §3.2 (2) requires the projection change independently of the activity mechanism.

- [ ] **Step 6: Commit**
```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/recovery.ts tests/control/shutdownHealing.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "fix(control): recovery heals empty-frozen-set shutdown intents

Issue-fixes spec §3.2 (2): before scheduler wakes are delivered, startup recovery
deletes every shutdown intent that froze no run, un-stops its group, advances the
projection once, keeps the command revision and records a stop-cleared activity row.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

