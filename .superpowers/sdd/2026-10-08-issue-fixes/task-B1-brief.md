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

