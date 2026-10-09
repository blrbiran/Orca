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

