### Task D3: The `retry-task` command, end to end (effect)

**Files:**
- Modify: `src/control/webProtocol.ts` (`commandVerbSchema` lines 591–622; `recoveryRetryPayloadSchema` lines 665–668;
  raw variants line 869; effective variants lines 917–919; `commandResultSchema` after `task-continuing`, ~line 1468;
  types after line 1577)
- Modify: `src/control/stopIntent.ts` (`releaseCommitment`, lines 832–850)
- Create: `src/control/retryTask.ts`
- Modify: `src/control/webService.ts` (imports; a method after `continueTask`, line 634–636)
- Modify: `src/panel/controlApi.ts` (`controlCommandRoutes` after the `tasks/:taskId/loop` route, ~line 413; the verb
  `switch` after `case "recovery-retry"`, line 449)
- Modify: `src/panel/humanOnly.ts` (`VERB_ACCESS`, after `"recovery-retry": "any",` line 21)
- Modify: `web/src/controlTypes.ts` (payload types line 400; `CommandSuccessV1.verb` lines 442–444; result union after
  `task-continuing`, line 471)
- Modify: `tests/panel/webParity.test.ts` (imports; checks; export array)
- Modify: `skills/orca-control/SKILL.md` (route table, after the `tasks/<taskId>/loop` row); `tests/entry/skill.test.ts`
- Test: `tests/control/retryTask.test.ts`

**Interfaces:**
- Consumes: Part B `recordActivity(store, { groupId, taskId, runId, kind, body })` and `store.now()`; `releaseCommitment`.
- Produces: `retryTaskPayloadSchema`, `RetryTaskPayload`, verb `"retry-task"` (group target), result
  `{ kind: "task-retried"; taskId: string; fromRunId: string }`; `export function reserveCommitment(store, groupId, reserved: Amount): void`
  (stopIntent.ts); `export type RetryTaskCommand`, `export function applyRetryTask(deps: RetryTaskDeps, command: RetryTaskCommand): CommandSuccessV1 | CommandErrorBodyV1`
  (retryTask.ts); `WebControlService.retryTask(command): WebCommandResult`; route `POST /api/control/groups/:groupId/retry-task`;
  web `RetryTaskPayloadV1 = { taskId: string }`.

- [ ] **Step 1: Write the failing test.** Add to the imports of `tests/control/retryTask.test.ts`:

```ts
import { readRunActivity } from "../../src/control/activity.js";
import { readBudgetProposal } from "../../src/control/queries.js";
```

  and after `failedRun`:

```ts
const DIMENSIONS = ["tokens", "activeMs", "attempts", "sessions"] as const;
type Dimension = typeof DIMENSIONS[number];
const work = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const active = (t: Harness, runId: string): number => Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
/** Spec §4.2(2): the failed run's net new reservation per dimension -- its grant minus its remainder, work + handoff. */
const netOf = (run: Record<string, any>): Record<Dimension, number> =>
  Object.fromEntries(DIMENSIONS.map((d) => [d, run.grant.work[d] + run.grant.handoff[d] - run.remaining.work[d] - run.remaining.handoff[d]])) as Record<Dimension, number>;
const retry = (t: Harness, taskId = "a") => t.service.retryTask(t.h.command("retry-task", { taskId }));
```

  and a new describe at the end of the file:

```ts
describe("retry-task (spec §4.2(2))", () => {
  it("settles the failed run, returns the task to ready under the same grant, and the group view reads at once (review C1)", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const failed = t.body(runId);
      const before = readWebGroup(t.h.store, "g").ledger;
      const revision = view(t).summary.commandRevision;
      const net = netOf(failed);
      expect(net.tokens).toBe(10);
      const at = Date.now();
      const result = retry(t);
      expect("error" in result ? result.error : result.result).toEqual({ kind: "task-retried", taskId: "a", fromRunId: runId });
      // Effect 1: the run alone moves -- usage booked stays, remainder stays on the run (remaining == grant - cumulative).
      const settled = t.body(runId);
      expect(settled).toMatchObject({ state: "settled-failed", remaining: failed.remaining, cumulative: failed.cumulative, drive: { ...failed.drive, cleanedUp: false } });
      expect(settled.endedAt).toBeGreaterThanOrEqual(at);
      expect(active(t, runId)).toBe(0);
      // Effect 1: remainder released, grant re-reserved -- net change grant - remaining, allocations still confirmed.
      const after = readWebGroup(t.h.store, "g").ledger;
      for (const d of DIMENSIONS) {
        expect(after.committedRemaining[d], d).toBe(before.committedRemaining[d] + net[d]);
        expect(after.explicitUnallocatedReserve[d], d).toBe(before.explicitUnallocatedReserve[d] - net[d]);
      }
      expect(readBudgetProposal(t.h.store, "g").allocations.filter((row) => row.ownerId === "a").map((row) => row.state)).toEqual(["confirmed", "confirmed"]);
      // Effect 2: ready, currentRunId kept on the settled-failed run, grant unchanged.
      expect(work(t, "a")).toMatchObject({ status: "ready", currentRunId: runId, lineageRunIds: [runId], grant: failed.grant });
      // C1: the group view reads immediately, with the run settled-failed and its reason.
      const read = view(t);
      expect(read.summary.commandRevision).toBe(revision + 1);
      expect(read.runs.map((run) => [run.runId, run.state, run.stopReason])).toEqual([[runId, "settled-failed", FAILED_REASON]]);
      expect(read.workItems.find((item) => item.taskId === "a")!.status).toBe("ready");
      // Effect 4: two activity rows, newest first.
      expect(readRunActivity(t.h.store, runId, 10).slice(0, 2).map((entry) => [entry.kind, entry.body])).toEqual([
        ["task-retried", { fromRunId: runId }],
        ["run-settled", { state: "settled-failed", outcome: "failed", stopReason: FAILED_REASON }],
      ]);
    } finally { await t.h.dispose(); }
  });
});
```

  `tests/entry/skill.test.ts`: import `retryTaskPayloadSchema` in the existing import list (after `recoveryRetryPayloadSchema,`);
  in `schemaByVerb` add `"retry-task": retryTaskPayloadSchema,` after the `"recovery-retry"` entry; rewrite the three
  counts (see "Existing tests rewritten" 1–3): `expect(routes.size).toBe(30);`, `expect(verbs.size).toBe(30);`,
  `expect(rows.length).toBe(30);`, and the comment line `// 29 routes carry the 30 verbs: …` becomes
  `// 30 routes carry the 31 verbs: …` with `Issue fixes spec §4.2(2) added \`groups/<groupId>/retry-task\` (retry-task).`
  appended to that comment.

- [ ] **Step 2: Run it, expect FAIL.** `npm run typecheck` → rc≠0 (`"retry-task"` is not a verb, `retryTask` is not a method,
  `retryTaskPayloadSchema` is not exported). `./node_modules/.bin/vitest run tests/control/retryTask.test.ts tests/entry/skill.test.ts > $S/d3.txt 2>&1; echo rc=$?`
  → rc=1 (`t.service.retryTask is not a function`; the skill counts are 29).
- [ ] **Step 3: Implement.**
  `src/control/webProtocol.ts`:
  - `commandVerbSchema`: after `"recovery-retry",` add `"retry-task",`.
  - After `recoveryRetryPayloadSchema`'s closing `]);` add

```ts
// Issue fixes spec §4.2(2): start a task again whose current run ccloop ended failed. Group target; the task is named here.
export const retryTaskPayloadSchema = z.object({ taskId: idSchema }).strict();
```

  - raw variants: after the `recovery-retry` line add
    `z.object({ ...rawCommandFields, verb: z.literal("retry-task"), target: groupCommandTargetSchema, payload: retryTaskPayloadSchema }).strict(),`
  - effective variants: after the `recovery-retry` entry add
    `z.object({ ...effectiveCommandFields, verb: z.literal("retry-task"), target: groupCommandTargetSchema, payload: retryTaskPayloadSchema }).strict(),`
  - `commandResultSchema`: after the `task-continuing` object add
    `z.object({ kind: z.literal("task-retried"), taskId: idSchema, fromRunId: idSchema }).strict(),`
  - after `export type RecoveryRetryPayload = z.infer<typeof recoveryRetryPayloadSchema>;` add
    `export type RetryTaskPayload = z.infer<typeof retryTaskPayloadSchema>;`

  `src/control/stopIntent.ts`: replace the whole `releaseCommitment` function (from its doc comment
  `/** Give the group reserve back for a commitment that has ended, keeping every ledger mirror in sync. */` to its closing
  brace) with:

```ts
/** Give the group reserve back for a commitment that has ended, keeping every ledger mirror in sync. */
export function releaseCommitment(store: ControlStore, groupId: string, released: Amount): void {
  moveCommitment(store, groupId, (reserved) => subtract(reserved, released));
}

/**
 * Issue fixes spec §4.2(2): commit part of the group reserve again -- retry-task re-reserves the task's grant after
 * releasing its failed run's remainder -- keeping every ledger mirror in sync. The caller has checked the reserve covers it.
 */
export function reserveCommitment(store: ControlStore, groupId: string, reserved: Amount): void {
  moveCommitment(store, groupId, (current) => add(current, reserved));
}

/** The one ledger write both directions share: the group's committed amount, then every mirror recomputed from it. */
function moveCommitment(store: ControlStore, groupId: string, next: (reserved: Amount) => Amount): void {
  const group = readGroupBody(store, groupId);
  const proposal = readBudgetProposal(store, groupId);
  group.reserved = next(group.reserved);
  const balance = budgetBalance(group.limit, group.used, group.reserved);
  group.ledger = {
    ...group.ledger, used: group.used, committedRemaining: group.reserved,
    explicitUnallocatedReserve: balance.reserve, budgetDeficit: balance.deficit,
  };
  const reserve = proposal.allocations.find(allocation => allocation.ownerKind === "reserve");
  if (!reserve) return blocked("reserve-allocation-missing");
  reserve.amount = balance.reserve;
  proposal.explicitUnallocatedReserve = balance.reserve;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
  store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?").run(canonicalBytes(proposal).toString("utf8"), groupId);
  recordProjectionChange(store, [groupId]);
}
```

  (`releaseCommitment`'s behaviour is byte-for-byte what it was; `add` and `budgetBalance` are already imported there.)

  Create `src/control/retryTask.ts`:

```ts
import type { AdmissionGate } from "./admissionGate.js";
import type { DriveRecord } from "./driveRecord.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import { recordActivity } from "./activity.js";
import { add } from "./budget.js";
import { applyWebCommand } from "./commandLedger.js";
import { readWork, saveWork } from "./queries.js";
import { commandSuccess, groupCommandTarget, readRunBody, releaseCommitment, reserveCommitment, saveRunBody } from "./stopIntent.js";

/**
 * Issue fixes spec §4.2(2) (human ruling H2): a task whose current run ccloop ended failed is started again. In one
 * transaction the failed run is settled `settled-failed` (inactive; its booked usage stays, its remainder is released and
 * the task's grant re-reserved, so the allocation stays `confirmed` at its grant), the task returns to `ready` with
 * `currentRunId` still on that run (the view requires it to be the task's last run row until the next claim replaces it),
 * and the driver is left to archive and clean it (`drive.cleanedUp` false). Normal dispatch then claims the task from the
 * group branch's current head (H3); nothing here arms a wake -- the driver's replenishStartWakes does.
 */
export type RetryTaskCommand = Extract<RawAuthorityCommandV1, { verb: "retry-task" }>;
export type RetryTaskResult = CommandSuccessV1 | CommandErrorBodyV1;
export interface RetryTaskDeps { store: ControlStore; admissionGate?: AdmissionGate; beforeCommit?: () => void }

interface RetriedWork { workItemId: string; status: string; currentRunId?: string | null; grant: { work: Amount; handoff: Amount } }

/** A grant-shaped pair summed per dimension: what the group's committed amount holds for it. */
const both = (amount: { work: Amount; handoff: Amount }): Amount => add(amount.work, amount.handoff);

export function applyRetryTask(deps: RetryTaskDeps, command: RetryTaskCommand): RetryTaskResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<RetryTaskResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command);
        const taskId = command.payload.taskId;
        const work = readWork(store, groupId, taskId) as unknown as RetriedWork;
        const runId = work.currentRunId as string;
        const run = readRunBody(store, runId);
        const drive = run.drive as DriveRecord;
        const grant = both(work.grant), remaining = both(run.remaining);
        // Effect 1: the run alone moves; `remaining` stays on it (the view checks remaining == max(grant - cumulative, 0)).
        saveRunBody(store, { ...run, state: "settled-failed", endedAt: store.now(), drive: { ...drive, cleanedUp: false } }, false);
        releaseCommitment(store, groupId, remaining);
        reserveCommitment(store, groupId, grant);
        // Effect 2.
        work.status = "ready";
        saveWork(store, groupId, work as never);
        // Effect 4 (the command revision advances in applyWebCommand).
        recordActivity(store, { groupId, taskId, runId, kind: "run-settled", body: { state: "settled-failed", outcome: drive.outcome, ...(drive.stopReason === undefined ? {} : { stopReason: drive.stopReason }) } });
        recordActivity(store, { groupId, taskId, runId, kind: "task-retried", body: { fromRunId: runId } });
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "task-retried", taskId, fromRunId: runId });
      },
    }).body;
  } finally { release?.(); }
}
```

  `src/control/webService.ts`: add to the imports, after the `continuation.js` import line,
  `import { applyRetryTask, type RetryTaskCommand } from "./retryTask.js";` and after the `continueTask` method:

```ts
  /** Issue fixes spec §4.2(2): a task whose run ccloop ended failed back to ready (retryTask.ts). */
  retryTask(command: RetryTaskCommand): WebCommandResult {
    return applyRetryTask(this.stopDeps(), command) as WebCommandResult;
  }
```

  `src/panel/controlApi.ts`, `controlCommandRoutes`: after the `/api/control/groups/:groupId/tasks/:taskId/loop` route object add

```ts
    // Issue fixes spec §4.2(2): the task is named in the payload; the ledger key is the group's.
    { path: "/api/control/groups/:groupId/retry-task", verb: "retry-task", target: fromParams },
```

  and in the verb `switch` after `case "recovery-retry": await service.recoveryRetry(command); break;` add
  `case "retry-task": service.retryTask(command); break;`.

  `src/panel/humanOnly.ts`: after `"recovery-retry": "any",` add `"retry-task": "any",`.

  `web/src/controlTypes.ts`: after `export type RecoveryRetryPayloadV1 = …;` add `export type RetryTaskPayloadV1 = { taskId: string };`;
  in `CommandSuccessV1.verb`, after `"recovery-retry"` add `| "retry-task"`; in its `result` union after the
  `task-continuing` member add `| { kind: "task-retried"; taskId: string; fromRunId: string }`.

  `tests/panel/webParity.test.ts`: import `RetryTaskPayload as ServerRetryTaskPayload` (server list, after
  `RecoveryViewV1 as ServerRecoveryViewV1,`) and `RetryTaskPayloadV1 as WebRetryTaskPayloadV1` (web list, after
  `RecoveryViewV1 as WebRecoveryViewV1,`); after `recoveryRetryWebToServer` add

```ts
// Issue fixes spec §4.2(2): the retry-task command's payload.
function retryTaskServerToWeb(x: ServerRetryTaskPayload): WebRetryTaskPayloadV1 { return x; }
function retryTaskWebToServer(x: WebRetryTaskPayloadV1): ServerRetryTaskPayload { return x; }
```

  and `retryTaskServerToWeb, retryTaskWebToServer,` after `recoveryRetryWebToServer,` in `__webParityAssignabilityChecks__`.

  `skills/orca-control/SKILL.md` route table: after the row
  ``| `POST groups/<groupId>/tasks/<taskId>/loop` | set-task-loop | … |`` insert
  ``| `POST groups/<groupId>/retry-task` | retry-task | `{"taskId":"t1"}` |``.
- [ ] **Step 4: Run, expect PASS.** `npm run typecheck` rc=0; web typecheck rc=0;
  `./node_modules/.bin/vitest run tests/control/retryTask.test.ts tests/entry/skill.test.ts tests/panel/permissions.test.ts tests/panel/humanOnly.test.ts tests/panel/webParity.test.ts tests/control/stopIntent.test.ts > $S/d3b.txt 2>&1; echo rc=$?`
  rc=0 (`permissions.test.ts` walks the routes against `VERB_ACCESS`; `stopIntent.test.ts` guards `releaseCommitment`).
- [ ] **Step 5: Mutation.** (a) Delete `reserveCommitment(store, groupId, grant);` → the `committedRemaining` expectation
  red (and the view reads `recovery-blocked live-ledger-conservation`). (b) Delete `releaseCommitment(store, groupId, remaining);`
  → same `it` red at `committedRemaining`. (c) Change `saveRunBody(…, false)` to `saveRunBody(…, null)` (run stays
  active) → red at `active(t, runId)` and the view (`run-state:`). (d) Delete `work.status = "ready";` → red at
  `work(t, "a")`. (e) Delete `endedAt: store.now(),` → red at `toBeGreaterThanOrEqual`. (f) Delete either
  `recordActivity` call → red at the activity `toEqual`. (g) `drive: { ...drive, cleanedUp: false }`: **no mutation can
  go red** — a run blocked at C was never cleaned, so the field is already `false`; the spec asks for it to be set
  (flagged). (h) Remove the route object → `tests/entry/skill.test.ts` and `tests/panel/permissions.test.ts` red.
- [ ] **Step 6: Commit.** `git -C $W add src/control/webProtocol.ts src/control/stopIntent.ts src/control/retryTask.ts src/control/webService.ts src/panel/controlApi.ts src/panel/humanOnly.ts web/src/controlTypes.ts tests/panel/webParity.test.ts skills/orca-control/SKILL.md tests/entry/skill.test.ts tests/control/retryTask.test.ts`;
  message `feat(control): add retry-task, settling a terminally failed run and returning its task to ready`.

---

