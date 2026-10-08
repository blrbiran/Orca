## Part E — Categories, summary, archive, list and graph (spec §6)

> **Controller amendment (2026-10-08, binding).** E5 also makes `claimEstimate` and the `requirement-export` wake skip an
> archived group (spec §6.3 "refuses new work"), each with a test that queues the work, archives, delivers, and asserts
> nothing is claimed. Where this part assumed names from Parts B/D, use the names those parts produced (Part B:
> `activityEntrySchema`, `runActivitySchema`, `RunActivityV1`, `fetchRunActivity`; Part D: run view `outcome` and
> `stopReason`, `WebControlService.retryTask`).

Part E runs after Parts A, B, C and D. Every line range below was measured at the commit whose subject is
`docs(spec): revise the issue-fixes design after independent review` (before A–D land); A–D move some of them, so each
step also names the anchor text to find. `<wt>` is `/Users/biran/code/skills/loop/Orca-issues`, `<S>` the executor's
scratchpad. Server tests: `cd <wt> && ./node_modules/.bin/vitest run <file> > <S>/<name>.txt 2>&1; echo rc=$?`. Web
tests: `cd <wt>/web && ../node_modules/.bin/vitest run <file> > <S>/<name>.txt 2>&1; echo rc=$?` (if the root binary
refuses the web config, `npm run check --workspace web` and read the whole file). Every output file is read whole.

### Interfaces consumed from earlier parts (names fixed by the controller's brief)

- Part B: `src/control/activity.ts` `recordActivity(store, row)`, `readGroupActivity(store, groupId, limit)`,
  `latestGroupActivityAt(store, groupId)`, kinds `"archived"`/`"unarchived"`; `ControlStore.now()`; run view fields
  `startedAt`, `lastActivityAt` (web `RunViewV1.startedAt?: number | null`, `lastActivityAt?: number | null`); the
  route `GET /api/control/runs/:runId/activity` answering the web type `RunActivityViewV1`
  (`{ schema; runId; entries: ActivityEntryV1[] }`, entries newest first, `ActivityEntryV1 = { seq; groupId; taskId;
  runId; at; kind; body }`) exported from `web/src/controlTypes.ts`. If Part B named the web type differently, E11 uses
  Part B's name; E11 adds the browser fetch `fetchRunActivity` unless Part B already added one of that name.
- Part A: `enErrors` in `web/src/locales/en.ts`, `zhErrors` in `web/src/locales/zh.ts`, placeholder `{{detail}}`,
  `web/src/refusalExplain.ts` `explainRunReason(reason)`; the extended `tests/panel/refusalCoverage.test.ts` (both
  locales cover every durable code).
- Part C: the group view's stop banner and `handoffActive` covering `shutdown`.
- Part D: verb `retry-task` (group target, payload `{ taskId }`) served by `WebControlService.retryTask(command)`, run
  state `settled-failed`; one more mutation route (so `tests/entry/skill.test.ts` counts 30 routes after D).

### Interfaces produced by this part

- `src/control/workItemCategory.ts`: `WORK_ITEM_CATEGORIES`, `type WorkItemCategory`, `workItemCategory(input)`.
- `src/control/archivedMark.ts`: `archivedMarkSchema`, `archivedMarkOf(body)`, `isGroupArchived(store, groupId)`.
- `src/control/archiveGroup.ts`: `applyArchiveGroup`, `applyUnarchiveGroup`, `ArchiveGroupCommand`,
  `UnarchiveGroupCommand`.
- Verbs `archive-group`, `unarchive-group` (access `any`, routes `POST /api/control/groups/:groupId/archive` and
  `/unarchive`), results `{ kind: "archived", groupId, at }` and `{ kind: "unarchived", groupId }`.
- Durable codes (all 409): `group-archived`, `archive-run-active`, `archive-stop-pending`,
  `archive-integration-resolving`, `archive-call-in-flight`.
- Summary fields `goal?`, `branch?`, `counts?`, `updatedAt?`, `archived?`; work item view `category?`.
- `web/src/groupCategory.ts`: `groupCategory`, `needsAttention`, `matchesGroupFilter`, `GROUP_FILTERS`,
  `GROUP_FILTER_KEY`, `readGroupFilter`, `writeGroupFilter`, `groupFilterStorage`.
- `web/src/GroupList.tsx`, `web/src/clock.ts` (`useClock`), `DependencyGraph` exports `nodeLines`, `runNumber`.

### The single gate for "every group-targeted command" (spec §6.3)

`applyWebCommand` (`src/control/commandLedger.ts:278-371`) is the only function that books a group-scoped command
outcome after the revision check: `persistCommandOutcome` is module-private and its only other caller is
`preflightWebCommand`, which books nothing but `revision-conflict`; the one other `INSERT INTO commands`
(`src/control/commands.ts:34`, the legacy `applyCommand`) is not reachable from a Web or socket route. Every route handler
in `registerControlMutationRoutes` then reads the answer back with `lookupCommandResult` and fails
(`control-command-result-invalid`) if no row was booked. So a verb that changes anything -- `retry-task` included, and any
verb added later -- reaches `applyWebCommand`, and a refusal placed there, after the identity/revision checks and before
`expand`/`apply`, refuses it before any of its own preparation-time failures (the `expand: () => { throw error }` paths
of estimate, requirement-open and import) can surface. Task E4 puts the gate there and pins it with a test that walks
every group-targeted verb of `commandVerbSchema`, so a new verb without an entry fails the test.

### Rewritten existing tests (each required by the spec section named)

| Test (file) | Current assertion | Replacement | Spec |
|---|---|---|---|
| `web/tests/dependencyGraph.test.tsx` "draws nothing for a group without dependencies, where the table already says all there is" | `expect(screen.queryByRole("figure", { name: "Dependency graph" })).toBeNull();` | renamed "draws every task even when no task depends on another"; asserts the figure, two node buttons and zero `path[data-edge]` | §6.5 "renders whenever the group has work items, with or without dependency edges" |
| `web/tests/dependencyGraph.test.tsx` "draws one button per task with its status, and an arrow per dependency" | input `workItem({ taskId: "b", status: "blocked", dependencyTaskIds: ["a"] })`, `expect(...getAttribute("class")).toBe("dep-node dep-blocked")` | input gains `category: "blocked"` (and `category: "done"` for `a`); the class assertion is unchanged | §6.1, §6.5: the node class comes from the server's category, never from the status |
| `web/tests/taskLabels.test.tsx` "lists the manifest's entries and downloads one with the session alone" | `expect(requests).toEqual([{ url: "/api/control/runs/run-a/evidence", ... }, { url: ".../evidence/ev-2", ... }])` | the mock answers `/api/control/runs/run-a/activity` with an empty activity view and the expected list starts with `{ url: "/api/control/runs/run-a/activity", headers: undefined }` | §6.5 "the task detail shows the current run's recent activity (run activity route)" |
| `tests/entry/skill.test.ts` "lists exactly the panel's mutation routes, so the table cannot drift", "names the verb of every route as the panel does", "gives every route a payload example that its raw payload schema accepts" | `expect(routes.size).toBe(30)`, `expect(verbs.size).toBe(30)`, `expect(rows.length).toBe(30)` (29 before Part D) | `32` each | §6.3 two new routes |

No other existing assertion changes: the group card keeps today's row text as its first line and as its accessible name
(E8), so `projectFiltering`, `controlI18n`, `taskLabels` "shows each group's done/total", the `/^g · running/` clicks and
`requirements.test.tsx`'s link text stay green.

---

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

### Task E3: archive-group and unarchive-group (spec §6.3, except the refusal of other verbs)

**Files:**
- Modify: `src/control/errors.ts` — 409 block (lines 37-88): after `"agent-selection-changed": 409,` (line 37) and after
  `"group-already-exists": 409,` (line 48)
- Modify: `src/control/webProtocol.ts` — `commandVerbSchema` (lines 592-623), raw variants (lines 854-887), effective
  variants (lines 889-937), result union (after line 1453 `integration-resolution-started`)
- Create: `src/control/archiveGroup.ts`
- Modify: `src/control/webService.ts` — imports (line 24), methods (after `retryIntegration`, lines 582-585)
- Modify: `src/panel/controlApi.ts` — `controlCommandRoutes` (after line 378, the `integration/resolve` route), the
  verb switch (after line 454, `case "resolve-integration-conflict"`)
- Modify: `src/panel/humanOnly.ts` — `VERB_ACCESS` (lines 9-42)
- Modify: `web/src/controlTypes.ts` — `CommandSuccessV1` verb union and result union (lines 438-472)
- Modify: `web/src/locales/en.ts` `enErrors`, `web/src/locales/zh.ts` `zhErrors` (Part A's tables; alphabetical position)
- Modify: `tests/panel/permissions.test.ts` (one assertion), `tests/panel/controlApi.test.ts` (one `it`)
- Test: `tests/control/archiveGroup.test.ts` (new)

**Interfaces:**
- Consumes: E2 `archivedMarkOf`; Part B `recordActivity`, `store.now()`; `pendingRequirementCall`
  (`src/control/requirementCalls.ts:42`); `readGroupIntegration` (`src/control/integrationScheme.ts:187`);
  `applyWebCommand`.
- Produces: `applyArchiveGroup(deps: { store: ControlStore }, command: ArchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1`,
  `applyUnarchiveGroup(...)` likewise; `WebControlService.archiveGroup(command)`, `.unarchiveGroup(command)`; the five
  durable codes.

Guard order (each refusal reachable on its own, so each test goes red when its guard is deleted): a call in flight
(estimate `running`/`start-unknown` -- the states `scheduleStart`'s `estimate-in-flight` uses -- then a clarifying group's
pending requirement call), a `handoff`/`shutdown` stop intent not `handoff-complete`, an integration `resolving`, then an
active run. The stop guard precedes the run guard because a settling handoff always has an active run.

- [ ] **Step 1: Write the failing test** — `tests/control/archiveGroup.test.ts` (this task's part; E4 and E5 append
  describes to the same file):

```ts
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupArchived } from "../../src/control/archivedMark.js";
import { lookupCommandResult, updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { insertClarifyingGroup, newRound, writeRound } from "../../src/control/requirementRecords.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { clarifyingInput } from "./fixtures/requirement.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { WebFixtureTask } from "./fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const body = (h: H, id = "g") => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const writeBody = (h: H, value: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(value));
const revisionOf = (h: H, id = "g") => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);
const dispatch = (h: H) => ({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate });
const lastSeq = (h: H) => Number(h.store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM activity").get()!.n);

/** A confirmed group "g": ready, no run, its import estimate still queued (queued is not in flight). */
async function confirmed(tasks: readonly WebFixtureTask[] = [{ taskId: "a" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}

async function claimed(h: H, service: WebControlService): Promise<string> {
  await service.start(h.command("start", {}));
  const outcome = await deliverScheduledStart(dispatch(h), "g");
  if (outcome.kind !== "claimed") throw new Error(JSON.stringify(outcome));
  return outcome.runId;
}

describe("archive-group and unarchive-group (issue-fixes spec §6.3)", () => {
  it("archives an idle group: the body says when and by whom, the summary says archived, and an archived row is written", async () => {
    const { h, service } = await confirmed();
    try {
      const before = Date.now(), seq = lastSeq(h);
      const result = service.archiveGroup(h.command("archive-group", {}));
      if ("error" in result || result.result.kind !== "archived") throw new Error(JSON.stringify(result));
      expect(result.result.groupId).toBe("g");
      expect(body(h).archived).toEqual({ at: result.result.at, actor: "human" });
      expect(result.result.at).toBeGreaterThanOrEqual(before);
      expect(result.result.at).toBeLessThanOrEqual(Date.now());
      expect(readGroupSummary(h.store, "g").archived).toBe(true);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("archived");
    } finally { await h.dispose(); }
  });

  it("unarchive removes the mark and writes an unarchived row; unarchiving a group that is not archived is a no-op refusal", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const seq = lastSeq(h);
      const result = service.unarchiveGroup(h.command("unarchive-group", {}));
      if ("error" in result || result.result.kind !== "unarchived") throw new Error(JSON.stringify(result));
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
      expect(readGroupSummary(h.store, "g").archived).toBe(false);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("unarchived");
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ error: { code: "no-op-command" } });
    } finally { await h.dispose(); }
  });

  it("archives under a pause with no active run, and under a handoff stop that is complete", async () => {
    const paused = await confirmed();
    try {
      await paused.service.pauseDispatch(paused.h.command("pause-dispatch", {}));
      expect(paused.service.archiveGroup(paused.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await paused.h.dispose(); }
    const handedOff = await confirmed();
    try {
      await handedOff.service.handoffStop(handedOff.h.command("handoff-stop", {}));
      expect(groupStopState(handedOff.h.store, "g")).toBe("handoff-complete");
      expect(handedOff.service.archiveGroup(handedOff.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await handedOff.h.dispose(); }
  });

  it("refuses while a run is active: archive-run-active", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-run-active" } });
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("refuses while a handoff stop is still settling: archive-stop-pending (ahead of the run it waits for)", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(groupStopState(h.store, "g")).not.toBe("handoff-complete");
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-stop-pending" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an agent resolves the integration: archive-integration-resolving", async () => {
    const { h, service } = await confirmed();
    try {
      const scheme = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
      writeBody(h, { ...body(h), integration: { ...newGroupIntegration(scheme)!, frozen: true, state: "resolving" } });
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-integration-resolving" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an estimate is in flight: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.db.prepare("UPDATE estimates SET state='running' WHERE group_id='g'").run();
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:estimate" } });
    } finally { await h.dispose(); }
  });

  it("refuses while a requirement call is waiting: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
        writeRound(h.store, "r", newRound(1));
      });
      const command = h.rawCommand("archive-r", revisionOf(h, "r"), "archive-group", { kind: "group", groupId: "r" }, {}) as never;
      expect(service.archiveGroup(command)).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:requirement" } });
      expect(lookupCommandResult(h.store, "r", "archive-r")!.body).toMatchObject({ error: { code: "archive-call-in-flight" } });
    } finally { await h.dispose(); }
  });

  it("blocks by name on an archive mark that does not parse", async () => {
    const { h } = await confirmed();
    try {
      writeBody(h, { ...body(h), archived: "yes" });
      expect(() => isGroupArchived(h.store, "g")).toThrow(ControlError);
      expect(() => isGroupArchived(h.store, "g")).toThrow(/group-archived-invalid/);
    } finally { await h.dispose(); }
  });
});
```

  Add to `tests/panel/permissions.test.ts`, inside "lets an owner do human-only actions…", after the `for (const p of
  [member, agent])` loop:

```ts
    // Issue-fixes spec §6.3: archiving and unarchiving are open to every principal (access `any`).
    for (const p of [owner, member, agent]) for (const verb of ["archive-group", "unarchive-group"] as const) expect(permissionRefusal(p, verb, {})).toBe(null);
```

  Add to `tests/panel/controlApi.test.ts` a new `it` inside the first `describe` (after its first `it`):

```ts
  it("archives and unarchives a group over HTTP, and the summary follows (issue-fixes spec §6.3)", async () => {
    const paths = await h.workspace();
    const panel = await h.boot("epoch-archive", paths);
    const imported = await command(panel, "/api/control/groups/import-plan", { commandId: "archive-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
    expect(imported.status).toBe(201);
    const archived = await command(panel, `/api/control/groups/${GROUP}/archive`, { commandId: "archive-1", expectedRevision: await revision(panel), payload: {} });
    expect(archived.status).toBe(200);
    expect(commandSuccessSchema.parse(archived.body)).toMatchObject({ verb: "archive-group", result: { kind: "archived", groupId: GROUP } });
    const summary = controlSummarySchema.parse(await json(await get(panel, "/api/control/summary")));
    expect(summary.groups.find((group) => group.groupId === GROUP)?.archived).toBe(true);
    const unarchived = await command(panel, `/api/control/groups/${GROUP}/unarchive`, { commandId: "unarchive-1", expectedRevision: await revision(panel), payload: {} });
    expect(commandSuccessSchema.parse(unarchived.body)).toMatchObject({ verb: "unarchive-group", result: { kind: "unarchived" } });
  });
```

  (`revision(panel, groupId = GROUP)` is the async harness helper at `tests/panel/fixtures/controlPanel.ts:239`, already
  imported by the file.)

- [ ] **Step 2: Run it, expect FAIL** —
  `./node_modules/.bin/vitest run tests/control/archiveGroup.test.ts tests/panel/permissions.test.ts tests/panel/controlApi.test.ts > <S>/e3.txt 2>&1; echo rc=$?`
  → `rc=1`: `service.archiveGroup is not a function`; the raw schema refuses verb `archive-group`; route 404.

- [ ] **Step 3: Implement.**

  (a) `src/control/errors.ts`: after `"agent-selection-changed": 409,` add

```ts
  // Issue-fixes spec §6.3: archive is refused while the group still has work in motion; each guard has its own code. The
  // detail of archive-stop-pending is `<mode>:<state>`, of archive-call-in-flight `estimate` or `requirement`.
  "archive-call-in-flight": 409,
  "archive-integration-resolving": 409,
  "archive-run-active": 409,
  "archive-stop-pending": 409,
```

  and after `"group-already-exists": 409,` add

```ts
  // Issue-fixes spec §6.3: an archived group refuses every group-targeted command but unarchive-group.
  "group-archived": 409,
```

  (b) `src/control/webProtocol.ts`: in `commandVerbSchema` after `"resolve-integration-conflict",` add
  `  "archive-group",` and `  "unarchive-group",`. In `rawAuthorityCommandVariants` after the
  `verb: z.literal("resolve-integration-conflict")` line add:

```ts
  // Issue-fixes spec §6.3: archive and unarchive, group target, empty payload.
  z.object({ ...rawCommandFields, verb: z.literal("archive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("unarchive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
```

  and the same two lines with `effectiveCommandFields` in `effectiveAuthorityCommandVariants` after its
  `resolve-integration-conflict` line. In `commandResultSchema` after
  `z.object({ kind: z.literal("integration-resolution-started"), groupId: idSchema }).strict(),` add:

```ts
  // Issue-fixes spec §6.3: `at` is the archive mark's time (ms since the epoch).
  z.object({ kind: z.literal("archived"), groupId: idSchema, at: safeInteger }).strict(),
  z.object({ kind: z.literal("unarchived"), groupId: idSchema }).strict(),
```

  (c) Create `src/control/archiveGroup.ts`:

```ts
import { recordActivity } from "./activity.js";
import { archivedMarkOf } from "./archivedMark.js";
import { applyWebCommand, type WebCommandContext } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { pendingRequirementCall } from "./requirementCalls.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Issue-fixes spec §6.3 (ruling H4): a group is archived, never deleted; it keeps every record and takes no new work. */
export type ArchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "archive-group" }>;
export type UnarchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "unarchive-group" }>;

function success(context: WebCommandContext, result: CommandSuccessV1["result"]): { status: number; body: CommandSuccessV1 } {
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  return JSON.parse(String(row.body)) as Record<string, unknown>;
}

/**
 * Spec §6.3: archive is refused while work is in motion, each case by its own code. Order matters for reachability: a
 * running estimate or a pending requirement call also has (or will have) an active run, and a settling handoff always
 * has one, so those are named before the plain active-run guard. A `pause` intent with no active run does not refuse.
 */
function refuseArchive(store: ControlStore, groupId: string, group: Record<string, unknown>): void {
  for (const row of store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(groupId)) {
    if (["running", "start-unknown"].includes(String(row.state))) throw new ControlError("archive-call-in-flight", "estimate");
  }
  if (group.status === "clarifying" && pendingRequirementCall(store, groupId) !== null) throw new ControlError("archive-call-in-flight", "requirement");
  const stop = store.db.prepare("SELECT mode,body FROM stop_intents WHERE group_id=?").get(groupId);
  if (stop !== undefined && String(stop.mode) !== "pause") {
    const state = (JSON.parse(String(stop.body)) as { state?: unknown }).state;
    if (state !== "handoff-complete") throw new ControlError("archive-stop-pending", `${String(stop.mode)}:${String(state)}`);
  }
  if (readGroupIntegration(group)?.state === "resolving") throw new ControlError("archive-integration-resolving");
  if (store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(groupId)) throw new ControlError("archive-run-active");
}

/** Spec §6.3: marks the body `archived: { at, actor }` and writes an `archived` activity row in the same transaction. */
export function applyArchiveGroup(deps: { store: ControlStore }, command: ArchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const group = groupBody(deps.store, groupId);
      refuseArchive(deps.store, groupId, group);
      const at = deps.store.now();
      group.archived = { at, actor: context.rawCommand.actorId };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      recordActivity(deps.store, { groupId, kind: "archived", body: {} });
      return success(context, { kind: "archived", groupId, at });
    },
  }).body;
}

/** Spec §6.3: removes the mark (refused no-op-command when there is none) and writes an `unarchived` activity row. */
export function applyUnarchiveGroup(deps: { store: ControlStore }, command: UnarchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const group = groupBody(deps.store, groupId);
      if (archivedMarkOf(group) === null) throw new ControlError("no-op-command");
      delete group.archived;
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      recordActivity(deps.store, { groupId, kind: "unarchived", body: {} });
      return success(context, { kind: "unarchived", groupId });
    },
  }).body;
}
```

  (d) `src/control/webService.ts`: after line 24 (`import { applyResolveIntegrationConflict, ... } from "./integrationCommands.js";`) add
  `import { applyArchiveGroup, applyUnarchiveGroup, type ArchiveGroupCommand, type UnarchiveGroupCommand } from "./archiveGroup.js";`
  and after the `retryIntegration(...) { ... }` method (ends `return this.mutate(() => applyRetryIntegration(...)) as WebCommandResult;\n  }`) add:

```ts
  /** Issue-fixes spec §6.3: archive a group (it keeps every record and takes no new work) / take it back. */
  archiveGroup(command: ArchiveGroupCommand): WebCommandResult {
    return this.mutate(() => applyArchiveGroup({ store: this.store }, command)) as WebCommandResult;
  }
  unarchiveGroup(command: UnarchiveGroupCommand): WebCommandResult {
    return this.mutate(() => applyUnarchiveGroup({ store: this.store }, command)) as WebCommandResult;
  }
```

  (e) `src/panel/controlApi.ts`: after
  `{ path: "/api/control/groups/:groupId/integration/resolve", verb: "resolve-integration-conflict", target: fromParams },` add

```ts
    // Issue-fixes spec §6.3: archive and unarchive; the ledger key is the group's.
    { path: "/api/control/groups/:groupId/archive", verb: "archive-group", target: fromParams },
    { path: "/api/control/groups/:groupId/unarchive", verb: "unarchive-group", target: fromParams },
```

  and in the switch after `case "resolve-integration-conflict": await service.resolveIntegrationConflict(command); break;` add

```ts
          case "archive-group": service.archiveGroup(command); break;
          case "unarchive-group": service.unarchiveGroup(command); break;
```

  (f) `src/panel/humanOnly.ts`: after `"resolve-integration-conflict": "human-only",` add

```ts
  // Issue-fixes spec §6.3: archiving hides and freezes a group but deletes nothing; any principal may do it and undo it.
  "archive-group": "any",
  "unarchive-group": "any",
```

  (g) `web/src/controlTypes.ts` `CommandSuccessV1`: append `| "archive-group" | "unarchive-group"` to the `verb` union
  (after `"resolve-integration-conflict"`), and after `| { kind: "integration-resolution-started"; groupId: string }` add

```ts
    | { kind: "archived"; groupId: string; at: number }
    | { kind: "unarchived"; groupId: string }
```

  (h) Locales (Part A's tables, keep alphabetical order). `enErrors`:

```ts
  "archive-call-in-flight": "A model call for this group is still running ({{detail}}). Archive it once the call has finished.",
  "archive-integration-resolving": "An agent is resolving this group's integration conflict. Archive it once that has finished.",
  "archive-run-active": "This group still has an active run. Wait for it to finish, or stop it with Handoff stop, then archive.",
  "archive-stop-pending": "A stop is still settling ({{detail}}). Archive the group once it reaches handoff-complete.",
  "group-archived": "This group is archived: it keeps every record but takes no new work. Unarchive it to change or run it.",
```

  `zhErrors`:

```ts
  "archive-call-in-flight": "这个组还有一次模型调用在进行（{{detail}}）。等调用结束后再归档。",
  "archive-integration-resolving": "agent 正在解决这个组的集成冲突。等它结束后再归档。",
  "archive-run-active": "这个组还有正在进行的运行。等它结束，或先用“交接停止”停下，再归档。",
  "archive-stop-pending": "停止还没有完成（{{detail}}）。等它到达交接完成后再归档。",
  "group-archived": "这个组已归档：记录都保留，但不再接新工作。要修改或运行它，先取消归档。",
```

- [ ] **Step 4: Run, expect PASS** — the Step 2 command → `rc=0`. Then
  `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts tests/panel/humanOnly.test.ts tests/panel/webParity.test.ts > <S>/e3-wide.txt 2>&1; echo rc=$?` → `rc=0`;
  `npm run typecheck > <S>/e3-tc.txt 2>&1; echo rc=$?` → `rc=0`. (`tests/entry/skill.test.ts` is red now -- two routes
  without rows -- and goes green in E6.)

- [ ] **Step 5: Mutation** (clone): delete, one at a time, each guard line of `refuseArchive`: the estimate loop → "an
  estimate is in flight" red; the requirement line → "a requirement call is waiting" red; the stop block → "a handoff stop
  is still settling" red (it then answers `archive-run-active`); replace `state !== "handoff-complete"` with `true` →
  "under a handoff stop that is complete" red; the integration line → its test red; the run line → "a run is active" red.
  Delete `recordActivity(... "archived" ...)` → the first test red. Delete the `no-op-command` throw → the unarchive test
  red. In `archivedMarkOf` replace the `throw` with `return null` → "blocks by name" red.

- [ ] **Step 6: Commit** —
  `git -C <wt> add src/control/errors.ts src/control/webProtocol.ts src/control/archiveGroup.ts src/control/webService.ts src/panel/controlApi.ts src/panel/humanOnly.ts web/src/controlTypes.ts web/src/locales/en.ts web/src/locales/zh.ts tests/control/archiveGroup.test.ts tests/panel/permissions.test.ts tests/panel/controlApi.test.ts`
  message `feat(control): archive and unarchive a group, refused while its work is in motion` (body `Issue-fixes spec 6.3.` + Co-Authored-By).

### Task E4: An archived group refuses every group-targeted command but unarchive-group (spec §6.3)

**Files:**
- Modify: `src/control/commandLedger.ts` — imports (lines 1-14), `applyWebCommand` (lines 308-310, anchor
  `if (rawCommand.expectedRevision !== currentCommandRevision) {` inside `applyWebCommand`, not the one in
  `preflightWebCommand`)
- Test: `tests/control/archiveGroup.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: E2 `isGroupArchived`; E3 verbs; Part D `WebControlService.retryTask`.
- Produces: the durable refusal `group-archived` for every group-scoped verb except `unarchive-group`.

- [ ] **Step 1: Write the failing test** — append to `tests/control/archiveGroup.test.ts` (add
  `import { commandVerbSchema } from "../../src/control/webProtocol.js";` to the imports):

```ts
/** The verbs whose ledger scope is not a group (no group to be archived); everything else targets a group. */
const NOT_GROUP = ["shutdown", "set-workspace-mode", "set-integration-scheme", "set-agent-preferences", "set-spend-cap", "clear-spend-cap", "set-usage-calendar"];
const LOOP_PAYLOAD = { baseLoopVersion: 0, plan: "standard", inputs: { goal: "g", successCondition: "s", targetPaths: ["a.txt"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null }, work: { tokens: 1, activeMs: 1, attempts: 1 } };
const CONFIRM_PAYLOAD = { planHash: "a".repeat(64), proposalVersion: 1, budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: "b".repeat(64), worker: "b".repeat(64), handoff: "b".repeat(64), goalReview: "b".repeat(64) }, contextPolicy: { handoffAtContextTokens: null }, selectionsHash: "c".repeat(64) };
type Call = (s: WebControlService, command: never) => unknown;
/** Every group-targeted verb but unarchive-group: how it is sent, its target kind and a payload its raw schema accepts. */
const CALLS: Record<string, { call: Call; target: "group" | "task"; payload: unknown }> = {
  "import-plan": { call: (s, c) => s.importPlan(c), target: "group", payload: { groupId: "g", repoId: "repo", planId: "plan" } },
  "proposal-edit": { call: (s, c) => s.editProposal(c), target: "group", payload: { baseProposalVersion: 1, operations: [] } },
  "proposal-set-agent": { call: (s, c) => s.proposalSetAgent(c), target: "group", payload: { baseProposalVersion: 1, scope: { kind: "group", slot: "worker" }, partial: null } },
  estimate: { call: (s, c) => s.createEstimate(c), target: "group", payload: { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" } },
  confirm: { call: (s, c) => s.confirm(c), target: "group", payload: CONFIRM_PAYLOAD },
  start: { call: (s, c) => s.start(c), target: "group", payload: {} },
  "pause-dispatch": { call: (s, c) => s.pauseDispatch(c), target: "group", payload: {} },
  "handoff-stop": { call: (s, c) => s.handoffStop(c), target: "group", payload: {} },
  "resume-dispatch": { call: (s, c) => s.resumeDispatch(c), target: "group", payload: {} },
  "resume-from-handoff": { call: (s, c) => s.resumeFromHandoff(c), target: "group", payload: { selections: [] } },
  "set-limit": { call: (s, c) => s.setLimit(c), target: "group", payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } },
  "continue-task": { call: (s, c) => s.continueTask(c), target: "task", payload: { predecessorRunId: "run-x", checkpointId: "cp-x" } },
  "recovery-retry": { call: (s, c) => s.recoveryRetry(c), target: "group", payload: { scope: "group", groupId: "g" } },
  "set-group-integration": { call: (s, c) => s.setGroupIntegration(c), target: "group", payload: { integration: { delivery: "keep" } } },
  "retry-integration": { call: (s, c) => s.retryIntegration(c), target: "group", payload: {} },
  "resolve-integration-conflict": { call: (s, c) => s.resolveIntegrationConflict(c), target: "group", payload: {} },
  "set-task-labels": { call: (s, c) => s.setTaskLabels(c), target: "task", payload: { labels: null, baseLabelsVersion: 0 } },
  "set-task-loop": { call: (s, c) => s.setTaskLoop(c), target: "task", payload: LOOP_PAYLOAD },
  "requirement-open": { call: (s, c) => s.openRequirement(c), target: "group", payload: { groupId: "g", repoId: "repo", idea: "an idea" } },
  "requirement-answer": { call: (s, c) => s.answerRequirement(c), target: "group", payload: { roundNo: 1, answers: [], glossaryDecisions: [], adrDecisions: [] } },
  "requirement-consensus": { call: (s, c) => s.requirementConsensus(c), target: "group", payload: { roundNo: 1 } },
  "requirement-draft-feedback": { call: (s, c) => s.requirementDraftFeedback(c), target: "group", payload: { draftNo: 1, feedback: "more" } },
  "requirement-draft-accept": { call: (s, c) => s.acceptRequirementDraft(c), target: "group", payload: { draftNo: 1, draftHash: "a".repeat(64) } },
  "retry-task": { call: (s, c) => (s as unknown as { retryTask(command: never): unknown }).retryTask(c), target: "group", payload: { taskId: "a" } },
  "archive-group": { call: (s, c) => s.archiveGroup(c), target: "group", payload: {} },
};

describe("an archived group refuses every group-targeted command but unarchive-group (spec §6.3)", () => {
  it("covers every group-targeted verb the protocol knows, so a new verb cannot slip past", () => {
    const expected = commandVerbSchema.options.filter((verb) => !NOT_GROUP.includes(verb) && verb !== "unarchive-group").sort();
    expect(Object.keys(CALLS).sort()).toEqual(expected);
  });

  it.each(Object.keys(CALLS))("refuses %s with group-archived, durably, and changes nothing", async (verb) => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const before = JSON.stringify(body(h));
      const entry = CALLS[verb]!;
      const target = entry.target === "task" ? { kind: "task", groupId: "g", taskId: "a" } : { kind: "group", groupId: "g" };
      const command = h.rawCommand(`c-${verb}`, revisionOf(h), verb as never, target as never, entry.payload) as never;
      expect(await entry.call(service, command)).toMatchObject({ error: { code: "group-archived" } });
      expect(lookupCommandResult(h.store, "g", `c-${verb}`)!.body).toMatchObject({ error: { code: "group-archived" } });
      expect(JSON.stringify(body(h))).toBe(before);
    } finally { await h.dispose(); }
  });

  it("still takes unarchive-group, and after it start is accepted again", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived" } });
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/archiveGroup.test.ts > <S>/e4.txt 2>&1; echo rc=$?`
  → `rc=1`: e.g. "refuses start" gets `{ result: { kind: "scheduled" } }`; "refuses archive-group" gets
  `archive-run-active`/success instead of `group-archived`.

- [ ] **Step 3: Implement** — `src/control/commandLedger.ts`: add `import { isGroupArchived } from "./archivedMark.js";`
  after line 3. In `applyWebCommand`, replace

```ts
    if (rawCommand.expectedRevision !== currentCommandRevision) {
      unvalidated = revisionConflict(currentCommandRevision);
    } else {
```

  with

```ts
    if (rawCommand.expectedRevision !== currentCommandRevision) {
      unvalidated = revisionConflict(currentCommandRevision);
    } else if (commandScope.groupId !== null && rawCommand.verb !== "unarchive-group" && isGroupArchived(store, commandScope.groupId)) {
      // Issue-fixes spec §6.3: an archived group refuses every group-targeted command but unarchive-group. Every group
      // command books its outcome here (persistCommandOutcome's only other caller books revision conflicts), so this one
      // gate, ahead of expand and apply, covers every verb -- retry-task included -- and any verb added later.
      unvalidated = domainErrorOutcome(new ControlError("group-archived"), resultCommandRevision)!;
    } else {
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0` (27 refusal cases plus the two others). Then
  `./node_modules/.bin/vitest run tests/control/commandLedger.test.ts tests/control/requirementGuards.test.ts tests/control/webMutations.test.ts > <S>/e4-wide.txt 2>&1; echo rc=$?` → `rc=0`.

- [ ] **Step 5: Mutation** (clone): delete the `else if (...) { ... }` branch → every `refuses <verb>` case except
  `archive-group`'s goes red (that one answers a guard code or success, also red). Change `rawCommand.verb !==
  "unarchive-group"` to `true` → "still takes unarchive-group" red.

- [ ] **Step 6: Commit** — `git -C <wt> add src/control/commandLedger.ts tests/control/archiveGroup.test.ts`, message
  `feat(control): refuse every command but unarchive-group on an archived group at the ledger gate` (+ Co-Authored-By).

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

### Task E6: The agent skill teaches archive (spec §6.3)

**Files:**
- Modify: `skills/orca-control/SKILL.md` — route table (after line 104, the `integration/resolve` row) and the Notes
  paragraph (line 113)
- Modify: `tests/entry/skill.test.ts` — imports unchanged; `schemaByVerb` (lines 18-28), the three count literals
  (lines 46, 51, 61), the phrase list (lines 73-89)

- [ ] **Step 1: Write the failing test** — in `tests/entry/skill.test.ts`: add
  `"archive-group": emptyPayloadSchema, "unarchive-group": emptyPayloadSchema,` to `schemaByVerb` after
  `"resolve-integration-conflict": emptyPayloadSchema,`; change the three route counts from the value Part D left (30) to
  `32` and extend the comment above the first with `Issue-fixes spec §6.3 added groups/<groupId>/archive and
  groups/<groupId>/unarchive.`; add to the phrase list:

```ts
      // Issue-fixes spec §6.3: what archiving does to every other command, and the guards an agent meets.
      "refuses every command but `unarchive-group` with `group-archived`", "archive-run-active", "archive-call-in-flight",
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/entry/skill.test.ts > <S>/e6.txt 2>&1; echo rc=$?` → `rc=1` (32 routes in `controlApi.ts`, 30 rows; missing phrases).

- [ ] **Step 3: Implement** — `skills/orca-control/SKILL.md`, after the `| \`POST groups/<groupId>/integration/resolve\` | resolve-integration-conflict | \`{}\` |` row:

```markdown
| `POST groups/<groupId>/archive` | archive-group | `{}` |
| `POST groups/<groupId>/unarchive` | unarchive-group | `{}` |
```

  and append to the Notes paragraph (line 113, after its last sentence):

```markdown
An archived group keeps every record and refuses every command but `unarchive-group` with `group-archived` (409); reads are unchanged and it is never claimed or integrated. `archive-group` is refused while the group still has work in motion: `archive-run-active`, `archive-stop-pending` (a handoff or shutdown stop not yet `handoff-complete`), `archive-integration-resolving`, `archive-call-in-flight` (an estimate or requirement call).
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`.
- [ ] **Step 5: Mutation** (clone): delete the archive row → "lists exactly the panel's mutation routes" red; delete the
  Notes sentence → "teaches the rules" red.
- [ ] **Step 6: Commit** — `git -C <wt> add skills/orca-control/SKILL.md tests/entry/skill.test.ts`, message
  `docs(skill): teach the agent archive-group and unarchive-group` (+ Co-Authored-By).

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

### Task E8: The group list as cards with filter chips (spec §6.4)

**Files:**
- Create: `web/src/GroupList.tsx`, `web/src/clock.ts`
- Modify: `web/src/ControlPanel.tsx` — imports (lines 11-30), props (add `now?`), the `<nav aria-label={t("control.groupsNav")}>…</nav>`
  block (lines 250-267) replaced by `<GroupList …/>`; the now-unused `listed`/`label` locals (lines 213-215) move into GroupList
- Modify: `web/src/styles.css` — after line 196 (`nav[aria-label="Control groups"] button[aria-current="true"] {…}`)
- Modify: `web/src/locales/en.ts` (after `groupBlockers`, line 211), `web/src/locales/zh.ts` (after line 118)
- Test: `web/tests/groupList.test.tsx` (new), `web/tests/styles.test.ts` (one `it`)

**Interfaces:**
- Consumes: E7; `GroupScope`, `inScope` (`web/src/projectScope.ts`); `hashFor` (`web/src/sections.ts`).
- Produces: `GroupList(props: { groups: GroupSummaryV1[]; selected: string | null; scope?: GroupScope; repoLabel?: (repoId: string) => string; onSelect: (groupId: string) => void; now?: number })`;
  `useClock(periodMs: number): number`; `ControlPanelProps.now?: number`.

- [ ] **Step 1: Write the failing test** — `web/tests/groupList.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Issue-fixes spec §6.4: each group is one card (the whole card is the button), the list hides archived groups unless the
 * Archived chip is chosen, and the chosen chip is remembered per viewer when storage works.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROUP_FILTER_KEY } from "../src/groupCategory.js";
import { GroupList } from "../src/GroupList.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 1 }, counts: { ...zero, idle: 1 }, archived: false, ...over,
});
const GROUPS = [
  g("n1"), g("r1", { state: "running", counts: { ...zero, running: 1 } }), g("a1", { counts: { ...zero, blocked: 1 } }),
  g("d1", { completion: { done: 1, total: 1 }, counts: { ...zero, done: 1 } }), g("x1", { archived: true }),
];
const nav = () => screen.getByRole("navigation", { name: "Control groups" });
const ids = () => [...nav().querySelectorAll(":scope > button")].map((card) => (card.textContent ?? "").split(" · ")[0]);
const chip = (name: string) => within(screen.getByRole("group", { name: "Show groups" })).getByRole("button", { name });

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("the group list (spec §6.4)", () => {
  it("hides an archived group unless the Archived chip is chosen", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
    fireEvent.click(chip("Archived"));
    expect(ids()).toEqual(["x1"]);
    fireEvent.click(chip("All"));
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
  });

  it("files each group under its own chip", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    for (const [name, id] of [["Not started", "n1"], ["Running", "r1"], ["Needs attention", "a1"], ["Done", "d1"]] as const) {
      fireEvent.click(chip(name));
      expect(ids(), name).toEqual([id]);
      expect(chip(name).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("remembers the chosen chip in this browser, and still filters when storage throws", () => {
    const first = render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    fireEvent.click(chip("Done"));
    expect(window.localStorage.getItem(GROUP_FILTER_KEY)).toBe("done");
    first.unmount();
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["d1"]);
    cleanup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
    fireEvent.click(chip("Running"));
    expect(ids()).toEqual(["r1"]);
  });

  it("draws one card per group: id and state as its name, goal, progress, status chip, attention badge, branch and when it changed", () => {
    const onSelect = vi.fn();
    render(<GroupList groups={[g("g", { goal: "Ship the export", completion: { done: 1, total: 3 }, counts: { ...zero, blocked: 1, done: 1, idle: 1 }, branch: "orca/g", updatedAt: NOW - 5 * 60_000 })]}
      selected={null} onSelect={onSelect} now={NOW} />);
    const card = screen.getByRole("button", { name: "g · ready · 1/3 done" });
    expect(card.textContent).toContain("Ship the export");
    expect(card.querySelector("progress")?.getAttribute("value")).toBe("1");
    expect(card.querySelector("progress")?.getAttribute("max")).toBe("3");
    expect(card.querySelector(".group-chip")?.textContent).toBe("Needs attention");
    expect(card.querySelector(".group-badge")?.textContent).toBe("needs you");
    expect(card.textContent).toContain("orca/g");
    expect(card.textContent).toContain("updated 5 min ago");
    fireEvent.click(within(card).getByText("Ship the export"));
    expect(onSelect).toHaveBeenCalledWith("g");
  });

  it("says when no group matches the chosen chip", () => {
    render(<GroupList groups={[g("n1")]} selected={null} onSelect={vi.fn()} now={NOW} />);
    fireEvent.click(chip("Done"));
    expect(within(nav()).getByText("No group matches this filter.")).toBeTruthy();
  });
});
```

  Append to `web/tests/styles.test.ts`, inside its `describe`:

```ts
  // Issue-fixes spec §6.4: the whole card is the button, with a border, a hover and a focus style of its own.
  it("gives a group card a border, a hover and a visible focus", () => {
    expect(rule(".group-card")).toContain("border: 1px solid var(--border)");
    expect(rule(".group-card:hover")).toContain("background: var(--bg-hover)");
    expect(rule(".group-card:focus-visible")).toContain("outline: 2px solid var(--accent)");
  });
```

- [ ] **Step 2: Run it, expect FAIL** — `cd <wt>/web && ../node_modules/.bin/vitest run tests/groupList.test.tsx tests/styles.test.ts > <S>/e8.txt 2>&1; echo rc=$?` → `rc=1` (module missing; no `.group-card` rule).

- [ ] **Step 3: Implement.**

  `web/src/clock.ts`:

```ts
import { useEffect, useState } from "react";

/** The wall clock, re-read every `periodMs`, so "N minutes ago" and "no progress for N min" move while nothing else does. */
export function useClock(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return now;
}
```

  `web/src/GroupList.tsx`:

```tsx
/**
 * Issue-fixes spec §6.4: the Task control group list. Each group is one card and the whole card is the button; its
 * accessible name is the row text the list always had (id, state, done/total, stop, blockers and, in All projects, the
 * repository), and the rest of the card describes it. The chips filter by groupCategory; the choice is kept per viewer.
 */
import { useId, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useClock } from "./clock.js";
import type { GroupSummaryV1 } from "./controlTypes.js";
import {
  GROUP_FILTERS, groupCategory, groupFilterStorage, matchesGroupFilter, needsAttention, readGroupFilter, writeGroupFilter, type GroupFilter,
} from "./groupCategory.js";
import { enumText } from "./i18n.js";
import { inScope, type GroupScope } from "./projectScope.js";
import { hashFor } from "./sections.js";

export interface GroupListProps {
  groups: GroupSummaryV1[];
  selected: string | null;
  scope?: GroupScope;
  repoLabel?: (repoId: string) => string;
  onSelect: (groupId: string) => void;
  /** Tests pin the clock; the page reads it every 30 s. */
  now?: number;
}

function GroupCard(props: { group: GroupSummaryV1; selected: boolean; repoText: string; now: number; onSelect: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { group } = props;
  const base = useId();
  const category = groupCategory(group);
  const updated = group.updatedAt === undefined || group.updatedAt === null ? null : Math.max(0, Math.floor((props.now - group.updatedAt) / 60_000));
  return (
    <button
      type="button"
      className="group-card"
      data-category={category}
      aria-current={props.selected}
      aria-labelledby={props.repoText === "" ? `${base}-name` : `${base}-name ${base}-repo`}
      aria-describedby={`${base}-detail`}
      onClick={props.onSelect}
    >
      <span id={`${base}-name`} className="group-card-name">
        {group.groupId} · {enumText("groupState", group.state)}
        {group.completion !== undefined ? t("control.groupDone", { done: group.completion.done, total: group.completion.total }) : ""}
        {group.stopState !== null ? ` · ${enumText("stopState", group.stopState)}` : ""}
        {group.recoveryBlockerCount > 0 ? t("control.groupBlockers", { n: group.recoveryBlockerCount }) : ""}
      </span>
      <span id={`${base}-detail`} className="group-card-detail">
        {group.goal !== undefined && <span className="group-card-goal">{group.goal}</span>}
        {group.completion !== undefined && group.completion.total > 0 && (
          <progress value={group.completion.done} max={group.completion.total}
            aria-label={t("control.groupCard.progress", { done: group.completion.done, total: group.completion.total })} />
        )}
        <span className="group-chip" data-category={category}>{t(`control.groupCategory.${category}` as const)}</span>
        {needsAttention(group) && <span className="group-badge">{t("control.groupCard.attention")}</span>}
        {group.branch !== undefined && <code>{group.branch}</code>}
        {updated !== null && <span>{updated === 0 ? t("control.groupCard.updatedNow") : t("control.groupCard.updated", { minutes: updated })}</span>}
      </span>
      {props.repoText !== "" && <span id={`${base}-repo`}>{props.repoText}</span>}
    </button>
  );
}

export function GroupList(props: GroupListProps): JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<GroupFilter>(() => readGroupFilter(groupFilterStorage()));
  const ticking = useClock(30_000);
  const now = props.now ?? ticking;
  const scope = props.scope;
  const listed = scope === undefined ? props.groups : props.groups.filter((group) => inScope(scope, group.repoId));
  const shown = listed.filter((group) => matchesGroupFilter(group, filter));
  // In All projects a row names its repository, after today's text (project filtering spec §5).
  const label = (repoId: string): string => (scope?.kind === "all" ? ` · ${props.repoLabel?.(repoId) ?? repoId}` : "");
  const choose = (next: GroupFilter): void => { setFilter(next); writeGroupFilter(groupFilterStorage(), next); };
  return (
    <>
      <div role="group" aria-label={t("control.groupFilter.region")} className="group-filter">
        {GROUP_FILTERS.map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => choose(option)}>
            {option === "all" ? t("control.groupFilter.all") : t(`control.groupCategory.${option}` as const)}
          </button>
        ))}
      </div>
      <nav aria-label={t("control.groupsNav")} className="group-list">
        {scope?.kind === "unresolved" ? (
          // Plan decision P1: with no project list a row could belong to any project, so none is shown.
          <p role="note">{t("project.listUnavailable")}</p>
        ) : listed.length === 0 ? <p>{t("control.noGroups")}</p> : shown.length === 0 && <p>{t("control.groupFilter.empty")}</p>}
        {shown.map((group) => group.state === "clarifying" ? (
          // N1 spec §11.2: a clarifying group has no group view (DR25); it is operated in Requirements until accept.
          <a key={group.groupId} className="group-card" href={hashFor("requirements")}>{group.groupId} · {enumText("groupState", group.state)} · {t("control.requirementBadge")}{label(group.repoId)}</a>
        ) : (
          <GroupCard key={group.groupId} group={group} selected={group.groupId === props.selected} repoText={label(group.repoId)} now={now} onSelect={() => props.onSelect(group.groupId)} />
        ))}
      </nav>
    </>
  );
}
```

  `web/src/ControlPanel.tsx`: add `import { GroupList } from "./GroupList.js";`; drop the now-unused imports
  (`hashFor`, `inScope`, and `enumText` only if nothing else uses it -- `ImportForm` still uses `enumText`); add to
  `ControlPanelProps`

```ts
  /** Issue-fixes spec §6.4: the clock "updated N minutes ago" is read against; the list reads it itself when absent. */
  now?: number;
```

  delete the `listed` and `label` locals (lines 213-215 -- `ownerLabel` stays), and replace the whole
  `<nav aria-label={t("control.groupsNav")}> … </nav>` element (lines 250-267) with

```tsx
      <GroupList groups={summary.groups} selected={selected} scope={scope} repoLabel={props.repoLabel} onSelect={props.onSelect} now={props.now} />
```

  `web/src/styles.css`, after the `nav[aria-label="Control groups"] button[aria-current="true"]` line (kept as is):

```css
/* Issue-fixes spec §6.4: the group list as cards; the whole card is the button. */
.group-filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.group-filter button[aria-pressed="true"] { background: var(--accent-subtle); border-color: var(--accent); color: var(--text-strong); }
.group-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 8px 0 16px; }
.group-list > p { grid-column: 1 / -1; }
.group-card {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px; text-align: left; text-decoration: none;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); color: var(--text); cursor: pointer;
}
.group-card:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.group-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.group-card[aria-current="true"] { background: var(--accent-subtle); border-color: var(--accent); }
.group-card-name { color: var(--text-strong); font-weight: 600; overflow-wrap: anywhere; }
.group-card-detail { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: var(--text-xs); color: var(--muted); }
.group-card-goal { flex-basis: 100%; color: var(--text); font-size: var(--text-sm); overflow-wrap: anywhere; }
.group-card progress { flex-basis: 100%; height: 6px; accent-color: var(--ok); }
.group-chip { padding: 0 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-strong); }
.group-chip[data-category="attention"] { background: var(--danger-subtle); color: var(--danger); }
.group-chip[data-category="running"] { background: var(--ok-subtle); color: var(--ok); }
.group-chip[data-category="done"] { background: var(--info-subtle); color: var(--info); }
.group-badge { padding: 0 6px; border-radius: 999px; background: var(--danger); color: var(--on-accent); font-weight: 600; }
```

  `web/src/locales/en.ts`, after `groupBlockers: " · {{n}} blocker(s)",`:

```ts
    groupCategory: { "not-started": "Not started", running: "Running", attention: "Needs attention", done: "Done", archived: "Archived" },
    groupFilter: { region: "Show groups", all: "All", empty: "No group matches this filter." },
    groupCard: {
      progress: "{{done}} of {{total}} tasks done",
      attention: "needs you",
      updated: "updated {{minutes}} min ago",
      updatedNow: "updated just now",
    },
```

  `web/src/locales/zh.ts`, after `groupBlockers: " · {{n}} 个阻塞项",`:

```ts
    groupCategory: { "not-started": "未开始", running: "进行中", attention: "需要处理", done: "已完成", archived: "已归档" },
    groupFilter: { region: "筛选组", all: "全部", empty: "没有符合这个筛选的组。" },
    groupCard: {
      progress: "已完成 {{done}}/{{total}} 个任务",
      attention: "需要你处理",
      updated: "{{minutes}} 分钟前更新",
      updatedNow: "刚刚更新",
    },
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`. Then the whole web suite (cards replace the rows every
  list test reads): `npm run check --workspace web > <S>/e8-web.txt 2>&1; echo rc=$?` → `rc=0`, and
  `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > <S>/e8-scan.txt 2>&1; echo rc=$?` → `rc=0`. If a
  list test outside the rewritten list goes red, stop and report it (the card is designed to keep their text and names).

- [ ] **Step 5: Mutation** (clone, `npm run build --workspace web` first): replace
  `listed.filter((group) => matchesGroupFilter(group, filter))` with `listed` → "hides an archived group" red; delete the
  `writeGroupFilter(...)` call in `choose` → "remembers the chosen chip" red; delete the badge line → the card test red;
  delete the `.group-card:focus-visible` rule → the styles test red.

- [ ] **Step 6: Commit** — `git -C <wt> add web/src/GroupList.tsx web/src/clock.ts web/src/ControlPanel.tsx web/src/styles.css web/src/locales/en.ts web/src/locales/zh.ts web/tests/groupList.test.tsx web/tests/styles.test.ts`,
  message `feat(web): list control groups as cards with category filters` (+ Co-Authored-By).

### Task E9: The work-items graph: always drawn, filled by category, with live node text (spec §6.5)

**Files:**
- Modify: `web/src/DependencyGraph.tsx` (whole file, lines 1-76)
- Modify: `web/src/ControlGroupView.tsx` — the `<DependencyGraph … />` line (146) gets `runs` and `now`; props gain `now?`
- Modify: `web/src/styles.css` — the three token blocks (lines 5-40, 41-48, 50-60) and the graph rules (lines 239-252)
- Modify: `web/src/locales/en.ts` `control.graph` (lines 373-381), `web/src/locales/zh.ts` `control.graph` (lines 279-287)
- Test: `web/tests/dependencyGraph.test.tsx` (two rewrites, new cases), `web/tests/styles.test.ts`, `web/tests/contrast.test.ts`

**Interfaces:**
- Consumes: `WorkItemViewV1.category` (E2), `WEB_WORK_ITEM_CATEGORIES`; Part B `RunViewV1.startedAt`, `.lastActivityAt`; `useClock`.
- Produces: `DependencyGraph(props: { items: WorkItemViewV1[]; runs: readonly RunViewV1[]; openTask: string | null; onOpen: (taskId: string) => void; now?: number })`;
  `export function runNumber(item, runs): number`; `export function nodeLines(item, runs, now): { progress: string | null; run: string | null; stalled: string | null }`;
  CSS tokens `--cat-idle|running|waiting|blocked|done` in all three theme blocks.

- [ ] **Step 1: Write the failing tests.** In `web/tests/dependencyGraph.test.tsx`:
  - rewrite "draws one button per task…" input to
    `render2([workItem({ taskId: "a", status: "completed", category: "done" }), workItem({ taskId: "b", status: "blocked", category: "blocked", dependencyTaskIds: ["a"] })]);`
    (assertions unchanged);
  - replace the test "draws nothing for a group without dependencies, where the table already says all there is" with:

```tsx
  it("draws every task even when no task depends on another (issue-fixes spec §6.5)", () => {
    render2([workItem({ taskId: "a" }), workItem({ taskId: "b" })]);
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    expect(within(graph).getAllByRole("button").map((node) => node.getAttribute("aria-label"))).toEqual(["a · active", "b · active"]);
    expect(graph.querySelectorAll("path[data-edge]")).toHaveLength(0);
  });
```

  and append (imports: add `run` to the `./fixtures/board.js` import, and `import { nodeLines, runNumber } from "../src/DependencyGraph.js";`):

```tsx
describe("category fill, legend and live node text (issue-fixes spec §6.5)", () => {
  const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
  const minutes = (n: number) => NOW - n * 60_000;
  const progress = { runId: "run-a", step: "execute" as const, attempt: { current: 2, max: 3 }, tokens: null, lastTransitionAt: null };
  const runningItem = workItem({ taskId: "a", category: "running", currentRunId: "run-a", lineageRunIds: ["run-0", "run-a"], progress });
  const runs = (lastActivityAt: number) => [run({ runId: "run-0", state: "settled-restartable" }), run({ runId: "run-a", startedAt: minutes(12), lastActivityAt })];

  it("classes each node by the server's category and draws a legend of all five", () => {
    render(<ControlGroupView view={view([workItem({ taskId: "i", category: "idle" }), workItem({ taskId: "w", category: "waiting" }), workItem({ taskId: "r", category: "running" }),
      workItem({ taskId: "b", category: "blocked" }), workItem({ taskId: "d", category: "done" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    for (const [taskId, category] of [["i", "idle"], ["w", "waiting"], ["r", "running"], ["b", "blocked"], ["d", "done"]] as const) {
      expect(screen.getByRole("button", { name: `${taskId} · active` }).getAttribute("class")).toBe(`dep-node dep-${category}`);
    }
    expect(within(screen.getByRole("list", { name: "Legend" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["idle", "running", "waiting", "blocked", "done"]);
  });

  it("shows a running task's step and attempt, its run number past 1 and the time since its run started", () => {
    expect(nodeLines(runningItem, runs(minutes(2)), NOW)).toEqual({ progress: "execute · attempt 2", run: "run 2 · 12 min", stalled: null });
    expect(runNumber(runningItem, [run({ runId: "run-0", state: "failed-before-provider" }), run({ runId: "run-a" })])).toBe(1);
    expect(nodeLines(workItem({ taskId: "z", category: "idle" }), runs(minutes(2)), NOW)).toEqual({ progress: null, run: null, stalled: null });
  });

  it("says 'no progress for N min' only once the current run has been quiet for more than 10 minutes", () => {
    expect(nodeLines(runningItem, runs(minutes(10)), NOW).stalled).toBeNull();
    expect(nodeLines(runningItem, runs(minutes(11)), NOW).stalled).toBe("no progress for 11 min");
    render(<ControlGroupView view={view([runningItem], runs(minutes(11)))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    const node = screen.getByRole("button", { name: "a · active" });
    expect(node.querySelector("text.dep-stall")?.textContent).toBe("no progress for 11 min");
  });

  it("opens the task detail from a node, the same task the table opens", () => {
    render(<ControlGroupView view={view([runningItem], runs(minutes(2)))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "a · active" }));
    expect(screen.getByRole("region", { name: "Task a" })).toBeTruthy();
  });
});
```

  (`run({...startedAt, lastActivityAt})` relies on Part B's optional `RunViewV1` fields.)

  Append to `web/tests/styles.test.ts` inside its `describe`:

```ts
  // Issue-fixes spec §6.5, plan Review Focus 5: every category colour exists in the dark theme and in both light blocks.
  it("defines every work-item category colour for the dark theme and both light-theme blocks, and fills each node with its own", () => {
    const blockOf = (opener: string): string => {
      const at = css.indexOf(opener);
      if (at === -1) throw new Error(`no block ${opener}`);
      return css.slice(at, css.indexOf("}", at));
    };
    const blocks = [":root {", ':root[data-theme="light"] {', ':root:not([data-theme="dark"]) {'].map(blockOf);
    for (const category of ["idle", "running", "waiting", "blocked", "done"]) {
      for (const block of blocks) expect(block, category).toMatch(new RegExp(`--cat-${category}:\\s*[^;]+;`));
      expect(rule(`.dep-${category} rect`)).toContain(`fill: var(--cat-${category})`);
    }
  });

  it("pulses a running node slowly, and not at all under prefers-reduced-motion", () => {
    expect(rule(".dep-node.dep-running rect")).toContain("animation: dep-pulse");
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const media = css.slice(at, css.indexOf("}", at));
    expect(media).toContain(".dep-node.dep-running rect { animation: none;");
  });
```

  Append to `web/tests/contrast.test.ts` inside its `describe` (after the last `it`):

```ts
  // Issue-fixes spec §6.5: a node's words stay readable on its category fill (painted over the card it sits on).
  it("keeps node text readable on every work-item category fill", () => {
    for (const category of ["idle", "running", "waiting", "blocked", "done"]) {
      const fill = paint(token(`cat-${category}`), card);
      expect(ratio(hex(token("text")), fill), category).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(token("text-strong")), fill), category).toBeGreaterThanOrEqual(4.5);
    }
  });
```

- [ ] **Step 2: Run, expect FAIL** —
  `cd <wt>/web && ../node_modules/.bin/vitest run tests/dependencyGraph.test.tsx tests/styles.test.ts tests/contrast.test.ts > <S>/e9.txt 2>&1; echo rc=$?`
  → `rc=1` (no figure for zero edges; class `dep-node dep-active`; `nodeLines` not exported; no tokens).

- [ ] **Step 3: Implement.** Replace `web/src/DependencyGraph.tsx` with:

```tsx
/**
 * Board spec 2026-10-03 B1, D1, D2: the group's tasks drawn by dependency, left to right. Layout is `layoutDependencies`
 * (code, not taste); a node is a button that opens the same task detail as the table. Every task is drawn whatever the
 * table's label filter, and the status word is in the node's text so color never carries it alone.
 * Issue-fixes spec §6.5: drawn whenever the group has work items, edges or not; each node is filled by the server's
 * §6.1 category (with a legend), and a running node says its step and attempt, its run number past 1, how long its run has
 * run, and -- after 10 quiet minutes -- how long it has made no progress.
 */
import type { JSX, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useClock } from "./clock.js";
import { WEB_WORK_ITEM_CATEGORIES } from "./controlTypes.js";
import type { RunViewV1, WorkItemViewV1 } from "./controlTypes.js";
import { layoutDependencies } from "./dependencyLayout.js";
import i18n, { enumText } from "./i18n.js";

const NODE_W = 180, NODE_H = 88, GAP_X = 56, GAP_Y = 16, PAD = 8;
/** Spec §6.5: a current run quiet for longer than this is shown as making no progress. */
const STALL_MS = 10 * 60_000;

// Single-word literals joined, so the panel text scan (scripts/scan-panel-text.mjs) does not read a class list as words.
function nodeClass(category: WorkItemViewV1["category"]): string {
  return (category === undefined ? ["dep-node"] : ["dep-node", `dep-${category}`]).join(" ");
}

/** Issue-fixes spec §4.2: the task's runs that reached the provider (its lineage, less failed-before-provider). */
export function runNumber(item: WorkItemViewV1, runs: readonly RunViewV1[]): number {
  return runs.filter((run) => item.lineageRunIds.includes(run.runId) && run.state !== "failed-before-provider").length;
}

/** Spec §6.5: the lines under a running node's status word; null lines are not drawn. */
export function nodeLines(item: WorkItemViewV1, runs: readonly RunViewV1[], now: number): { progress: string | null; run: string | null; stalled: string | null } {
  if (item.category !== "running") return { progress: null, run: null, stalled: null };
  const step = item.progress?.step ?? null;
  const attempt = item.progress?.attempt?.current ?? null;
  const progress = step === null ? null : attempt === null
    ? enumText("progressStep", step)
    : i18n.t("control.graph.stepAttempt", { step: enumText("progressStep", step), attempt });
  const current = runs.find((run) => run.runId === item.currentRunId);
  const n = runNumber(item, runs);
  const parts = [
    ...(n > 1 ? [i18n.t("control.graph.runNumber", { n })] : []),
    ...(current?.startedAt != null ? [i18n.t("control.graph.elapsed", { minutes: Math.floor((now - current.startedAt) / 60_000) })] : []),
  ];
  const quiet = current?.lastActivityAt != null ? now - current.lastActivityAt : null;
  return {
    progress,
    run: parts.length === 0 ? null : parts.join(" · "),
    stalled: quiet !== null && quiet > STALL_MS ? i18n.t("control.graph.stalled", { minutes: Math.floor(quiet / 60_000) }) : null,
  };
}

export function DependencyGraph(props: { items: WorkItemViewV1[]; runs: readonly RunViewV1[]; openTask: string | null; onOpen: (taskId: string) => void; now?: number }): JSX.Element | null {
  const { t } = useTranslation();
  const ticking = useClock(30_000);
  const now = props.now ?? ticking;
  if (props.items.length === 0) return null;
  const layout = layoutDependencies(props.items);
  const byId = new Map(props.items.map((item) => [item.taskId, item]));
  const place = new Map(layout.nodes.map((node) => [node.taskId, { x: PAD + node.layer * (NODE_W + GAP_X), y: PAD + node.index * (NODE_H + GAP_Y) }]));
  const rows = Math.max(...layout.nodes.map((node) => node.index + 1));
  const width = PAD * 2 + layout.layers * NODE_W + (layout.layers - 1) * GAP_X;
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y;
  const key = (taskId: string) => (event: KeyboardEvent<SVGGElement>): void => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onOpen(taskId); }
  };
  return (
    <figure className="dep-graph" aria-label={t("control.graph.region")}>
      <figcaption>{t("control.graph.caption")}</figcaption>
      <ul className="dep-legend" aria-label={t("control.graph.legend")}>
        {WEB_WORK_ITEM_CATEGORIES.map((category) => (
          <li key={category}><span className={["dep-swatch", `dep-${category}`].join(" ")} aria-hidden="true" />{t(`control.graph.category.${category}` as const)}</li>
        ))}
      </ul>
      <div className="dep-scroll">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <marker id="dep-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="dep-arrow" />
            </marker>
          </defs>
          {layout.edges.map((edge) => {
            const from = place.get(edge.from)!, to = place.get(edge.to)!;
            const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2, x2 = to.x, y2 = to.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return <path key={`${edge.from}->${edge.to}`} data-edge={`${edge.from}->${edge.to}`} className="dep-edge" d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} markerEnd="url(#dep-arrow)" />;
          })}
          {layout.nodes.map((node) => {
            const at = place.get(node.taskId)!;
            const item = byId.get(node.taskId)!;
            const word = enumText("workStatus", item.status);
            const lines = nodeLines(item, props.runs, now);
            return (
              <g
                key={node.taskId}
                role="button"
                tabIndex={0}
                aria-label={t("control.graph.node", { taskId: node.taskId, status: word })}
                aria-current={props.openTask === node.taskId ? "true" : undefined}
                className={nodeClass(item.category)}
                transform={`translate(${at.x},${at.y})`}
                onClick={() => props.onOpen(node.taskId)}
                onKeyDown={key(node.taskId)}
              >
                <rect width={NODE_W} height={NODE_H} rx={6} />
                <text x={8} y={16}>{node.taskId}</text>
                <text x={8} y={32} className="dep-status">{word}</text>
                {lines.progress !== null && <text x={8} y={48} className="dep-detail">{lines.progress}</text>}
                {lines.run !== null && <text x={8} y={64} className="dep-detail">{lines.run}</text>}
                {lines.stalled !== null && <text x={8} y={80} className="dep-stall">{lines.stalled}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {layout.missing > 0 && <p role="note">{t("control.graph.missing", { count: layout.missing })}</p>}
      {layout.cycleEdges > 0 && <p role="alert">{t("control.graph.cycle", { count: layout.cycleEdges })}</p>}
    </figure>
  );
}
```

  `web/src/ControlGroupView.tsx`: add to `ControlGroupViewProps`
  `  /** Issue-fixes spec §6.5: the clock the graph's elapsed and no-progress text is read against; the graph reads it itself when absent. */\n  now?: number;`
  and change the graph line to
  `<DependencyGraph items={view.workItems} runs={view.runs} now={props.now} openTask={openTask} onOpen={(taskId) => setOpenTask(openTask === taskId ? null : taskId)} />`.

  `web/src/styles.css`: in `:root {` after `--kind-3: #facc15;` add

```css
  /* Issue-fixes spec §6.5: work-item category fills (over --card); web/tests/contrast.test.ts pins text on each. */
  --cat-idle: rgba(168, 168, 179, 0.18);
  --cat-running: rgba(34, 197, 94, 0.28);
  --cat-waiting: rgba(245, 158, 11, 0.28);
  --cat-blocked: rgba(248, 113, 113, 0.30);
  --cat-done: rgba(96, 165, 250, 0.28);
```

  in `:root[data-theme="light"] {` and in the `:root:not([data-theme="dark"]) {` block, after their
  `--kind-1: …; --on-accent: #ffffff;` line, add

```css
    --cat-idle: rgba(110, 105, 96, 0.12); --cat-running: rgba(21, 128, 61, 0.16); --cat-waiting: rgba(180, 83, 9, 0.16);
    --cat-blocked: rgba(185, 28, 28, 0.16); --cat-done: rgba(37, 99, 235, 0.14);
```

  and replace the graph lines from `.dep-node text.dep-status { … }` through `.dep-node[aria-current="true"] rect { … }`
  (lines 244-248) with

```css
.dep-node text.dep-status, .dep-node text.dep-detail { fill: var(--text); font-family: var(--font); font-size: var(--text-xs); }
.dep-node text.dep-stall { fill: var(--warn); font-family: var(--font); font-size: var(--text-xs); }
/* Issue-fixes spec §6.5: the fill is the §6.1 category; the stroke repeats it. */
.dep-idle rect { fill: var(--cat-idle); stroke: var(--border-strong); }
.dep-running rect { fill: var(--cat-running); stroke: var(--ok); }
.dep-waiting rect { fill: var(--cat-waiting); stroke: var(--warn); }
.dep-blocked rect { fill: var(--cat-blocked); stroke: var(--danger); }
.dep-done rect { fill: var(--cat-done); stroke: var(--info); }
@keyframes dep-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
.dep-node.dep-running rect { animation: dep-pulse 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .dep-node.dep-running rect { animation: none; }
}
.dep-node[aria-current="true"] rect { stroke: var(--accent); stroke-width: 3; }
.dep-legend { display: flex; flex-wrap: wrap; gap: 12px; list-style: none; margin: 4px 0 8px; padding: 0; font-size: var(--text-xs); color: var(--muted); }
.dep-swatch { display: inline-block; width: 12px; height: 12px; margin-right: 4px; vertical-align: middle; border-radius: 3px; border: 1px solid var(--border-strong); }
.dep-swatch.dep-idle { background: var(--cat-idle); }
.dep-swatch.dep-running { background: var(--cat-running); }
.dep-swatch.dep-waiting { background: var(--cat-waiting); }
.dep-swatch.dep-blocked { background: var(--cat-blocked); }
.dep-swatch.dep-done { background: var(--cat-done); }
```

  Locales: in en `control.graph`, after `cycle_other: …,` add

```ts
      legend: "Legend",
      category: { idle: "idle", running: "running", waiting: "waiting", blocked: "blocked", done: "done" },
      stepAttempt: "{{step}} · attempt {{attempt}}",
      runNumber: "run {{n}}",
      elapsed: "{{minutes}} min",
      stalled: "no progress for {{minutes}} min",
```

  in zh `control.graph`, after `cycle_other: …,` add

```ts
      legend: "图例",
      category: { idle: "空闲", running: "进行中", waiting: "等待依赖", blocked: "受阻", done: "已完成" },
      stepAttempt: "{{step}} · 第 {{attempt}} 次尝试",
      runNumber: "第 {{n}} 次运行",
      elapsed: "{{minutes}} 分钟",
      stalled: "已 {{minutes}} 分钟没有进展",
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`; then `npm run check --workspace web > <S>/e9-web.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutation** (clone, web built): restore `if (layout.edges.length === 0 && layout.missing === 0 && layout.cycleEdges === 0) return null;`
  → "draws every task even when no task depends on another" red; replace `nodeClass(item.category)` with `"dep-node"` →
  the class test red; change `quiet > STALL_MS` to `quiet >= STALL_MS` → "only once … more than 10 minutes" red (10 min
  shows); change `n > 1` to `n > 2` → the step/attempt test red (no `run 2`); change
  `run.state !== "failed-before-provider"` to `true` → `runNumber(...)` expectation `1` red; delete the reduced-motion
  media block → the pulse test red; delete `--cat-done` from the light block → the token test red.
- [ ] **Step 6: Commit** — `git -C <wt> add web/src/DependencyGraph.tsx web/src/ControlGroupView.tsx web/src/styles.css web/src/locales/en.ts web/src/locales/zh.ts web/tests/dependencyGraph.test.tsx web/tests/styles.test.ts web/tests/contrast.test.ts`,
  message `feat(web): draw the work-items graph always, filled by category, with live node text` (+ Co-Authored-By).

### Task E10: Group detail order, archived banner and the archive buttons (spec §6.3, §6.5)

**Files:**
- Modify: `web/src/ControlGroupView.tsx` — move blocks by anchor (measured lines: BudgetEditor 133-134,
  AgentSelectionEditor 135-143, workItems heading 145, graph 146, `<GitScheme` 228, dispatch section 276-331)
- Modify: `web/src/controlApi.ts` — `ControlAction` (lines 241-261), `controlCommandPath` (lines 264-311)
- Modify: locales `control.group` (en lines 228-259, zh corresponding block)
- Test: `web/tests/archiveGroup.test.tsx` (new)

**Interfaces:**
- Consumes: `GroupSummaryV1.archived` (E2); verbs (E3).
- Produces: `ControlAction` `{ verb: "archive-group" | "unarchive-group"; groupId; expectedRevision; payload: Record<string, never> }`
  with paths `/api/control/groups/<g>/archive` and `/unarchive`.

- [ ] **Step 1: Write the failing test** — `web/tests/archiveGroup.test.tsx`:

```tsx
// @vitest-environment jsdom
/** Issue-fixes spec §6.3, §6.5: the archived banner and its Unarchive, the Archive action, and the detail's order. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCommandPath } from "../src/controlApi.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupViewV1 } from "../src/controlTypes.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const archived = (base: GroupViewV1): GroupViewV1 => ({ ...base, summary: { ...base.summary, state: "ready", archived: true } });

describe("archiving from the group view (spec §6.3)", () => {
  it("shows an archived group's banner with Unarchive, and offers no dispatch action", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={archived(view([workItem({ taskId: "a" })]))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByRole("status", { name: "Archived" }).textContent).toContain("This group is archived");
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "unarchive-group", groupId: "g", expectedRevision: 6, payload: {} });
    for (const name of ["Start", "Pause dispatch", "Handoff stop", "Archive group"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("offers Archive group on a group that is not archived, and sends it under the view's revision", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([workItem({ taskId: "a" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("status", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "archive-group", groupId: "g", expectedRevision: 6, payload: {} });
  });

  it("serves both verbs on the group's own routes", () => {
    expect(controlCommandPath({ verb: "archive-group", groupId: "g 1", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g%201/archive");
    expect(controlCommandPath({ verb: "unarchive-group", groupId: "g", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g/unarchive");
  });
});

describe("the group detail's order (spec §6.5)", () => {
  it("puts the graph before the work-items table, the table before runs, and runs before the budget editor", () => {
    render(<ControlGroupView view={view([workItem({ taskId: "a" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    const items = screen.getByRole("heading", { name: "Work items" });
    const runs = screen.getByRole("heading", { name: "Runs" });
    const budget = screen.getByRole("region", { name: "Budget proposal" });
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(graph, items)).toBe(true);
    expect(follows(items, runs)).toBe(true);
    expect(follows(runs, budget)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd <wt>/web && ../node_modules/.bin/vitest run tests/archiveGroup.test.tsx > <S>/e10.txt 2>&1; echo rc=$?` → `rc=1` (no banner; no Archive button; graph after the budget editor).

- [ ] **Step 3: Implement.**

  `web/src/controlApi.ts`: in `ControlAction`, after the `retry-integration | resolve-integration-conflict` member add

```ts
  // Issue-fixes spec §6.3: archive and unarchive a group (empty payload).
  | { verb: "archive-group" | "unarchive-group"; groupId: string; expectedRevision: number; payload: Record<string, never> }
```

  and in `controlCommandPath` after `case "resolve-integration-conflict":\n      return \`${group}/integration/resolve\`;` add

```ts
    case "archive-group":
      return `${group}/archive`;
    case "unarchive-group":
      return `${group}/unarchive`;
```

  `web/src/ControlGroupView.tsx`:
  1. Add `const archived = view.summary.archived === true;` after `const handoffActive = …;`.
  2. Cut the `<BudgetEditor … />` element and the whole `{props.agents !== undefined && ( <AgentSelectionEditor … /> )}`
     block (today directly after the stop line) and paste them, unchanged, directly before `<GitScheme view={view} …`.
  3. Move the `<DependencyGraph … />` line (E9's form) from below `<h3>{t("control.group.workItems")}</h3>` to directly
     above that heading, and directly above the graph insert the archived banner:

```tsx
      {archived && (
        <p role="status" aria-label={t("control.group.archivedRegion")}>
          {t("control.group.archivedBanner")}{" "}
          <button type="button" onClick={() => onCommand({ verb: "unarchive-group", groupId, expectedRevision: revision, payload: {} })}>
            {t("control.group.unarchive")}
          </button>
        </p>
      )}
```

     (Everything above it -- heading, claim-blocked, Part A's refusal, the spend-cap line, the plan line, Part C's stop
     banner -- is the alerts area of spec §6.5 and stays in place.)
  4. In the dispatch section: everything between `<h3>{t("control.group.dispatch")}</h3>` and
     `<p>{t("control.group.recent", …)}</p>` (the Start/Pause/Handoff/Resume/continue/recovery buttons as Parts C and D
     left them) is wrapped in `{!archived && (<>` … `</>)}`, and inside that fragment, as its last child, add

```tsx
          <button type="button" onClick={() => onCommand({ verb: "archive-group", groupId, expectedRevision: revision, payload: {} })}>
            {t("control.group.archive")}
          </button>
```

  Locales, `control.group` (after `recent: …`): en

```ts
      archivedRegion: "Archived",
      archivedBanner: "This group is archived: it keeps every record and takes no new work.",
      unarchive: "Unarchive",
      archive: "Archive group",
```

  zh

```ts
      archivedRegion: "已归档",
      archivedBanner: "这个组已归档：记录都保留，不再接新工作。",
      unarchive: "取消归档",
      archive: "归档这个组",
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`; `npm run check --workspace web > <S>/e10-web.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutation** (clone, web built): move the BudgetEditor back above the graph → the order test red; delete
  the `{!archived && (` wrapper (keep its content) → "offers no dispatch action" red; delete the banner block → the
  first test red; delete `case "archive-group"` → typecheck fails and the path test red.
- [ ] **Step 6: Commit** — `git -C <wt> add web/src/ControlGroupView.tsx web/src/controlApi.ts web/src/locales/en.ts web/src/locales/zh.ts web/tests/archiveGroup.test.tsx`,
  message `feat(web): put the graph first, and archive or unarchive a group from its view` (+ Co-Authored-By).

### Task E11: The task detail shows its current run's activity (spec §6.5)

**Files:**
- Modify: `web/src/controlApi.ts` — after `fetchRunEvidence` (lines 110-112)
- Modify: `web/src/TaskDetail.tsx` — imports (lines 11-18); new `RunActivity`; insertion before
  `<h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>` (line 178)
- Modify: locales (`control.activity`, `enums.activityKind`)
- Modify: `web/tests/taskLabels.test.tsx` (the rewrite listed above)
- Test: `web/tests/taskActivity.test.tsx` (new)

**Interfaces:**
- Consumes: Part B route and `RunActivityViewV1`/`ActivityEntryV1`; Part A `explainRunReason`.
- Produces: `fetchRunActivity(runId: string): Promise<RunActivityViewV1>`; `RunActivity(props: { runId: string; changeSeq: number })`.

- [ ] **Step 1: Write the failing test** — `web/tests/taskActivity.test.tsx`:

```tsx
// @vitest-environment jsdom
/** Issue-fixes spec §6.5: selecting a task shows its current run's recent activity, above the evidence list. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../src/TaskDetail.js";
import { run, view, workItem } from "./fixtures/board.js";

const AT = Date.UTC(2026, 9, 8, 10, 5, 0);
const answer = {
  schema: "orca-run-activity-v1", runId: "run-a",
  entries: [
    { seq: 2, groupId: "g", taskId: "a", runId: "run-a", at: AT, kind: "phase", body: { step: "execute", attempt: 2 } },
    { seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: AT - 60_000, kind: "run-started", body: { providerAttemptOrdinal: 1 } },
  ],
};
let urls: string[] = [];
beforeEach(() => {
  urls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the task detail's run activity (spec §6.5)", () => {
  it("reads the current run's activity from its route and lists it, newest first, above the runs and their evidence", async () => {
    const item = workItem({ taskId: "a", currentRunId: "run-a", lineageRunIds: ["run-a"] });
    render(<TaskDetail view={view([item], [run({})])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual([
      `${new Date(AT).toISOString()} · phase · execute · attempt 2`,
      `${new Date(AT - 60_000).toISOString()} · started`,
    ]);
    expect(urls).toEqual(["/api/control/runs/run-a/activity"]);
    const runsHeading = screen.getByRole("heading", { name: "Runs of a" });
    expect(region.compareDocumentPosition(runsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("reads nothing for a task with no current run", () => {
    const item = workItem({ taskId: "a" });
    render(<TaskDetail view={view([item])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Recent activity of run-a" })).toBeNull();
    expect(urls).toEqual([]);
  });
});
```

  Rewrite in `web/tests/taskLabels.test.tsx` ("lists the manifest's entries and downloads one with the session alone",
  spec §6.5): in the `beforeEach` fetch mock, before the evidence branch, add
  `if (url === "/api/control/runs/run-a/activity") return new Response(JSON.stringify({ schema: "orca-run-activity-v1", runId: "run-a", entries: [] }), { status: 200, headers: { "content-type": "application/json" } });`
  and change the final assertion to

```ts
      expect(requests).toEqual([{ url: "/api/control/runs/run-a/activity", headers: undefined }, { url: "/api/control/runs/run-a/evidence", headers: undefined }, { url: "/api/control/runs/run-a/evidence/ev-2", headers: undefined }]);
```

- [ ] **Step 2: Run, expect FAIL** — `cd <wt>/web && ../node_modules/.bin/vitest run tests/taskActivity.test.tsx tests/taskLabels.test.tsx > <S>/e11.txt 2>&1; echo rc=$?` → `rc=1` (no region; the activity URL never requested).

- [ ] **Step 3: Implement.**

  `web/src/controlApi.ts` (add `RunActivityViewV1` to the type import list), after `fetchRunEvidence`:

```ts
/** Issue-fixes spec §5.2, §6.5: GET /api/control/runs/:runId/activity -- the run's newest activity rows, newest first. */
export const fetchRunActivity = (runId: string): Promise<RunActivityViewV1> =>
  controlGet<RunActivityViewV1>(`/api/control/runs/${segment(runId)}/activity`);
```

  `web/src/TaskDetail.tsx`: change line 11 to `import { useEffect, useState } from "react";`, add `fetchRunActivity` to the
  `./controlApi.js` import, `ActivityEntryV1` to the `./controlTypes.js` type import, and
  `import { explainRunReason } from "./refusalExplain.js";`. Add above `export interface TaskDetailProps`:

```tsx
/** One activity row in words: its kind, and for a phase, a block or a settle what it said. */
function activityText(entry: ActivityEntryV1): string {
  const kind = enumText("activityKind", entry.kind);
  const body = entry.body as Record<string, unknown>;
  if (entry.kind === "phase" && typeof body.step === "string") {
    const step = enumText("progressStep", body.step);
    return `${kind} · ${typeof body.attempt === "number" ? i18n.t("control.activity.phase", { step, attempt: body.attempt }) : step}`;
  }
  if (entry.kind === "run-blocked" && typeof body.reason === "string") return `${kind} · ${explainRunReason(body.reason) ?? body.reason}`;
  if (entry.kind === "run-settled" && typeof body.state === "string") return `${kind} · ${enumText("runState", body.state)}`;
  return kind;
}

/**
 * Issue-fixes spec §6.5: the current run's recent activity, read when the detail opens and again whenever the group's
 * projection moves (changeSeq). A refusal is named in place; the rest of the detail does not wait on it.
 */
export function RunActivity(props: { runId: string; changeSeq: number }): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntryV1[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchRunActivity(props.runId).then(
      (answer) => { if (live) { setEntries(Array.isArray(answer?.entries) ? answer.entries : []); setRefusal(null); } },
      (err: unknown) => { if (live) setRefusal(controlFailureFrom(err).code); },
    );
    return () => { live = false; };
  }, [props.runId, props.changeSeq]);
  return (
    <section aria-label={t("control.activity.region", { runId: props.runId })}>
      <h5>{t("control.activity.heading")}</h5>
      {refusal !== null && <p className="detail-note">{t("control.activity.refused", { code: refusal })}</p>}
      {entries !== null && (entries.length === 0 ? <p>{t("control.activity.none")}</p> : (
        <ol>
          {entries.map((entry) => <li key={entry.seq}>{new Date(entry.at).toISOString()} · {activityText(entry)}</li>)}
        </ol>
      ))}
    </section>
  );
}
```

  and in `TaskDetail`'s return, directly before `<h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>`:

```tsx
      {item.currentRunId !== null && <RunActivity runId={item.currentRunId} changeSeq={view.changeSeq} />}
```

  Locales: en, inside `control` after the `evidence: { … },` block:

```ts
    activity: {
      region: "Recent activity of {{runId}}",
      heading: "Recent activity",
      none: "no activity recorded yet",
      refused: "activity refused · {{code}}",
      phase: "{{step}} · attempt {{attempt}}",
    },
```

  en, a new enum const next to `progressStep` (before `export const en`), and `activityKind` added to the `enums:`
  list after `progressStep,`:

```ts
// Issue-fixes spec §5.2: the activity kinds a run's feed shows.
const activityKind = {
  command: "command", "run-claimed": "claimed", "run-started": "started", phase: "phase", "run-blocked": "blocked", "run-resumed": "resumed",
  "run-settled": "settled", "task-retried": "task retried", integration: "integration", stop: "stopped", "stop-cleared": "stop cleared",
  archived: "archived", unarchived: "unarchived",
} as const satisfies Record<ActivityEntryV1["kind"], string>;
```

  (add `ActivityEntryV1` to en.ts's type import from `../controlTypes.js`). zh, inside `control` after `evidence`:

```ts
    activity: {
      region: "{{runId}} 的近期活动",
      heading: "近期活动",
      none: "还没有活动记录",
      refused: "活动读取被拒绝 · {{code}}",
      phase: "{{step}} · 第 {{attempt}} 次尝试",
    },
```

  zh `enums`, after `progressStep: {…},`:

```ts
    activityKind: {
      command: "命令", "run-claimed": "已认领", "run-started": "已开始", phase: "阶段", "run-blocked": "受阻", "run-resumed": "已恢复",
      "run-settled": "已结束", "task-retried": "任务重试", integration: "集成", stop: "已停止", "stop-cleared": "停止已解除",
      archived: "已归档", unarchived: "已取消归档",
    },
```

  (If Part B already added `enums.activityKind`, keep Part B's entries and skip these; Rule 7.)

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`; `npm run check --workspace web > <S>/e11-web.txt 2>&1; echo rc=$?` → `rc=0`;
  `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > <S>/e11-scan.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutation** (clone, web built): delete the `<RunActivity …/>` line → the first test red (and the taskLabels
  rewrite red); replace `item.currentRunId !== null &&` with `true &&` and pass `runId={item.currentRunId ?? "run-a"}` →
  "reads nothing for a task with no current run" red (a request is made); delete the
  `if (entry.kind === "phase" …) { … }` block → the first test red (the line reads `phase` only).
- [ ] **Step 6: Commit** — `git -C <wt> add web/src/controlApi.ts web/src/TaskDetail.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/taskActivity.test.tsx web/tests/taskLabels.test.tsx`,
  message `feat(web): show the current run's recent activity in the task detail` (+ Co-Authored-By).

### Task E12: Part E closing check

- [ ] **Step 1:** `npm run typecheck > <S>/e12-tc.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 2:** `npm run build --workspace web > <S>/e12-build.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 3:** `npm run --ws check > <S>/e12-ws.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 4:** `./node_modules/.bin/vitest run tests/control tests/panel tests/entry > <S>/e12-server.txt 2>&1; echo rc=$?`
  → `rc=0`, or only reds from the registered load-flake list (handoff §3); re-run those files alone and record `uptime`.
- [ ] **Step 5:** record in the ledger: the rewritten tests (table at the top of this part), every mutation seen red with
  the clone path and the commit, and the flagged points below. No commit (evidence only).

### Points flagged for the controller (the design is not changed here)

1. **Archive guard codes.** Spec §6.3 asks for "its own code and explanation" per guard; this part adds four durable 409
   codes (`archive-run-active`, `archive-stop-pending`, `archive-integration-resolving`, `archive-call-in-flight`) beside
   `group-archived`. The plan index's "New error codes" list names only `group-archived` and should gain them.
2. **"Estimate in flight"** is read as `running`/`start-unknown`, the states `scheduleStart`'s `estimate-in-flight`
   already uses. A *queued* estimate (every imported group has one until the estimator runs) does not refuse archive, and
   `claimEstimate` (`webService.ts:461`) is not among the paths §6.3 tells to skip an archived group, so a queued estimate
   wake on an archived group is still claimed. Likewise `requirement-export` wakes are not gated. Not changed.
3. **`replenishStartWakes` and `deliverContinuationWake`** get no check of their own: they are covered through
   `nextClaimableTask` and `deliverScheduledStart` (their only caller), and a duplicate check could never be seen red.
4. **Group-list rule 4** (`counts.running + counts.waiting > 0` ⇒ Running): a confirmed group that was never started but
   has any dependency edge has a `waiting` task, so it lists as Running, not Not started.
5. **Legacy `applyCommand`** (`src/control/commands.ts`, the CLI `ControlService`/`claimWork` path) books its own command
   rows and is not gated by E4's ledger gate; it is not reachable from a Web or socket route (same standing as spend caps'
   D19 gap).
6. **Part B / Part D names assumed:** the web type `RunActivityViewV1`/`ActivityEntryV1`, run view `startedAt` and
   `lastActivityAt`, the route's response shape, `enums.activityKind` (E11 adds it unless Part B did), and
   `WebControlService.retryTask` with a group target. If those parts chose other names, E4/E9/E11 use theirs.
7. **`src/control/archivedMark.ts`** is a second new server file beside `archiveGroup.ts`: the archive-mark reader is
   needed by `commandLedger.ts`, which `archiveGroup.ts` itself imports, so it lives in a leaf module.
