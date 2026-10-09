### Task E5: The claim, wake and integration paths skip an archived group (spec §6.3)

**Files:**
- Modify: `src/control/webDispatch.ts` — imports (line 19), `deliverScheduledStart` transaction (lines 206-208, anchor
  `if (!still) return activeWorkRun(store, groupId) ?? { kind: "idle" as const };`), `nextClaimableTask` (lines 294-296)
- Modify: `src/control/integrationPass.ts` — imports (line 12), the per-group loop (lines 86-99, anchor
  `try { integration = readGroupIntegration(JSON.parse(String(row.body))); }`)
- Test: `tests/control/archiveGroup.test.ts` (append), `tests/control/webContinuation.test.ts` (append one `it`),
  `tests/control/integrationGit.test.ts` (append one `describe`)

**Interfaces:**
- Consumes: `isGroupArchived`, `archivedMarkOf`.
- Produces: `deliverScheduledStart` answers `{ kind: "blocked", reason: "group-archived" }` for an archived group and leaves
  its wake pending; `nextClaimableTask` answers null.

Coverage of the five paths the spec names: `nextClaimableTask` carries its own check, and `replenishStartWakes`
(`src/control/executionDriver.ts:776`) arms a wake only when `nextClaimableTask` answers a task, so it is covered there;
`deliverScheduledStart` checks inside its transaction, and `deliverContinuationWake` (`webDispatch.ts:264`) is called
only from that transaction after the check. A second, separate check in `replenishStartWakes` or
`deliverContinuationWake` could never be seen red by any test (the first check always answers first), so it is not added
(Rule 9); each named path has its own test below.

- [ ] **Step 1: Write the failing tests.** Append to `tests/control/archiveGroup.test.ts` (imports:
  `import { replenishStartWakes } from "../../src/control/executionDriver.js";` and add `nextClaimableTask` to the
  `webDispatch.js` import):

```ts
describe("no claim and no wake for an archived group (spec §6.3)", () => {
  const pending = (h: H) => h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' AND delivered=0").all().map((row) => String(row.id));
  const activeRuns = (h: H) => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n);

  it("leaves a pending start wake pending and claims nothing", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      const wakes = pending(h);
      expect(wakes).toHaveLength(1);
      service.archiveGroup(h.command("archive-group", {}));
      expect(await deliverScheduledStart(dispatch(h), "g")).toEqual({ kind: "blocked", reason: "group-archived" });
      expect(pending(h)).toEqual(wakes);
      expect(activeRuns(h)).toBe(0);
      service.unarchiveGroup(h.command("unarchive-group", {}));
      expect((await deliverScheduledStart(dispatch(h), "g")).kind).toBe("claimed");
    } finally { await h.dispose(); }
  });

  it("offers no claimable task, so the driver arms no new start wake, until it is unarchived", async () => {
    const { h, service } = await confirmed();
    try {
      await service.start(h.command("start", {}));
      h.store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE group_id='g' AND kind='start'").run();
      service.archiveGroup(h.command("archive-group", {}));
      expect(nextClaimableTask(h.store, "g")).toBeNull();
      expect(replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate })).toEqual([]);
      service.unarchiveGroup(h.command("unarchive-group", {}));
      expect(nextClaimableTask(h.store, "g")).toEqual({ workItemId: "a" });
      expect(replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate })).toEqual(["drive:g:1"]);
    } finally { await h.dispose(); }
  });
});
```

  Append to `tests/control/webContinuation.test.ts` (Review Focus 4; imports: add `nextClaimableTask` is not needed; add
  nothing else -- the file already imports `deliverScheduledStart` and has `armOrdinaryClaim`, `pendingWakes`,
  `activeRunIds`, `recoverablePredecessor`, `stoppedAfterHandoff`, `selection`, `continuationFixture`):

```ts
describe("an archived group with a queued continuation and a queued start (issue-fixes spec §6.3, plan Review Focus 4)", () => {
  it("delivers neither wake: no claim is made and both wakes stay pending until it is unarchived", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const resumed = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in resumed || resumed.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(resumed));
      armOrdinaryClaim(h.store);
      const archived = service.archiveGroup(h.command("archive-group", {}));
      if ("error" in archived) throw new Error(JSON.stringify(archived));
      const wakes = pendingWakes(h.store).filter((id) => !id.includes(":estimate:")).sort();
      expect(wakes.length).toBeGreaterThanOrEqual(2);
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "blocked", reason: "group-archived" });
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "blocked", reason: "group-archived" });
      expect(activeRunIds(h.store)).toEqual([]);
      expect(pendingWakes(h.store).filter((id) => !id.includes(":estimate:")).sort()).toEqual(wakes);
      service.unarchiveGroup(h.command("unarchive-group", {}));
      expect((await deliverScheduledStart(ctx.deps, "g")).kind).toBe("claimed");
    } finally { await h.dispose(); }
  });
});
```

  Append to `tests/control/integrationGit.test.ts`:

```ts
describe("an archived group is not integrated (issue-fixes spec §6.3)", { timeout: 60_000 }, () => {
  it("skips its landed work while archived, and integrates it once unarchived", async () => {
    const w = await world(PB); try {
      const tip = w.land({ "a.txt": "a\n" });
      const archived = w.service.archiveGroup(w.command("archive-group", {}));
      if ("error" in archived) throw new Error(JSON.stringify(archived));
      expect(await w.pass()).toBe(false);
      expect(w.remote("orca/g")).toBeNull();
      w.service.unarchiveGroup(w.command("unarchive-group", {}));
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(tip);
    } finally { await w.dispose(); }
  });
});
```

- [ ] **Step 2: Run them, expect FAIL** —
  `./node_modules/.bin/vitest run tests/control/archiveGroup.test.ts tests/control/webContinuation.test.ts tests/control/integrationGit.test.ts > <S>/e5.txt 2>&1; echo rc=$?`
  → `rc=1`: delivery claims (`kind: "claimed"`), `nextClaimableTask` answers `{ workItemId: "a" }`, the pass pushes.

- [ ] **Step 3: Implement.** `src/control/webDispatch.ts`: add `import { isGroupArchived } from "./archivedMark.js";`
  after line 19. In `deliverScheduledStart`'s transaction, after
  `if (!still) return activeWorkRun(store, groupId) ?? { kind: "idle" as const };` add

```ts
      // Issue-fixes spec §6.3: an archived group takes no claim; its start and resume wakes stay pending (blocked keeps them)
      // and are delivered once it is unarchived. deliverContinuationWake is reached only past this line.
      if (isGroupArchived(store, groupId)) return { kind: "blocked" as const, reason: "group-archived" };
```

  In `nextClaimableTask`, as its first statement:

```ts
  // Issue-fixes spec §6.3: nothing in an archived group is claimable; replenishStartWakes arms a wake only for a group
  // this answers a task for.
  if (isGroupArchived(store, groupId)) return null;
```

  `src/control/integrationPass.ts`: add `import { archivedMarkOf } from "./archivedMark.js";` after line 12, and replace

```ts
    try { integration = readGroupIntegration(JSON.parse(String(row.body))); }
    catch (error) { process.stderr.write(`orca-driver: integration ${groupId}: ${describe(error)}\n`); continue; }
```

  with

```ts
    let archived: boolean;
    try {
      const parsed: unknown = JSON.parse(String(row.body));
      integration = readGroupIntegration(parsed);
      archived = archivedMarkOf(parsed) !== null;
    } catch (error) { process.stderr.write(`orca-driver: integration ${groupId}: ${describe(error)}\n`); continue; }
    // Issue-fixes spec §6.3: an archived group's landed work is not carried anywhere until it is unarchived.
    if (archived) continue;
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`. Then
  `./node_modules/.bin/vitest run tests/control/webDispatch.test.ts tests/control/executionDriver.test.ts tests/control/integrationCrash.test.ts > <S>/e5-wide.txt 2>&1; echo rc=$?` → `rc=0`.

- [ ] **Step 5: Mutation** (clone): delete the `deliverScheduledStart` check → "leaves a pending start wake pending" red
  (it answers `idle` and marks the wake delivered) and the continuation test red (the continuation is claimed); delete the
  `nextClaimableTask` check → "offers no claimable task" red; delete `if (archived) continue;` → the integration test red.

- [ ] **Step 6: Commit** — `git -C <wt> add src/control/webDispatch.ts src/control/integrationPass.ts tests/control/archiveGroup.test.ts tests/control/webContinuation.test.ts tests/control/integrationGit.test.ts`,
  message `feat(control): claim, wake and integrate nothing for an archived group` (+ Co-Authored-By).

