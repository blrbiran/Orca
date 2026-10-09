### Task E7: groupCategory for the group list (spec §6.4)

**Files:**
- Create: `web/src/groupCategory.ts`
- Test: `web/tests/groupCategory.test.ts` (new)

**Interfaces:**
- Consumes: `GroupSummaryV1` (E2 fields).
- Produces: `GROUP_CATEGORIES`, `GroupCategory = "archived" | "attention" | "done" | "running" | "not-started"`,
  `GROUP_FILTERS`, `GroupFilter = "all" | GroupCategory`, `GROUP_FILTER_KEY = "orca.panel.groupFilter"`,
  `needsAttention(s)`, `groupCategory(s)`, `matchesGroupFilter(s, f)`, `groupFilterStorage()`,
  `readGroupFilter(storage)`, `writeGroupFilter(storage, f)`.

- [ ] **Step 1: Write the failing test** — `web/tests/groupCategory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GROUP_FILTER_KEY, groupCategory, matchesGroupFilter, needsAttention, readGroupFilter, writeGroupFilter } from "../src/groupCategory.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId: "g", repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 2 }, counts: { ...zero, idle: 2 }, ...over,
});

/** Issue-fixes spec §6.4: a group's list category, first match wins: archived, attention, done, running, not started. */
describe("groupCategory (spec §6.4)", () => {
  it("1: archived", () => expect(groupCategory(g({ archived: true }))).toBe("archived"));
  it("2: needs attention -- a blocked task, a recovery blocker, a blocked claim, a blocked group, a stop not handoff-complete", () => {
    for (const over of [
      { counts: { ...zero, blocked: 1, idle: 1 } }, { recoveryBlockerCount: 1 }, { claimBlocked: true }, { state: "blocked" as const },
      { stopMode: "pause" as const, stopState: "paused" as const }, { stopMode: "handoff" as const, stopState: "handoff-pending" as const },
    ]) expect(groupCategory(g(over)), JSON.stringify(over)).toBe("attention");
    expect(groupCategory(g({ stopMode: "handoff", stopState: "handoff-complete" }))).toBe("not-started");
  });
  it("3: done when every task is done", () => expect(groupCategory(g({ completion: { done: 2, total: 2 }, counts: { ...zero, done: 2 } }))).toBe("done"));
  it("4: running when a task runs or waits, or the group runs or is in review", () => {
    expect(groupCategory(g({ counts: { ...zero, running: 1, idle: 1 } }))).toBe("running");
    expect(groupCategory(g({ counts: { ...zero, waiting: 1, idle: 1 } }))).toBe("running");
    expect(groupCategory(g({ state: "running" }))).toBe("running");
    expect(groupCategory(g({ state: "review" }))).toBe("running");
  });
  it("5: otherwise not started (including a group with no plan tasks)", () => {
    expect(groupCategory(g())).toBe("not-started");
    expect(groupCategory(g({ completion: { done: 0, total: 0 }, counts: zero }))).toBe("not-started");
  });
  it("takes the first match: archived beats attention, attention beats done, done beats running", () => {
    expect(groupCategory(g({ archived: true, claimBlocked: true }))).toBe("archived");
    expect(groupCategory(g({ claimBlocked: true, completion: { done: 2, total: 2 } }))).toBe("attention");
    expect(groupCategory(g({ state: "review", completion: { done: 2, total: 2 } }))).toBe("done");
    expect(needsAttention(g({ archived: true, claimBlocked: true }))).toBe(true);
  });
  it("All excludes archived; every other filter is its own category", () => {
    expect(matchesGroupFilter(g({ archived: true }), "all")).toBe(false);
    expect(matchesGroupFilter(g(), "all")).toBe(true);
    expect(matchesGroupFilter(g({ archived: true }), "archived")).toBe(true);
    expect(matchesGroupFilter(g(), "done")).toBe(false);
  });
});

describe("the remembered filter (spec §6.4: per viewer, storage may be missing or throw)", () => {
  const memory = (): Pick<Storage, "getItem" | "setItem"> => {
    const values = new Map<string, string>();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  };
  const throwing: Pick<Storage, "getItem" | "setItem"> = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

  it("reads back what was written, under its own key", () => {
    const storage = memory();
    writeGroupFilter(storage, "done");
    expect(storage.getItem(GROUP_FILTER_KEY)).toBe("done");
    expect(readGroupFilter(storage)).toBe("done");
  });
  it("answers All for nothing stored, an unknown value, missing storage and throwing storage", () => {
    const storage = memory();
    expect(readGroupFilter(storage)).toBe("all");
    storage.setItem(GROUP_FILTER_KEY, "everything");
    expect(readGroupFilter(storage)).toBe("all");
    expect(readGroupFilter(undefined)).toBe("all");
    expect(readGroupFilter(throwing)).toBe("all");
    expect(() => writeGroupFilter(throwing, "done")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `cd <wt>/web && ../node_modules/.bin/vitest run tests/groupCategory.test.ts > <S>/e7.txt 2>&1; echo rc=$?` → `rc=1` (module missing).

- [ ] **Step 3: Implement** — `web/src/groupCategory.ts`:

```ts
/**
 * Issue-fixes spec §6.4: a group's place in the list, from the server's summary only (counts are the server's §6.1
 * categories; nothing here re-derives a task's state). First match wins.
 */
import type { GroupSummaryV1 } from "./controlTypes.js";

export const GROUP_CATEGORIES = ["not-started", "running", "attention", "done", "archived"] as const;
export type GroupCategory = (typeof GROUP_CATEGORIES)[number];
/** The chips, in the order they are shown; All shows every group but the archived ones. */
export const GROUP_FILTERS = ["all", "not-started", "running", "attention", "done", "archived"] as const;
export type GroupFilter = (typeof GROUP_FILTERS)[number];
export const GROUP_FILTER_KEY = "orca.panel.groupFilter";

/** Spec §6.4 rule 2: a blocked task, a recovery blocker, a blocked claim, a blocked group, or a stop still settling. */
export function needsAttention(summary: GroupSummaryV1): boolean {
  return (summary.counts?.blocked ?? 0) > 0 || summary.recoveryBlockerCount > 0 || summary.claimBlocked || summary.state === "blocked"
    || (summary.stopState !== null && summary.stopState !== "handoff-complete");
}

export function groupCategory(summary: GroupSummaryV1): GroupCategory {
  if (summary.archived === true) return "archived";
  if (needsAttention(summary)) return "attention";
  if (summary.completion !== undefined && summary.completion.total > 0 && summary.completion.done === summary.completion.total) return "done";
  if ((summary.counts?.running ?? 0) + (summary.counts?.waiting ?? 0) > 0 || summary.state === "running" || summary.state === "review") return "running";
  return "not-started";
}

export function matchesGroupFilter(summary: GroupSummaryV1, filter: GroupFilter): boolean {
  const category = groupCategory(summary);
  return filter === "all" ? category !== "archived" : category === filter;
}

/** localStorage, or undefined where touching it throws (a private window, blocked site data). */
export function groupFilterStorage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export function readGroupFilter(storage: Pick<Storage, "getItem"> | undefined): GroupFilter {
  try {
    const value = storage?.getItem(GROUP_FILTER_KEY) ?? null;
    return (GROUP_FILTERS as readonly string[]).includes(value ?? "") ? (value as GroupFilter) : "all";
  } catch {
    return "all";
  }
}

export function writeGroupFilter(storage: Pick<Storage, "setItem"> | undefined, filter: GroupFilter): void {
  try {
    storage?.setItem(GROUP_FILTER_KEY, filter);
  } catch {
    // A filter that is not remembered costs one click next time; the list works without it.
  }
}
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`.
- [ ] **Step 5: Mutation** (build the web first in the clone: `npm run build --workspace web`): swap the `archived` and
  attention lines → "takes the first match" red; delete `|| summary.state === "review"` → rule 4 red; replace the `try`
  body of `readGroupFilter` with `return storage!.getItem(GROUP_FILTER_KEY) as GroupFilter;` → "answers All…" red.
- [ ] **Step 6: Commit** — `git -C <wt> add web/src/groupCategory.ts web/tests/groupCategory.test.ts`, message
  `feat(web): place each group in a list category` (+ Co-Authored-By).

