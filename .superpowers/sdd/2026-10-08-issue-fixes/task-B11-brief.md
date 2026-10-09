### Task B11: Views, the run-activity route, wire schemas and Web mirror

**Files:**
- Modify `src/control/webProtocol.ts`: before `export const runViewSchema = z` (line 1152) add the activity schemas;
  inside `runViewSchema` after the `skills` field (before `  })\n  .strict();\n\nexport const estimateViewSchema`, line
  ~1207) add three fields; inside `groupViewSchema` after `integration: groupIntegrationViewSchema.optional(),` add
  `activity`; after `evidenceManifestSchema` (line ~1398) add `runActivitySchema`; types next to
  `export type EvidenceManifestV1` (line ~1598).
- Modify `src/panel/controlViews.ts`: imports; `runViews` return (lines 757-768); `readControlGroup` view (before
  `...integrationView(body),`, line ~841); new `readRunActivityView` after `readRunEvidence`.
- Modify `src/panel/controlApi.ts`: import `readRunActivityView` (line 24); route after the evidence routes (after
  line 297).
- Modify `web/src/controlTypes.ts` (`RunViewV1` lines 213-235, `GroupViewV1` lines 274-306, after `EvidenceManifestV1`
  line 345-349) and `web/src/controlApi.ts` (import list line 14-…, after `fetchRunEvidence` line 112).
- Test: extend `tests/panel/controlReadApi.test.ts` (one new `it` in "canonical control read API"),
  `tests/panel/webParity.test.ts` (one new pair, additive), `tests/control/activity.test.ts` (kind-list parity).

**Interfaces:**
- Produces wire: `activityKindSchema`, `activityEntrySchema`, `runActivitySchema`, types `ActivityEntryV1`,
  `RunActivityV1` (server and Web); `RunViewV1.startedAt/endedAt/lastActivityAt?: number | null`;
  `GroupViewV1.activity?: ActivityEntryV1[]` (newest 50, newest first); route `GET /api/control/runs/:runId/activity`
  → `RunActivityV1` (newest 200); `readRunActivityView(store, runId): RunActivityV1`; Web `fetchRunActivity(runId)`.
- Part E reads `latestGroupActivityAt` for the summary's `updatedAt`; this task does not touch the summary.

- [ ] **Step 1: Write the failing tests.**

`tests/control/activity.test.ts` — add `import { activityKindSchema } from "../../src/control/webProtocol.js";`
(merge into the existing webProtocol type import as a value import) and `ACTIVITY_KINDS` to the activity import; append:

```ts
describe("the wire's activity kinds (issue-fixes spec §5.2)", () => {
  it("are exactly the kinds the writer knows", () => {
    expect([...activityKindSchema.options].sort()).toEqual([...ACTIVITY_KINDS].sort());
  });
});
```

`tests/panel/controlReadApi.test.ts` — add imports `import { recordActivity } from "../../src/control/activity.js";`,
`import { createGroup } from "../../src/control/commands.js";`, and `RunActivityV1` to the `webProtocol.js` type
import; append inside `describe("canonical control read API", …)`:

```ts
  // Issue-fixes spec §5.2 Reads, §5.3: the group view's newest 50 rows, the run view's times (null for a run written
  // before schema 9), and the run-activity route under the evidence route's checks: logged in, and a run of this store.
  it("shows a group's newest activity, a run's times, and a run's activity only for a run of this store", async () => {
    await confirmGroup(h, "group-a");
    insertValidTaskRun(h, "group-a");
    h.store.transaction(() => {
      for (let i = 1; i <= 201; i += 1) recordActivity(h.store, { groupId: "group-a", taskId: "a", runId: "run-one", kind: "phase", body: { step: "executing", attempt: i } });
      recordActivity(h.store, { groupId: "group-a", kind: "stop", body: { mode: "pause" } });
    });
    const newestGroupSeq = Number(h.store.db.prepare("SELECT MAX(seq) AS seq FROM activity WHERE group_id='group-a'").get()!.seq);
    const newestRun = h.store.db.prepare("SELECT seq,at FROM activity WHERE run_id='run-one' ORDER BY seq DESC LIMIT 1").get()!;

    const groupResponse = await request(h, "/api/control/groups/group-a");
    expect(groupResponse.status).toBe(200);
    const view = await groupResponse.json() as GroupViewV1;
    expect(view.activity).toHaveLength(50);
    expect(view.activity![0]).toMatchObject({ seq: newestGroupSeq, kind: "stop", taskId: null, runId: null, body: { mode: "pause" } });
    expect(view.activity!.map((entry) => entry.seq)).toEqual([...view.activity!.map((entry) => entry.seq)].sort((a, b) => b - a));
    expect(view.runs.find((run) => run.runId === "run-one")).toMatchObject({ startedAt: null, endedAt: null, lastActivityAt: Number(newestRun.at) });

    const response = await request(h, "/api/control/runs/run-one/activity");
    expect(response.status).toBe(200);
    const activity = await response.json() as RunActivityV1;
    expect(activity).toMatchObject({ schema: "orca-run-activity-v1", runId: "run-one" });
    expect(activity.entries).toHaveLength(200);
    expect(activity.entries[0]).toMatchObject({ seq: Number(newestRun.seq), kind: "phase", body: { attempt: 201 } });
    expect(activity.entries.every((entry) => entry.runId === "run-one")).toBe(true);

    expect((await request(h, "/api/control/runs/run-one/activity", false)).status).toBe(401);

    // Another project's run lives in another control store; this panel does not know it.
    const other = await openTestStore();
    try {
      createGroup(other.store, { groupId: "elsewhere", projectKey: "other/repo", goal: "Other", successConditions: ["ok"], limit: amount(100), reviewReserve: amount(10), deadlineAt: null },
        { commandId: "create", expectedRevision: 0, by: "human" });
      other.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-other-project','elsewhere','w',1,0,'{}')").run();
      const foreign = await request(h, "/api/control/runs/run-other-project/activity");
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toMatchObject({ error: { code: "run-not-found" } });
    } finally { await other.dispose(); }
    const malformed = await request(h, "/api/control/runs/%20bad/activity");
    expect(malformed.status).toBe(404);
  });
```

`tests/panel/webParity.test.ts` — add `RunActivityV1 as ServerRunActivityV1,` to the server type import (alphabetical,
after `RequirementViewV1 as ServerRequirementViewV1,`), `RunActivityV1 as WebRunActivityV1,` to the Web import, the
pair after `evidenceWebToServer`:

```ts
// Issue-fixes spec §5.2: the run-activity read, checked both ways like the evidence manifest.
function runActivityServerToWeb(x: ServerRunActivityV1): WebRunActivityV1 { return x; }
function runActivityWebToServer(x: WebRunActivityV1): ServerRunActivityV1 { return x; }
```

and `runActivityServerToWeb, runActivityWebToServer,` after `evidenceWebToServer,` in `__webParityAssignabilityChecks__`.

- [ ] **Step 2: Run, expect FAIL** — `./node_modules/.bin/vitest run tests/panel/controlReadApi.test.ts tests/control/activity.test.ts > $SCRATCH/B11.txt 2>&1; echo rc=$?`:
  `activityKindSchema` is undefined (TypeError on `.options`); the route answers 404 `route-not-found` and
  `view.activity` is undefined. `npm run typecheck > $SCRATCH/B11-tsc.txt 2>&1; echo rc=$?`: rc≠0, `RunActivityV1` not
  exported by either module.

- [ ] **Step 3: Implement.**

`src/control/webProtocol.ts`, before `export const runViewSchema = z`:

```ts
// Issue-fixes spec §5.2 (ruling H5): one row of Orca's activity record as the views show it (src/control/activity.ts).
export const activityKindSchema = z.enum([
  "command", "run-claimed", "run-started", "phase", "run-blocked", "run-resumed", "run-settled", "task-retried", "integration", "stop", "stop-cleared", "archived", "unarchived",
]);
export const activityEntrySchema = z
  .object({
    seq: positiveSafeInteger, groupId: idSchema, taskId: idSchema.nullable(), runId: idSchema.nullable(), at: safeInteger,
    kind: activityKindSchema, body: z.record(z.unknown()),
  })
  .strict();
```

`runViewSchema`, after the `skills` field's closing `.optional(),`:

```ts
    // Issue-fixes spec §5.2: wall-clock times (ms) -- started when A1 reserved the first attempt, ended when it first
    // landed or settled, and the time of its newest activity row. null for a run written before schema 9. Optional on
    // the wire so older fixtures still parse; the server always gives them.
    startedAt: safeInteger.nullable().optional(),
    endedAt: safeInteger.nullable().optional(),
    lastActivityAt: safeInteger.nullable().optional(),
```

`groupViewSchema`, after `integration: groupIntegrationViewSchema.optional(),`:

```ts
    // Issue-fixes spec §5.2 Reads: the group's newest 50 activity rows, newest first. Optional on the wire so older
    // fixtures still parse; the server always gives it.
    activity: z.array(activityEntrySchema).optional(),
```

after `evidenceManifestSchema`'s closing `);`:

```ts
// Issue-fixes spec §5.2 Reads: GET /api/control/runs/:runId/activity -- the run's newest 200 rows, newest first.
export const runActivitySchema = z
  .object({ schema: z.literal("orca-run-activity-v1"), runId: idSchema, entries: z.array(activityEntrySchema) })
  .strict();
```

types, after `export type EvidenceManifestV1 = …;`:

```ts
export type ActivityEntryV1 = z.infer<typeof activityEntrySchema>;
export type RunActivityV1 = z.infer<typeof runActivitySchema>;
```

`src/panel/controlViews.ts` — add `import { readGroupActivity, readRunActivity } from "../control/activity.js";`; add
`runActivitySchema,` and `type RunActivityV1,` to the `../control/webProtocol.js` import list. `runViews` return —
after the `skills` spread line:

```ts
      ...(run.drive?.skills == null ? {} : { skills: { profile: run.drive.skills.profile, lock: run.drive.skills.lock } }),
      // Issue-fixes spec §5.2: the run's times; null for a run written before schema 9.
      startedAt: run.startedAt ?? null,
      endedAt: run.endedAt ?? null,
      lastActivityAt: readRunActivity(store, runId, 1)[0]?.at ?? null,
    };
```

`readControlGroup` view — before `...integrationView(body),`:

```ts
    // Issue-fixes spec §5.2 Reads: the newest 50 rows of the group.
    activity: readGroupActivity(store, groupId, 50),
```

after `readRunEvidence`:

```ts
/**
 * Issue-fixes spec §5.2 Reads: GET /api/control/runs/:runId/activity. The evidence route's scope checks: an id that is
 * not an id, or a run this store does not hold (another project's), is run-not-found.
 */
export function readRunActivityView(store: ControlStore, runId: string): RunActivityV1 {
  const row = idSchema.safeParse(runId).success ? store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId) : undefined;
  if (!row) throw new ControlError("run-not-found");
  const parsed = runActivitySchema.safeParse({ schema: "orca-run-activity-v1", runId, entries: readRunActivity(store, runId, 200) });
  if (!parsed.success) return blocked(`run-activity:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}
```

`src/panel/controlApi.ts` — import line 24 adds `readRunActivityView`; after the evidence-artifact route's closing
`}));` (line 297):

```ts
  // Issue-fixes spec §5.2: a run's newest 200 activity rows, under the evidence route's checks (the panel's login, and a
  // run of this store -- another project's is run-not-found).
  app.get("/api/control/runs/:runId/activity", (req, res) => {
    const runId = String(req.params.runId);
    try { res.json(readRunActivityView(deps.store, runId)); }
    catch (error) {
      const run = deps.store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
      sendMappedControlError(res, error, run ? readErrorContext(deps.store, String(run.group_id)) : undefined);
    }
  });
```

`web/src/controlTypes.ts` — `RunViewV1` after the `skills?:` field:

```ts
  /** Issue-fixes spec §5.2: wall-clock times (ms); null for a run written before schema 9. Optional so literal fixtures need no edit; the server always sends them. */
  startedAt?: number | null;
  endedAt?: number | null;
  lastActivityAt?: number | null;
```

`GroupViewV1` after `integration?: GroupIntegrationViewV1;`:

```ts
  /** Issue-fixes spec §5.2: the group's newest 50 activity rows, newest first. Optional so literal fixtures need no edit. */
  activity?: ActivityEntryV1[];
```

after `EvidenceManifestV1`:

```ts
/** Issue-fixes spec §5.2: one row of Orca's activity record. */
export type ActivityKindV1 = "command" | "run-claimed" | "run-started" | "phase" | "run-blocked" | "run-resumed" | "run-settled" | "task-retried" | "integration" | "stop" | "stop-cleared" | "archived" | "unarchived";
export type ActivityEntryV1 = { seq: number; groupId: string; taskId: string | null; runId: string | null; at: number; kind: ActivityKindV1; body: Record<string, unknown> };
/** GET /api/control/runs/:runId/activity -- the run's newest 200 rows, newest first. */
export type RunActivityV1 = { schema: "orca-run-activity-v1"; runId: string; entries: ActivityEntryV1[] };
```

`web/src/controlApi.ts` — add `RunActivityV1,` to the `import type { … } from "./controlTypes.js"` list; after
`fetchRunEvidence`:

```ts
/** GET /api/control/runs/:runId/activity -- issue-fixes spec §5.2: the run's newest 200 activity rows. */
export const fetchRunActivity = (runId: string): Promise<RunActivityV1> =>
  controlGet<RunActivityV1>(`/api/control/runs/${segment(runId)}/activity`);
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/panel/controlReadApi.test.ts tests/control/activity.test.ts tests/control/webProtocol.test.ts tests/panel/runContinuable.test.ts > $SCRATCH/B11.txt 2>&1; echo rc=$?` (rc=0);
  `npm run typecheck > $SCRATCH/B11-tsc.txt 2>&1; echo rc=$?` (rc=0); `npm run build --workspace web > $SCRATCH/B11-web.txt 2>&1; echo rc=$?` (rc=0);
  `npm run --workspace web check > $SCRATCH/B11-webcheck.txt 2>&1; echo rc=$?` (rc=0); then `npm test > $SCRATCH/B11-all.txt 2>&1; echo rc=$?` read whole.

- [ ] **Step 5: Mutation** — (a) `readRunActivityView`: delete `if (!row) throw new ControlError("run-not-found");` →
  red: "…only for a run of this store" (the foreign run answers 200 with no entries). (b) delete the `activity:` line in
  `readControlGroup` → red (`view.activity` undefined). (c) `lastActivityAt: null` constant → red. (d) remove
  `"unarchived"` from `activityKindSchema` → red: "are exactly the kinds the writer knows". (e) in
  `web/src/controlTypes.ts` change `RunActivityV1.entries` to `ActivityEntryV1[] | null` → `npm run typecheck` red
  (`runActivityWebToServer`). Run (e) after `npm run build --workspace web` in the clone.

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/webProtocol.ts src/panel/controlViews.ts src/panel/controlApi.ts web/src/controlTypes.ts web/src/controlApi.ts tests/panel/controlReadApi.test.ts tests/panel/webParity.test.ts tests/control/activity.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(panel): show group activity, run times and a run-activity route

Issue-fixes spec §5.2 Reads: the group view carries the newest 50 activity rows, the run view
startedAt/endedAt/lastActivityAt (null before schema 9), and GET /api/control/runs/:runId/activity
answers the run's newest 200 rows under the evidence route's checks. Wire schemas, the Web
mirror and the parity pair are added.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### B.3 Spec §5.3 criteria → where they are pinned

| §5.3 criterion | Test |
|---|---|
| Migration 8→9 keeps every row and adds the table; an unknown version is refused | `schema9.test.ts` tests 2, 3 (and `store.test.ts` "does not migrate or rewrite an unknown schema version") |
| Per kind: committing change writes its row(s) | `activityRuns.test.ts` (run-claimed, run-started, phase, run-blocked, run-resumed, run-settled ×3 writers, stop ×3), `activity.test.ts` (command), `integrationGit.test.ts` (integration) |
| A rolled-back change writes none (mutation: write outside the transaction) | `activity.test.ts` "refuses to write outside a transaction, and a rolled-back transaction leaves no row…" + B3 mutation (a); refused commands/stops in B7/B9 |
| A replayed command writes none | B7 (`c1` replay), B8 (recovery-retry replay), B9 (pause replay) |
| Retention keeps exactly the newest 500, never another group's | `activity.test.ts` retention test |
| startedAt/endedAt at the specified moments with the injected clock; null for pre-v9 runs | B4, B5 driver/web tests; B11 `startedAt: null, endedAt: null` for `insertValidTaskRun`'s run |
| The run-activity route refuses another project's run | B11 `run-other-project` → 404 `run-not-found` |
