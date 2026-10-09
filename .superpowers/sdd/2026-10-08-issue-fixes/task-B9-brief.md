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

