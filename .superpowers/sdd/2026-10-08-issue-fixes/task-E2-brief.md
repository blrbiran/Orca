### Task E2: Summary fields and the view's per-item category (spec §6.1, §6.2)

**Files:**
- Modify: `src/control/webProtocol.ts` — `groupSummarySchema` (lines 1018-1035, anchor `export const groupSummarySchema`),
  `workItemViewSchema` (lines 1123-1150, anchor `export const workItemViewSchema`), imports (lines 1-6)
- Modify: `src/panel/controlViews.ts` — imports (lines 1-55), `taskCompletion` (lines 271-286), `readGroupSummary`
  (lines 316-350), `workViews` return object (line 620, anchor `progress: currentProgress(runs, body.currentRunId ?? null),`)
- Modify: `web/src/controlTypes.ts` — `GroupSummaryV1` (lines 62-77), `WorkItemViewV1` (lines 185-208), constants near
  `WEB_SYSTEM_LABELS` (line 533)
- Modify: `tests/panel/webParity.test.ts` — runtime describe (after the `WEB_SYSTEM_LABELS` case, line 118-122)
- Test: `tests/panel/groupSummaryFields.test.ts` (new)

**Interfaces:**
- Consumes: E1 `workItemCategory`, `WORK_ITEM_CATEGORIES`; Part B `latestGroupActivityAt`; `workBranchRef`
  (`src/control/workspace.ts:44`); E3 is not needed yet (`archived` is read with `archivedMarkOf`, created here in
  `src/control/archivedMark.ts` because the summary needs it first).
- Produces: summary `goal?: string`, `branch?: string`, `counts?: Record<WorkItemCategory, number>`,
  `updatedAt?: number | null`, `archived?: boolean`; work item view `category?: WorkItemCategory`;
  `src/control/archivedMark.ts` (`archivedMarkSchema`, `archivedMarkOf`, `isGroupArchived`); web
  `WEB_WORK_ITEM_CATEGORIES`, `WorkItemCategoryV1`.

- [ ] **Step 1: Write the failing test** — `tests/panel/groupSummaryFields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { insertClarifyingGroup } from "../../src/control/requirementRecords.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { clarifyingInput } from "../control/fixtures/requirement.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const work = (h: H, id: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)) as Record<string, unknown>;
const saveWork = (h: H, id: string, body: Record<string, unknown>) => h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(body), id);
const dispatch = (h: H) => ({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate });

/**
 * One task per category of spec §6.1: a (claimed, its run blocked), b (ready, depends on a), c (claimed, running),
 * d (done), e (ready, no dependency).
 */
async function mixed() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }, { taskId: "c" }, { taskId: "d" }, { taskId: "e" }]);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.start(h.command("start", {}));
  const first = await deliverScheduledStart(dispatch(h), "g");
  if (first.kind !== "claimed") throw new Error(JSON.stringify(first));
  const blockedRun = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(first.runId)!.body)) as Record<string, unknown>;
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...blockedRun, state: "blocked" }), first.runId);
  const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
  h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)")
    .run("scheduler-wake:g:second", "g", canonicalBytes({ groupId: "g", startRevision: revision }).toString("utf8"));
  const second = await deliverScheduledStart(dispatch(h), "g");
  if (second.kind !== "claimed") throw new Error(JSON.stringify(second));
  saveWork(h, "d", { ...work(h, "d"), status: "done" });
  return h;
}

describe("the group summary's new fields (spec §6.2)", () => {
  it("counts each task under its §6.1 category, beside completion, and names goal, branch, updatedAt and archived", async () => {
    const h = await mixed();
    try {
      const summary = readGroupSummary(h.store, "g");
      expect(summary.counts).toEqual({ idle: 1, running: 1, waiting: 1, blocked: 1, done: 1 });
      expect(summary.completion).toEqual({ done: 1, total: 5 });
      expect(summary.goal).toBe("ship");
      expect(summary.branch).toBe("orca/g");
      expect(summary.archived).toBe(false);
      const newest = h.store.db.prepare("SELECT at FROM activity WHERE group_id='g' ORDER BY seq DESC LIMIT 1").get();
      expect(newest).toBeDefined();
      expect(summary.updatedAt).toBe(Number(newest!.at));
    } finally { await h.dispose(); }
  });

  it("sends each work item's category in the group view, so the web never re-derives it", async () => {
    const h = await mixed();
    try {
      const view = readControlGroup(h.store, "epoch", "g");
      expect(Object.fromEntries(view.workItems.map((item) => [item.taskId, item.category]))).toEqual({ a: "blocked", b: "waiting", c: "running", d: "done", e: "idle" });
    } finally { await h.dispose(); }
  });

  it("reports archived from the body's mark", async () => {
    const h = await webFixture();
    try {
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, archived: { at: 5, actor: "human" } }));
      expect(readGroupSummary(h.store, "g").archived).toBe(true);
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, archived: "yes" }));
      expect(() => readGroupSummary(h.store, "g")).toThrow(ControlError);
    } finally { await h.dispose(); }
  });

  it("summarises a clarifying group with its idea as goal, its branch, no counts and no updatedAt yet", async () => {
    const h = await webFixture();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
      });
      const summary = readGroupSummary(h.store, "r");
      expect(summary).toMatchObject({ goal: clarifyingInput("r").idea, branch: "orca/r", archived: false, updatedAt: null });
      expect(summary.counts).toBeUndefined();
    } finally { await h.dispose(); }
  });
});
```

  Also add to `tests/panel/webParity.test.ts`, after the `WEB_SYSTEM_LABELS` case inside the first `describe` (imports:
  `import { WORK_ITEM_CATEGORIES } from "../../src/control/workItemCategory.js";` and add `WEB_WORK_ITEM_CATEGORIES` to the
  existing `../../web/src/controlTypes.js` value import on line 17):

```ts
  // Issue-fixes spec §6.1: the web's category list is the server's table, in order (the graph legend draws it).
  it("WEB_WORK_ITEM_CATEGORIES is the same list as WORK_ITEM_CATEGORIES", () => {
    expect([...WEB_WORK_ITEM_CATEGORIES]).toEqual([...WORK_ITEM_CATEGORIES]);
  });
```

- [ ] **Step 2: Run it, expect FAIL** —
  `./node_modules/.bin/vitest run tests/panel/groupSummaryFields.test.ts tests/panel/webParity.test.ts > <S>/e2.txt 2>&1; echo rc=$?`
  → `rc=1`: `summary.counts` is `undefined`; `WEB_WORK_ITEM_CATEGORIES` is not exported.

- [ ] **Step 3: Implement.**

  (a) Create `src/control/archivedMark.ts` (a leaf: `commandLedger.ts`, `webDispatch.ts` and the views import it, and
  `archiveGroup.ts` imports `commandLedger.ts`, so the reader lives apart to keep the import graph acyclic):

```ts
import { z } from "zod";
import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";

/**
 * Issue-fixes spec §6.3 (ruling H4): an archived group's body carries `archived: { at, actor }` -- ms since the epoch and
 * the actor of the archive command. Bodies are passthrough; the status enum is not extended.
 */
export const archivedMarkSchema = z.object({ at: z.number().int().nonnegative(), actor: z.string().min(1) }).strict();
export type ArchivedMark = z.infer<typeof archivedMarkSchema>;

/** The mark on a parsed group body, null without one; a mark that does not parse blocks by name instead of reading as either. */
export function archivedMarkOf(body: unknown): ArchivedMark | null {
  if (typeof body !== "object" || body === null || !Object.hasOwn(body, "archived")) return null;
  const parsed = archivedMarkSchema.safeParse((body as { archived: unknown }).archived);
  if (!parsed.success) throw new ControlError("recovery-blocked", "group-archived-invalid");
  return parsed.data;
}

/** Whether the stored group is archived; a group that does not exist is not (its own readers refuse it by name). */
export function isGroupArchived(store: ControlStore, groupId: string): boolean {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row !== undefined && archivedMarkOf(JSON.parse(String(row.body))) !== null;
}
```

  (b) `src/control/webProtocol.ts`: add `import { WORK_ITEM_CATEGORIES } from "./workItemCategory.js";` after line 6
  (`import { isTimeZone } from "./usageCalendar.js";`). In `groupSummarySchema`, after the `requirement:` line
  (`requirement: requirementSummarySchema.optional(),`) add:

```ts
    // Issue-fixes spec §6.2: optional on the wire so older fixtures parse; the server always gives every one. `goal` is the
    // plan's goal, or a clarifying group's idea; `branch` is orca/<groupId>; `counts` are §6.1's categories over the plan's
    // tasks (a work item that cannot be read is in no count); `updatedAt` is the `at` of the group's newest activity row,
    // null before the first; `archived` says whether the body carries an archive mark (§6.3).
    goal: nonemptyString.optional(),
    branch: nonemptyString.optional(),
    counts: z.object({ idle: safeInteger, running: safeInteger, waiting: safeInteger, blocked: safeInteger, done: safeInteger }).strict().optional(),
    updatedAt: safeInteger.nullable().optional(),
    archived: z.boolean().optional(),
```

  In `workItemViewSchema`, after the `objective:` line (`objective: z.object({ goal: nonemptyString, successCondition: nonemptyString }).strict().optional(),`) add:

```ts
    // Issue-fixes spec §6.1: the item's display category, computed once on the server. Optional on the wire like labels;
    // the server always gives it.
    category: z.enum(WORK_ITEM_CATEGORIES).optional(),
```

  (c) `src/panel/controlViews.ts`: add to the imports (after line 24, `import { readGroupIntegration } ...`):

```ts
import { latestGroupActivityAt } from "../control/activity.js";
import { archivedMarkOf } from "../control/archivedMark.js";
import { workItemCategory, type WorkItemCategory } from "../control/workItemCategory.js";
import { workBranchRef } from "../control/workspace.js";
```

  Replace `taskCompletion` (lines 271-286, from the doc comment `/**\n * Labels and progress spec §4.1 (§8 R14): ...` through
  its closing `}`) with:

```ts
/**
 * Issue-fixes spec §6.1: one work item's category -- its stored status, whether its current run (currentRunId) is stored
 * `blocked`, and whether every dependency's stored status is `done`. The group view and the summary counts both call it.
 */
function categoryOf(store: ControlStore, groupId: string, work: { status?: unknown; currentRunId?: unknown; dependsOn?: unknown }): WorkItemCategory {
  const runRow = typeof work.currentRunId === "string" ? store.db.prepare("SELECT body FROM runs WHERE group_id=? AND id=?").get(groupId, work.currentRunId) : undefined;
  const currentRunBlocked = runRow !== undefined && (JSON.parse(String(runRow.body)) as { state?: unknown }).state === "blocked";
  const dependenciesDone = (Array.isArray(work.dependsOn) ? work.dependsOn : []).every((id) => {
    const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, String(id));
    return row !== undefined && (JSON.parse(String(row.body)) as { status?: unknown }).status === "done";
  });
  return workItemCategory({ status: String(work.status), currentRunBlocked, dependenciesDone });
}

/**
 * Labels and progress spec §4.1 (§8 R14): `done` is the plan tasks whose work item the view shows as `completed` (stored
 * `done`, or already `completed`); `total` is the archived plan's task count, never the work_items rows (a handoff has
 * one too). Issue-fixes spec §6.2: the same loop counts each task under its §6.1 category. Lenient on purpose (plan
 * finding F5): a work item this cannot read counts as not done and is in no category, and the group view's workViews
 * names it exactly as before; a summary list must not go dark over one bad row.
 */
function taskCompletion(store: ControlStore, groupId: string, plan: ReturnType<typeof readArchivedPlan>["plan"]): {
  completion: { done: number; total: number }; counts: Record<WorkItemCategory, number>;
} {
  let done = 0;
  const counts: Record<WorkItemCategory, number> = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
  for (const task of plan.tasks) {
    const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, task.taskId);
    let work: { status?: unknown; currentRunId?: unknown; dependsOn?: unknown } | null = null;
    try { work = row === undefined ? null : JSON.parse(String(row.body)) as typeof work; } catch { work = null; }
    if (work?.status === "done" || work?.status === "completed") done += 1;
    if (work !== null) {
      try { counts[categoryOf(store, groupId, work)] += 1; } catch { /* in no count: the view names it */ }
    }
  }
  return { completion: { done, total: plan.tasks.length }, counts };
}
```

  In `readGroupSummary`, replace the line
  `    ...(archived === null ? {} : { completion: taskCompletion(store, groupId, archived.plan) }),`
  with the four lines below, and add `const tally = ...` right before `const summary = {`:

```ts
  const tally = archived === null ? null : taskCompletion(store, groupId, archived.plan);
```

```ts
    ...(tally === null ? {} : { completion: tally.completion, counts: tally.counts }),
    goal: archived !== null ? archived.plan.goal : readRequirementGroup(store, groupId).requirement.idea,
    branch: workBranchRef(groupId).slice("refs/heads/".length),
    updatedAt: latestGroupActivityAt(store, groupId),
    archived: archivedMarkOf(body) !== null,
```

  (`archived` there is the archived *plan*, as today; the body's mark is read through `archivedMarkOf(body)`.)

  In `workViews`, after `progress: currentProgress(runs, body.currentRunId ?? null),` add:

```ts
      category: categoryOf(store, groupId, body),
```

  (d) `web/src/controlTypes.ts`: in `GroupSummaryV1`, after `requirement?: RequirementSummaryV1;` add:

```ts
  /** Issue-fixes spec §6.2: optional so literal fixtures need no edit; the server always sends each. */
  goal?: string;
  branch?: string;
  counts?: Record<WorkItemCategoryV1, number>;
  updatedAt?: number | null;
  archived?: boolean;
```

  In `WorkItemViewV1`, after `objective?: { goal: string; successCondition: string };` add:

```ts
  /** Issue-fixes spec §6.1: the server's display category; optional so literal fixtures need no edit. */
  category?: WorkItemCategoryV1;
```

  After `export const CUSTOM_LABEL_PREFIX = "custom:";` add:

```ts
/** Issue-fixes spec §6.1: the server's categories in its table's order (webParity.test.ts pins the list). */
export const WEB_WORK_ITEM_CATEGORIES = ["idle", "running", "waiting", "blocked", "done"] as const;
export type WorkItemCategoryV1 = (typeof WEB_WORK_ITEM_CATEGORIES)[number];
```

- [ ] **Step 4: Run, expect PASS** — the Step 2 command → `rc=0`. Then
  `./node_modules/.bin/vitest run tests/panel tests/control/webProtocol.test.ts tests/control/requirementAccept.test.ts > <S>/e2-wide.txt 2>&1; echo rc=$?` → `rc=0`;
  `npm run typecheck > <S>/e2-tc.txt 2>&1; echo rc=$?` → `rc=0` (the parity compile-time half checks the new optional
  fields both ways without a normaliser).

- [ ] **Step 5: Mutation** (clone): (a) in `categoryOf` replace `currentRunBlocked,` in the call with
  `currentRunBlocked: false,` → both "counts each task…" and "sends each work item's category…" go red (a counted as
  running); (b) delete `goal:` line → "counts each task…" red; replace the goal ternary with `archived!.plan.goal` → the
  clarifying test red (throws); (c) delete `updatedAt:` → red; (d) replace `archivedMarkOf(body) !== null` with `false`
  → "reports archived" red; (e) delete `category: categoryOf(...)` → the view test red.

- [ ] **Step 6: Commit** —
  `git -C <wt> add src/control/archivedMark.ts src/control/webProtocol.ts src/panel/controlViews.ts web/src/controlTypes.ts tests/panel/groupSummaryFields.test.ts tests/panel/webParity.test.ts`
  message `feat(control): summarise goal, branch, counts, updatedAt and archived, and send each work item's category`
  (body: `Issue-fixes spec 6.1, 6.2.` and the Co-Authored-By line).

