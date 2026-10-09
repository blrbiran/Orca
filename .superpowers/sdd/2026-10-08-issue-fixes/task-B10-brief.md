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

