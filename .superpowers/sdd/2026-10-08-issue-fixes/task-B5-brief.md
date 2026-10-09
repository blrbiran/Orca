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

