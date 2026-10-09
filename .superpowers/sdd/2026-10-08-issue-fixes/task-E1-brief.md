### Task E1: The work-item display category (spec §6.1)

**Files:**
- Create: `src/control/workItemCategory.ts`
- Test: `tests/control/workItemCategory.test.ts` (new)

**Interfaces:**
- Consumes: `ControlError` (`src/control/errors.ts`).
- Produces: `export const WORK_ITEM_CATEGORIES = ["idle", "running", "waiting", "blocked", "done"] as const;`
  `export type WorkItemCategory = (typeof WORK_ITEM_CATEGORIES)[number];`
  `export function workItemCategory(input: { status: string; currentRunBlocked: boolean; dependenciesDone: boolean }): WorkItemCategory;`

- [ ] **Step 1: Write the failing test** — `tests/control/workItemCategory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { WORK_ITEM_CATEGORIES, workItemCategory } from "../../src/control/workItemCategory.js";

const at = (status: string, currentRunBlocked = false, dependenciesDone = true) => workItemCategory({ status, currentRunBlocked, dependenciesDone });

/**
 * Issue-fixes spec §6.1: one server-side mapping from a work item to what the panel shows, used by the summary counts and
 * sent in the view. A terminally failed run is `blocked` on its run while its item still reads `running`; showing it as
 * running is the bug of issue 16 this table fixes.
 */
describe("workItemCategory (spec §6.1)", () => {
  it("names exactly the five categories of the table", () => {
    expect([...WORK_ITEM_CATEGORIES]).toEqual(["idle", "running", "waiting", "blocked", "done"]);
  });

  it("blocked: the item is blocked", () => {
    expect(at("blocked")).toBe("blocked");
  });

  it("blocked: the item is held waiting for a person to continue it", () => {
    expect(at("held")).toBe("blocked");
  });

  it("blocked: an item `running` whose current run is blocked (a terminal failure today displays as active)", () => {
    expect(at("running", true)).toBe("blocked");
    expect(at("starting", true)).toBe("blocked");
  });

  it("running: running, continuing, starting, start-unknown (and the view's active) with a current run that is not blocked", () => {
    for (const status of ["running", "continuing", "starting", "start-unknown", "active"]) expect(at(status), status).toBe("running");
  });

  it("waiting: ready while some dependency is not done", () => {
    expect(at("ready", false, false)).toBe("waiting");
  });

  it("idle: ready with every dependency done, or draft", () => {
    expect(at("ready", false, true)).toBe("idle");
    expect(at("draft", false, false)).toBe("idle");
  });

  it("done: done (and the view's completed)", () => {
    expect(at("done")).toBe("done");
    expect(at("completed")).toBe("done");
  });

  it("refuses a status the table does not know by name rather than guessing a category", () => {
    expect(() => at("mystery")).toThrow(ControlError);
    expect(() => at("mystery")).toThrow(/work-item-category:mystery/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/workItemCategory.test.ts > <S>/e1.txt 2>&1; echo rc=$?` → `rc=1`, "Failed to load url ../../src/control/workItemCategory.js".

- [ ] **Step 3: Implement** — create `src/control/workItemCategory.ts`:

```ts
import { ControlError } from "./errors.js";

/** Issue-fixes spec §6.1: the five display categories, in the table's order. */
export const WORK_ITEM_CATEGORIES = ["idle", "running", "waiting", "blocked", "done"] as const;
export type WorkItemCategory = (typeof WORK_ITEM_CATEGORIES)[number];

/** Stored `running` and the view's `active` are the same state; the rest are the stored claim states. */
const RUNNING = new Set(["running", "active", "continuing", "starting", "start-unknown"]);

/**
 * Issue-fixes spec §6.1, the one mapping from a work item to its display category (the summary counts and the view's
 * `category` both call it, so the web never re-derives it). `done` is decided first: a finished task is finished whatever
 * its last run says. A held item waits for a person to continue it, so it is `blocked` like a blocked run (review I6).
 */
export function workItemCategory(input: { status: string; currentRunBlocked: boolean; dependenciesDone: boolean }): WorkItemCategory {
  const { status } = input;
  if (status === "done" || status === "completed") return "done";
  if (status === "blocked" || status === "held" || input.currentRunBlocked) return "blocked";
  if (RUNNING.has(status)) return "running";
  if (status === "ready") return input.dependenciesDone ? "idle" : "waiting";
  if (status === "draft") return "idle";
  throw new ControlError("recovery-blocked", `work-item-category:${status}`);
}
```

- [ ] **Step 4: Run, expect PASS** — same command → `rc=0`, 9 passed. `npm run typecheck > <S>/e1-tc.txt 2>&1; echo rc=$?` → `rc=0`.

- [ ] **Step 5: Mutation** — in a `git clone --local <wt> <S>/mut-e1` copy: (a) delete `|| input.currentRunBlocked` →
  "blocked: an item `running` whose current run is blocked" goes red; (b) replace `input.dependenciesDone ? "idle" : "waiting"`
  with `"idle"` → "waiting: ready while some dependency is not done" goes red; (c) delete `|| status === "held"` → the held
  test goes red. Restore by deleting the clone.

- [ ] **Step 6: Commit** —
  `git -C <wt> add src/control/workItemCategory.ts tests/control/workItemCategory.test.ts`
  `git -C <wt> commit -m "feat(control): map a work item to its display category" -m "Issue-fixes spec 6.1: one server-side table (idle, running, waiting, blocked, done); a running item whose current run is blocked is blocked." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

