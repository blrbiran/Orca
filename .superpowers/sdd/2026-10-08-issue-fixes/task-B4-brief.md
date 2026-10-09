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

