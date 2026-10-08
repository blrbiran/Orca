## Part D — Failure reason and retry-task (spec §4)

> **Controller amendment (2026-10-08, binding over the task text below).** Part B owns `run-settled` rows and `endedAt`
> through its run-write choke point (`noteRunWrite` in `saveRun`/`saveRunBody`/`saveDispatchRun`, with
> `RUN_ENDED_STATES`). Part D therefore: (1) adds `"settled-failed"` to `RUN_ENDED_STATES`; (2) does **not** set
> `endedAt` and does **not** call `recordActivity(... "run-settled" ...)` in `applyRetryTask` — delete those two
> statements from the D3 code; `applyRetryTask` writes only the `task-retried` row; (3) keeps the D3 test assertions
> (exactly one `run-settled` row with state `settled-failed`, `endedAt` set) — they now pin Part B's choke point for the
> new state; (4) replaces mutations (e)/(f) with: remove `"settled-failed"` from `RUN_ENDED_STATES` ⇒ the `endedAt` and
> `run-settled` assertions go red. Run-reason prefix: `reasonCode` strips one leading `Error: ` before calling Part A's
> `explainRunReason` (Part A unchanged).

Spec: `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §4 (with §0 H2/H3, §8, §9 step 5, §10 C1–C3, I5).
Runs after Parts A and B. Consumes, exactly as fixed in the plan's "Shared interfaces":

- Part B: `src/control/activity.ts` `recordActivity(store, row)`, `readRunActivity(store, runId, limit)`; `ControlStore.now()`;
  run body `endedAt?: number` (already allowed by Part B in `persistedRunSchema`).
- Part A: `web/src/locales/en.ts` `enErrors`, `web/src/locales/zh.ts` `zhErrors` (placeholders `{{message}}`, `{{status}}`,
  `{{detail}}` = the server message after `<code>:`); `web/src/refusalExplain.ts` `explainRunReason(reason): string | null`
  (looks the reason up in the current language's errors table by its prefix up to the first `:`).

Produces (Part E consumes): drive record `stopReason?: string`; run view `stopReason` and `outcome` (`string | null`,
optional on the wire, always given by the server); run state `settled-failed`; verb `retry-task` (payload `{ taskId }`,
result `{ kind: "task-retried", taskId, fromRunId }`); codes `task-not-retryable` (409), `run-terminal-failed` (409);
`web/src/runFacts.ts` `isTerminalFailure(run)`, `reasonCode(reason)`, `runReasonText(run)`, `taskRunNumber(view, taskId)`.
Part D does **not** refuse archived groups; Part E adds `group-archived` to `retry-task`.

Line numbers below were measured on `fix/issues-20261008` at `b04e2cb` (before Parts A–C); Parts A–C move them. Every edit
therefore names its anchor text; find the anchor, not the line.

### Conventions for every task in this part

- `$W` = `/Users/biran/code/skills/loop/Orca-issues`; `$S` = the executor's session scratchpad directory.
- Run one Orca test file: `cd $W && ./node_modules/.bin/vitest run <file> > $S/<name>.txt 2>&1; echo rc=$?`, then read
  `$S/<name>.txt` whole (Rule 14: never pipe it through grep/tail/head).
- Run one web test file: `cd $W/web && ../node_modules/.bin/vitest run <file> > $S/<name>.txt 2>&1; echo rc=$?`.
- Typecheck: `cd $W && npm run typecheck > $S/tc.txt 2>&1; echo rc=$?`; web: `cd $W/web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/wtc.txt 2>&1; echo rc=$?`.
- **Mutation protocol (Rule 15).** Step 5 runs *after* the task's commit (Step 6), because `git clone --local` copies
  commits only. Before and after: `git -C $W diff > $S/d.txt; wc -c < $S/d.txt` and
  `git -C $W diff --cached > $S/dc.txt; wc -c < $S/dc.txt` both print `0`. Then
  `git clone --local $W $S/mut-<task> && ln -s /Users/biran/code/skills/loop/Orca/node_modules $S/mut-<task>/node_modules && ln -s /Users/biran/code/skills/loop/Orca/web/node_modules $S/mut-<task>/web/node_modules`;
  apply the named edit in the clone only; when a web file is involved run `npm run build --workspace web` in the clone
  first; run the named test in the clone with output to `$S/mut-<task>-<n>.txt`; read it whole; it must fail on the named
  assertion. A mutation that stays green is a defect of the criterion: fix the criterion in `$W` with a **new** commit.
- Commits: `git -C $W add <explicit paths>` only (never `-A`/`.`); message ends with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

### Existing tests rewritten by this part (human-approved where the spec requires it)

1. `tests/entry/skill.test.ts` — "lists exactly the panel's mutation routes, so the table cannot drift":
   `expect(routes.size).toBe(29);` → `expect(routes.size).toBe(30);` (and its comment `29 routes carry the 30 verbs` →
   `30 routes carry the 31 verbs`, naming `groups/<groupId>/retry-task`). Required by spec §4.2(2) (a new routed verb).
2. Same file — "names the verb of every route as the panel does": `expect(verbs.size).toBe(29);` → `toBe(30)`. Same reason.
3. Same file — "gives every route a payload example that its raw payload schema accepts": `expect(rows.length).toBe(29);`
   → `toBe(30)`, and `schemaByVerb` gains `"retry-task": retryTaskPayloadSchema`. Same reason.
4. `tests/panel/webParity.test.ts` — compile-time half: two new functions and two entries in
   `__webParityAssignabilityChecks__` (additions; no existing assertion changes). Spec §4.2(2), §4.2(4).

No other existing assertion changes. `tests/control/ccloopPort.test.ts` "preserves a Codex skills failure reason from
ccloop terminal state" stays as it is and keeps passing (a skills reason is still kept). `web/tests/driverRetry.test.tsx`'s
two existing `it`s stay as they are (a blocked run with no outcome still gets "Retry run"; spec §4.2(5) second bullet).

---

### Task D1: The port keeps ccloop's stop reason for every terminal, bounded

**Files:**
- Modify: `src/control/driveRecord.ts` (after `driveStepSchema`/`DriveStep`, lines 14–16)
- Modify: `src/control/ccloopPort.ts` (imports lines 1–12; `collect`, line 125)
- Test: `tests/control/ccloopPort.test.ts` (append after the last `it`, line 214–217)

**Interfaces:**
- Produces: `export const STOP_REASON_MAX = 500;` and `export function boundStopReason(reason: string): string` in
  `driveRecord.ts`; `ExecutionReport.terminal.stopReason` is now set for every terminal that carries a non-empty reason.

- [ ] **Step 1: Write the failing test.** Append to `tests/control/ccloopPort.test.ts`:

```ts
// Issue fixes spec §4.2(1) (issue 15): the port kept ccloop's reason only for a codex-skills failure, so
// codex-result-invalid never reached the store. Every terminal's reason is kept now, its first 500 UTF-16 units.
const FAILED_TERMINAL = { status: "failed", currentAttempt: 1, attemptsUsed: 1, lastTransitionAt: "2026-10-08T00:00:00Z", waitingOnHuman: false, stopReason: null as string | null,
  budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 100, tokenBudgetRemaining: 100 }, recentFailures: [] };
it("keeps ccloop's stop reason for any terminal, not only a skills failure", async () => {
  const reason = "Error: codex-result-invalid: /runs/r/attempt-1/execute-result.json";
  const h = await fixture("ok", { terminal: { ...FAILED_TERMINAL, stopReason: reason } });
  expect((await h.port.collect(h.envelope, 0)).terminal).toMatchObject({ outcome: "failed", stopReason: reason });
});
it("keeps only the first 500 UTF-16 units of a longer stop reason", async () => {
  const h = await fixture("ok", { terminal: { ...FAILED_TERMINAL, stopReason: `${"x".repeat(499)}中文 and the rest` } });
  expect((await h.port.collect(h.envelope, 0)).terminal!.stopReason).toBe(`${"x".repeat(499)}中`);
});
it("states no stop reason when ccloop gave none", async () => {
  const h = await fixture("ok", { terminal: { ...FAILED_TERMINAL, stopReason: null } });
  expect("stopReason" in (await h.port.collect(h.envelope, 0)).terminal!).toBe(false);
});
```

- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/ccloopPort.test.ts > $S/d1.txt 2>&1; echo rc=$?`
  → rc=1; "keeps ccloop's stop reason for any terminal" fails (`stopReason` missing from the terminal) and "keeps only the
  first 500" fails (`undefined` ≠ the 500-unit string). "states no stop reason" passes already.
- [ ] **Step 3: Implement.** In `src/control/driveRecord.ts`, after `export type DriveStep = z.infer<typeof driveStepSchema>;`:

```ts
/**
 * Issue fixes spec §4.2(1): the most of ccloop's terminal `stopReason` Orca keeps, in UTF-16 code units. ccloop states
 * the reason first and the evidence path after it, so the cut keeps what the panel explains.
 */
export const STOP_REASON_MAX = 500;
export function boundStopReason(reason: string): string {
  return reason.length > STOP_REASON_MAX ? reason.slice(0, STOP_REASON_MAX) : reason;
}
```

  In `src/control/ccloopPort.ts` add the import after `import { byModelSchema } from "./usageLedger.js";`:

```ts
import { boundStopReason } from "./driveRecord.js";
```

  and in `collect` (line 125) replace exactly
  `...(response.terminal.stopReason?.includes("codex-skills-")?{stopReason:response.terminal.stopReason}:{})`
  with
  `...(response.terminal.stopReason?{stopReason:boundStopReason(response.terminal.stopReason)}:{})`.
- [ ] **Step 4: Run, expect PASS.** Same command → rc=0, the whole file green (the skills-reason `it` included).
- [ ] **Step 5: Mutation.** (a) In the clone, put back `?.includes("codex-skills-")?…:{}` (the old condition) → "keeps
  ccloop's stop reason for any terminal" red. (b) Replace `boundStopReason(response.terminal.stopReason)` with
  `response.terminal.stopReason` → "keeps only the first 500 UTF-16 units" red. (c) Replace the whole spread with
  `stopReason:response.terminal.stopReason` → "states no stop reason when ccloop gave none" red.
- [ ] **Step 6: Commit.** `git -C $W add src/control/driveRecord.ts src/control/ccloopPort.ts tests/control/ccloopPort.test.ts`;
  message `fix(control): keep ccloop's stop reason for every terminal report, bounded to 500 units`.

---

### Task D2: The drive record and run view carry the reason; `settled-failed` in every reader

**Files:**
- Modify: `src/control/driveRecord.ts` (`driveRecordSchema`, lines 47–76)
- Modify: `src/control/executionDriver.ts` (`stepC`, the `if (outcome !== "succeeded")` block, lines 533–537)
- Modify: `src/panel/controlViews.ts` (`persistedRunSchema.state` lines 157–161; `displayRunState` lines 650–659;
  `runViews` terminal list line 699; run view object line 762)
- Modify: `src/control/webProtocol.ts` (`runViewSchema`, lines 1151–1182)
- Modify: `src/control/budget.ts` (`isTerminalRunState`, lines 64–66)
- Modify: `src/control/singleCallLedger.ts` (`STOPPED_STATES`, line 66)
- Modify: `web/src/controlTypes.ts` (`RunViewV1`, lines 214–235)
- Modify: `web/src/locales/en.ts` (`runState`, lines 57–61); `web/src/locales/zh.ts` (`runState`, lines 688–691)
- Modify: `tests/control/fixtures/driverPort.ts` (`FakeBehaviour` line 15; `fakeCcloopPort` input lines 45–56;
  `execute` lines 84 and 110); `tests/control/fixtures/driverHarness.ts` (`HarnessOptions`, `fakeCcloopPort` call)
- Create: `tests/control/retryTask.test.ts`

**Interfaces:**
- Consumes: `boundStopReason` (D1, used by the port only).
- Produces: `DriveRecord.stopReason?: string`; `RunViewV1.stopReason?: string | null`, `RunViewV1.outcome?: string | null`
  (server and web); run state `"settled-failed"` accepted by `persistedRunSchema`, `displayRunState`, the view's terminal
  list, `isTerminalRunState`, `STOPPED_STATES`, `runViewSchema`, web `RunViewV1`, en/zh `runState`. Fixture:
  `FakeBehaviour` gains `"failed"`; `fakeCcloopPort`/`driverHarness` accept `stopReason?: (workItemId: string) => string | null`.

Readers of the run-state vocabulary, re-grepped (`grep -rn "failed-before-provider\|settled-restartable" src web/src`) at
`b04e2cb`: the eight listed in spec §4.2(4) are all edited here. The others found need no change, and why:
`src/control/types.ts:73` (the legacy `RunView` union; a legacy run never becomes `settled-failed`);
`src/control/recovery.ts:24-44` (with a driver, Web runs are skipped; without one it already treats every non-`settled`
Web run alike, `settled-restartable` included); `src/control/continuation.ts:265` and `src/control/resumeBundle.ts:92`
(they accept only `failed-before-provider` / `settled`/`settled-recoverable`, so `settled-failed` is correctly refused);
`src/control/stopIntent.ts:60` `SETTLED_STATES` (handoff **request** states, not run states);
`src/control/driverHandoff.ts:79-` `stepH` (only runs with an open request, which `retry-task` refuses).

- [ ] **Step 1: Write the failing test.** Fixture first (a fake that can fail with a reason). In
  `tests/control/fixtures/driverPort.ts`:
  - `export type FakeBehaviour = "succeed" | "unknown" | …` → add `| "failed"` after `| "exhausted"` on that first line, with
    the comment `// Issue fixes spec §4.4: \`failed\` ends the run failed, as ccloop does when a phase fails.` above the type.
  - In the `fakeCcloopPort(input: {…})` parameter type add, after `acceptedConfigHash?: …;`:

```ts
  /** Issue fixes spec §4.4: ccloop's terminal `stopReason` for this work item's run; null or absent = none stated. */
  stopReason?: (workItemId: string) => string | null;
```

  - Replace `const outcome = input.behaviour(claim.workItemId) === "exhausted" ? "exhausted" : "succeeded";` with:

```ts
    const outcome = variant === "exhausted" ? "exhausted" : variant === "failed" ? "failed" : "succeeded";
    const stopReason = input.stopReason?.(claim.workItemId) ?? null;
```

  - Replace `return { events, candidate, terminal: stop.terminal ? { outcome, attemptSha: null, sourceDir: work.sourceDir, repoDir: repo } : null };` with:

```ts
    return { events, candidate, terminal: stop.terminal ? { outcome, attemptSha: null, sourceDir: work.sourceDir, repoDir: repo, ...(stopReason === null ? {} : { stopReason }) } : null };
```

  In `tests/control/fixtures/driverHarness.ts`, `HarnessOptions` gains after `agentKinds?: AgentsView;`:

```ts
  /** Issue fixes spec §4.4: the stop reason the synthetic ccloop states with a run's terminal (driverPort.ts). */
  stopReason?: (workItemId: string) => string | null;
```

  and the `fakeCcloopPort({ … })` call gains, after the `acceptedConfigHash` spread:
  `...(options.stopReason ? { stopReason: options.stopReason } : {}),`.

  Create `tests/control/retryTask.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { recordUsage } from "../../src/control/usage.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import type { WebFixtureTask } from "./fixtures/web.js";

/**
 * Issue fixes spec §4 (issue 16, Orca's side of issue 15): ccloop's failure reason is kept, `retry-task` settles a run
 * ccloop ended failed as `settled-failed` and returns its task to `ready`, the driver archives and cleans that run, and
 * normal dispatch starts the task again from the group branch. Driven through the driver's synthetic ccloop
 * (fixtures/driverPort.ts); the real-ccloop scenario is in executionDriverE2E.test.ts.
 */

/** What ccloop reports for issue 15: PhaseExecutionError's message is String(error), so `Error: ` comes first. */
const FAILED_REASON = "Error: codex-result-invalid: /runs/run-x/attempt-1/execute-result.json";
type Harness = Awaited<ReturnType<typeof driverHarness>>;

/**
 * Task `a`'s runs end `failed` with FAILED_REASON until `succeedNext()`; every other task succeeds. The group limit gets
 * ten more attempts and sessions, so several retries fit (each re-reserves the failed run's one attempt and one session).
 */
async function failingHarness(tasks: readonly WebFixtureTask[] = [{ taskId: "a" }], files?: (workItemId: string) => Record<string, string>) {
  let failing = true;
  const t = await driverHarness(tasks, {
    behaviour: (id) => (id === "a" && failing ? "failed" : "succeed"),
    stopReason: (id) => (id === "a" && failing ? FAILED_REASON : null),
    ...(files === undefined ? {} : { files }),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  return { t, succeedNext: (): void => { failing = false; } };
}
const view = (t: Harness) => readControlGroup(t.h.store, "epoch-test", "g");
/** Claim task a's run and drive it until ccloop's terminal blocks it at C. */
async function failedRun(t: Harness): Promise<{ runId: string; driver: ReturnType<Harness["driver"]> }> {
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  return { runId, driver };
}

describe("keeping ccloop's failure reason (spec §4.2(1))", () => {
  it("stores ccloop's stop reason on the drive record and gives it, with the outcome, to the run view", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:failed", outcome: "failed", stopReason: FAILED_REASON });
      expect(view(t).runs.find((run) => run.runId === runId)).toMatchObject({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: FAILED_REASON });
    } finally { await t.h.dispose(); }
  });

  it("stores no stop reason when ccloop stated none, and the view says null", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted" }); try {
      const { runId } = await failedRun(t);
      expect("stopReason" in t.body(runId).drive).toBe(false);
      expect(view(t).runs.find((run) => run.runId === runId)).toMatchObject({ outcome: "exhausted", stopReason: null });
    } finally { await t.h.dispose(); }
  });
});

describe("settled-failed in every reader (spec §4.2(4), review C2)", () => {
  it("renders a settled-failed run in the group view and refuses it any further usage", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      // A stand-in for retry-task (Task D3), the state's only writer: the run alone, made inactive.
      t.h.store.transaction(() => {
        const run = t.body(runId);
        run.state = "settled-failed";
        t.h.store.db.prepare("UPDATE runs SET body=?, active=0 WHERE id=?").run(JSON.stringify(run), runId);
      });
      expect(view(t).runs.map((run) => [run.runId, run.state])).toEqual([[runId, "settled-failed"]]);
      expect(() => recordUsage(t.h.store, { runId, generation: 1, eventSeq: 3, bucket: "work", cumulative: { tokens: 11, activeMs: 5, attempts: 1, sessions: 1 }, source: { artifactId: "late-usage", hash: "0".repeat(64) } }))
        .toThrow("run-already-settled");
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/retryTask.test.ts > $S/d2.txt 2>&1; echo rc=$?`
  → rc=1: the first `it` fails (`stopReason` absent from the drive record), the second fails (`outcome`/`stopReason`
  absent from the view), the third fails with `recovery-blocked` `run-invalid:<runId>:…` (the state is not in the enum).
- [ ] **Step 3: Implement.**
  `src/control/driveRecord.ts`, in `driveRecordSchema`, after the `skills: …default(null),` entry:

```ts
  // Issue fixes spec §4.2(1): ccloop's own reason for the terminal it reported (the port keeps the first STOP_REASON_MAX
  // units), stored when the run blocks on a terminal other than `succeeded`. Optional: absent when ccloop stated none and
  // in every drive record written before it existed; the v9 store keeps an older Orca from reading one.
  stopReason: z.string().min(1).optional(),
```

  `src/control/executionDriver.ts`, `stepC`, replace

```ts
  if (outcome !== "succeeded") {
    blockRun(deps, runId, "C", report.terminal.stopReason?.includes("codex-skills-") ? report.terminal.stopReason : `terminal:${outcome}`, { outcome });
    return true;
  }
```

  with

```ts
  if (outcome !== "succeeded") {
    // Issue fixes spec §4.2(1): ccloop's reason is kept beside the outcome (the run view and the panel explain it); the
    // blocked reason is unchanged.
    const stopReason = report.terminal.stopReason ? { stopReason: report.terminal.stopReason } : {};
    blockRun(deps, runId, "C", report.terminal.stopReason?.includes("codex-skills-") ? report.terminal.stopReason : `terminal:${outcome}`, { outcome, ...stopReason });
    return true;
  }
```

  `src/panel/controlViews.ts`:
  - `persistedRunSchema.state`: the line `"settled-recoverable", "settled-restartable", "settled-unrecoverable",` becomes
    `"settled-recoverable", "settled-restartable", "settled-unrecoverable", "settled-failed",` with the comment line
    `// Issue fixes spec §4.2(2): a run ccloop ended failed, settled by retry-task (inactive, its task back to ready).` above it.
  - `displayRunState`: `case "settled-recoverable": case "settled-restartable": case "settled-unrecoverable": return run.state;`
    becomes `case "settled-recoverable": case "settled-restartable": case "settled-unrecoverable": case "settled-failed": return run.state;`.
  - `runViews`: `const terminal = ["failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable"].includes(state);`
    becomes `const terminal = ["failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable", "settled-failed"].includes(state);`.
  - The run view object: after `blockedReason: run.drive?.blockedReason ?? null,` add

```ts
      // Issue fixes spec §4.2(1), (5): ccloop's reason, and the outcome the Retry-task button keys on.
      stopReason: run.drive?.stopReason ?? null,
      outcome: run.drive?.outcome ?? null,
```

  `src/control/webProtocol.ts`, `runViewSchema`: in `state: z.enum([…])` after `"settled-unrecoverable",` add
  `"settled-failed",`; after `blockedReason: nonemptyString.nullable(),` add

```ts
    // Issue fixes spec §4.2(1), (5): ccloop's own reason for the terminal it reported, and the drive record's outcome (the
    // Retry-task button keys on it). Optional on the wire like `git`; the server always gives both, null when absent.
    stopReason: nonemptyString.nullable().optional(),
    outcome: nonemptyString.nullable().optional(),
```

  `src/control/budget.ts`: `return state==="settled" || ["failed-before-provider","settled-recoverable","settled-restartable","settled-unrecoverable"].includes(state);`
  → `return state==="settled" || ["failed-before-provider","settled-recoverable","settled-restartable","settled-unrecoverable","settled-failed"].includes(state);`

  `src/control/singleCallLedger.ts`: `const STOPPED_STATES = ["failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable"];`
  → `const STOPPED_STATES = ["failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable", "settled-failed"];`
  (spec §4.2(4) lists it; see Step 5 for why no criterion can tell).

  `web/src/controlTypes.ts`, `RunViewV1`: in `state:` insert `| "settled-failed"` after `"settled-unrecoverable"`; after
  `blockedReason?: string | null;` add

```ts
  /** Issue fixes spec §4.2(1), (5): ccloop's reason and the drive record's outcome; optional here so literal fixtures need no edit. */
  stopReason?: string | null;
  outcome?: string | null;
```

  `web/src/locales/en.ts` `runState`: after `"settled-unrecoverable": "settled-unrecoverable",` add `"settled-failed": "settled-failed",`.
  `web/src/locales/zh.ts` `runState`: after `"settled-unrecoverable": "已结算（不可恢复）",` add `"settled-failed": "已结算（失败）",`.
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0. Then `npm run typecheck` rc=0 (the exhaustive
  `displayRunState` and the `satisfies Record<RunViewV1["state"], string>` on both `runState` tables compile), the web
  typecheck rc=0, and `./node_modules/.bin/vitest run tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/panel/webParity.test.ts > $S/d2b.txt 2>&1; echo rc=$?` rc=0
  (the fixture change keeps every existing behaviour: `exhausted` still ends `exhausted`, no reason is stated unless asked).
- [ ] **Step 5: Mutation.** (a) Drop `...stopReason` from the `blockRun` patch in `stepC` → "stores ccloop's stop reason
  on the drive record" red at the `drive` `toMatchObject`. (b) Delete the two view lines `stopReason:`/`outcome:` →
  both `it`s of the first describe red at the view `toMatchObject`. (c) Remove `"settled-failed"` from
  `persistedRunSchema.state` → "renders a settled-failed run" red (`run-invalid`). (d) Remove it from the `runViews`
  terminal list → same `it` red (`run-state:<runId>`). (e) Remove it from `isTerminalRunState` → same `it` red at
  `toThrow("run-already-settled")`. (f) Remove the `case "settled-failed":` from `displayRunState` → `npm run typecheck`
  red (not all code paths return). (g) `STOPPED_STATES`: **no mutation can go red** — `verifyStoppedSingleCall` also
  requires `active=1`, and only a task run ever becomes `settled-failed`; the entry is vocabulary the spec asks for
  (flagged in the part report).
- [ ] **Step 6: Commit.** `git -C $W add src/control/driveRecord.ts src/control/executionDriver.ts src/panel/controlViews.ts src/control/webProtocol.ts src/control/budget.ts src/control/singleCallLedger.ts web/src/controlTypes.ts web/src/locales/en.ts web/src/locales/zh.ts tests/control/fixtures/driverPort.ts tests/control/fixtures/driverHarness.ts tests/control/retryTask.test.ts`;
  message `feat(control): keep ccloop's stop reason on the run and add the settled-failed run state to every reader`.

---

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

### Task D4: `retry-task`'s preconditions and refusals

**Files:**
- Modify: `src/control/errors.ts` (409 block, after `"task-loop-version-conflict": 409,`, line 85)
- Modify: `src/control/retryTask.ts` (the `apply` body, D3)
- Modify: `web/src/locales/en.ts` (`enErrors`, Part A), `web/src/locales/zh.ts` (`zhErrors`)
- Test: `tests/control/retryTask.test.ts`

**Interfaces:**
- Produces: durable code `task-not-retryable` (409) with details `no-run`, `run-state:<state>`, `blocked-at:<step|none>`,
  `outcome:<outcome|none>`, `handoff-request-open:<requestId>`, `usage-unknown`, `usage-pending`; existing codes
  `group-state-invalid` (detail `clarifying`), `stop-mode-conflict`, `group-reserve-insufficient` (detail
  `<dimension>:<shortfall>`) from `retry-task`.

- [ ] **Step 1: Write the failing test.** Add `import { writeHandoffRequest } from "../../src/control/stopIntent.js";`
  to the test's imports, and after `retry`:

```ts
/** A direct edit of one run body, for a state no fake produces on its own. */
const poke = (t: Harness, runId: string, change: (run: Record<string, any>) => void): void => t.h.store.transaction(() => {
  const run = t.body(runId);
  change(run);
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
});
const refusal = (result: ReturnType<typeof retry>) => ("error" in result ? { code: result.error.code, message: result.error.message } : { code: "accepted", message: "" });
/** Nothing moved: the run is still blocked and active, and no task-retried row was written. */
const unchanged = (t: Harness, runId: string): void => {
  expect(t.body(runId).state).toBe("blocked");
  expect(active(t, runId)).toBe(1);
  expect(readRunActivity(t.h.store, runId, 50).some((entry) => entry.kind === "task-retried")).toBe(false);
};
```

  and a new describe:

```ts
describe("retry-task refusals (spec §4.2(2), §4.4)", () => {
  it("refuses a task with no run, and a task whose run is still healthy", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:no-run" });
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:run-state:accepted" });
      expect(active(t, runId)).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("refuses a run blocked for any other reason: a succeeded run out of bounds, a transient failure, another step", async () => {
    const outOfBounds = await failingHarness([{ taskId: "a" }], () => ({ "elsewhere.txt": "x\n" })); try {
      outOfBounds.succeedNext();
      const { runId } = await failedRun(outOfBounds.t);
      expect(outOfBounds.t.body(runId).drive).toMatchObject({ blockedAt: "C", outcome: "succeeded" });
      expect(refusal(retry(outOfBounds.t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:outcome:succeeded" });
      unchanged(outOfBounds.t, runId);
    } finally { await outOfBounds.t.h.dispose(); }
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      // A collect that failed transiently blocks at C with no outcome (blockedStaysPut.test.ts).
      poke(t, runId, (run) => { run.drive.outcome = null; run.drive.blockedReason = "control-peer-timeout"; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:outcome:none" });
      poke(t, runId, (run) => { run.drive.outcome = "failed"; run.drive.blockedAt = "E"; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:blocked-at:E" });
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });

  it("refuses while a handoff request is open, usage is unknown, or a usage event is pending (releaseRunReserve's conditions)", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      t.h.store.transaction(() => writeHandoffRequest(t.h.store, { requestId: "handoff-open", runId, state: "request-pending", deadlineAt: "2099-01-01T00:00:00.000Z", phaseAttemptOrdinal: 2, failureCode: null, evidenceIds: [] }, "g"));
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:handoff-request-open:handoff-open" });
      t.h.store.transaction(() => t.h.store.db.prepare("DELETE FROM handoff_requests WHERE id='handoff-open'").run());
      poke(t, runId, (run) => { run.unknown.work = true; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:usage-unknown" });
      poke(t, runId, (run) => { run.unknown.work = false; });
      t.h.store.transaction(() => t.h.store.db.prepare("INSERT INTO usage_events VALUES (?,?,?,?)").run(runId, t.body(runId).highWater + 1, "0".repeat(64), "{}"));
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:usage-pending" });
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });

  it("refuses a stopped group with stop-mode-conflict and a clarifying group with group-state-invalid", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const paused = await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect("error" in paused ? paused.error : "paused").toBe("paused");
      expect(refusal(retry(t)).code).toBe("stop-mode-conflict");
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
    const clarifying = await failingHarness(); try {
      const { runId } = await failedRun(clarifying.t);
      clarifying.t.h.store.transaction(() => clarifying.t.h.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','clarifying') WHERE id='g'").run());
      expect(refusal(retry(clarifying.t))).toEqual({ code: "group-state-invalid", message: "group-state-invalid:clarifying" });
      unchanged(clarifying.t, runId);
    } finally { await clarifying.t.h.dispose(); }
  });

  it("refuses when the reserve cannot cover the new run, naming the dimension and the shortfall, and changes nothing", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const ledger = readWebGroup(t.h.store, "g").ledger;
      // No token left unallocated: the limit is what is used plus what is committed.
      const lowered = t.service.setLimit(t.h.command("set-limit", { limit: { ...ledger.groupLimit, tokens: ledger.used.tokens + ledger.committedRemaining.tokens } }));
      expect("error" in lowered ? lowered.error : "lowered").toBe("lowered");
      const before = readWebGroup(t.h.store, "g").ledger;
      expect(before.explicitUnallocatedReserve.tokens).toBe(0);
      expect(netOf(t.body(runId)).tokens).toBe(10);
      expect(refusal(retry(t))).toEqual({ code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:10" });
      expect(readWebGroup(t.h.store, "g").ledger).toEqual(before);
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/retryTask.test.ts > $S/d4.txt 2>&1; echo rc=$?`
  → rc=1; every `it` of "retry-task refusals" fails (the command is accepted, or throws `run-not-found`/a TypeError for
  the task with no run).
- [ ] **Step 3: Implement.** `src/control/errors.ts`, in the 409 block, after `"task-loop-version-conflict": 409,` add

```ts
  // Issue fixes spec §4.2(2): retry-task on a task whose current run is not one ccloop ended failed (the detail names why).
  "task-not-retryable": 409,
```

  `src/control/retryTask.ts`: add to the imports `import { dimensions } from "./commands.js";`,
  `import { ControlError } from "./errors.js";`, `readBudgetProposal` to the `./queries.js` import, and `ADOPTABLE_STATES`,
  `latestRequestForRun`, `readGroupBody`, `readStopIntent` to the `./stopIntent.js` import. In `apply`, replace the four lines
  from `const work = readWork(store, groupId, taskId) as unknown as RetriedWork;` through `const drive = run.drive as DriveRecord;` with:

```ts
        // Spec §4.2(2), in the spec's order. Archived groups are refused by Part E (group-archived).
        const group = readGroupBody(store, groupId);
        if (group.status === "clarifying") throw new ControlError("group-state-invalid", "clarifying");
        if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("stop-mode-conflict");
        const work = readWork(store, groupId, taskId) as unknown as RetriedWork;
        if (typeof work.currentRunId !== "string") throw new ControlError("task-not-retryable", "no-run");
        const runId = work.currentRunId;
        const run = readRunBody(store, runId);
        const live = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active ?? 0) === 1;
        if (!live || run.state !== "blocked") throw new ControlError("task-not-retryable", `run-state:${run.state}`);
        const drive = run.drive as DriveRecord | undefined;
        if (drive === undefined || drive.blockedAt !== "C") throw new ControlError("task-not-retryable", `blocked-at:${drive?.blockedAt ?? "none"}`);
        // A codex-skills-* failure sets an outcome too (review C3), so it is retryable like any other ccloop failure.
        if (drive.outcome === null || drive.outcome === "succeeded") throw new ControlError("task-not-retryable", `outcome:${drive.outcome ?? "none"}`);
        // releaseRunReserve's conditions (budget.ts): no request still owns the run, and its usage is known and complete.
        const request = latestRequestForRun(store, groupId, runId);
        if (request !== null && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("task-not-retryable", `handoff-request-open:${request.requestId}`);
        if (run.unknown.work || run.unknown.handoff) throw new ControlError("task-not-retryable", "usage-unknown");
        if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(runId, Number(run.highWater))) throw new ControlError("task-not-retryable", "usage-pending");
```

  and replace the line `const grant = both(work.grant), remaining = both(run.remaining);` with:

```ts
        // The new run is claimed at the task's current grant (after a continuation, the continuation's), so the net new
        // reservation is grant - remainder in each dimension; it must fit the group's unallocated reserve.
        const grant = both(work.grant), remaining = both(run.remaining);
        const reserve = readBudgetProposal(store, groupId).explicitUnallocatedReserve;
        for (const d of dimensions) {
          const shortfall = grant[d] - remaining[d] - reserve[d];
          if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
        }
```

  `web/src/locales/en.ts`, `enErrors` (keep its key order):

```ts
  "task-not-retryable": "This task cannot be retried now ({{detail}}). Retry task is for a task whose run ended in a ccloop failure; a run blocked for another reason has Retry run.",
```

  `web/src/locales/zh.ts`, `zhErrors` (after `"task-already-started": …,`):

```ts
  "task-not-retryable": "这个任务现在不能重试（{{detail}}）。「重试任务」只用于运行以 ccloop 失败结束的任务；因别的原因阻塞的运行请用「重试运行」。",
```

  The existing `group-reserve-insufficient` entries (both locales) already point at the budget editor through Part A's
  text; if Part A's en entry does not name the budget editor, change it to
  `"The group's unallocated reserve is short by {{detail}} (dimension:amount). Raise the group limit in the budget editor, then try again."`
  and the zh one to `"组的未分配余量不够（{{detail}}，维度:差额）。请在预算编辑里调高组上限后再试。"` (spec §4.2(2) "the explanation points at the budget editor").
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0. `npm run typecheck` rc=0.
  `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/d4b.txt 2>&1; echo rc=$?` rc=0 (the new catalog
  code has text in both locales).
- [ ] **Step 5: Mutation.** One guard at a time; the named `it` must go red at the named expectation:
  `no-run` guard → "refuses a task with no run…" (first `toEqual`); `run-state` guard → same `it`, second `toEqual`;
  `outcome` guard → "refuses a run blocked for any other reason…" (`outcome:succeeded`); `blocked-at` guard → same `it`
  (`blocked-at:E`); handoff guard → "refuses while a handoff request is open…" (first `toEqual`); `usage-unknown` guard →
  same `it`, second; `usage-pending` guard → same `it`, third; stop guard → "refuses a stopped group…"
  (`stop-mode-conflict`); clarifying guard → same `it` (`group-state-invalid:clarifying`); the reserve loop → "refuses when
  the reserve cannot cover…". Delete the en or zh `task-not-retryable` entry → `refusalCoverage.test.ts` red.
- [ ] **Step 6: Commit.** `git -C $W add src/control/errors.ts src/control/retryTask.ts web/src/locales/en.ts web/src/locales/zh.ts tests/control/retryTask.test.ts`;
  message `feat(control): refuse retry-task unless the task's current run ended in a ccloop failure the reserve can retry`.

---

### Task D5: `recovery-retry` refuses a terminally failed run (`run-terminal-failed`)

**Files:**
- Modify: `src/control/driveRecord.ts` (after `RESUME_STATE`, line 82)
- Modify: `src/control/stopIntent.ts` (`retryRun`, lines 466–484; import of `./driveRecord.js`, line 13)
- Modify: `src/control/errors.ts` (409 block, after `"run-owner-conflict": 409,`)
- Modify: `web/src/locales/en.ts` (`enErrors`), `web/src/locales/zh.ts` (`zhErrors`)
- Modify: `skills/orca-control/SKILL.md` (the `Notes:` paragraph under the route table); `tests/entry/skill.test.ts`
- Test: `tests/control/retryTask.test.ts`

**Interfaces:**
- Produces: `export function isTerminallyFailedRun(run: { state: string; drive?: DriveRecord }): boolean` (driveRecord.ts);
  durable code `run-terminal-failed` (409).

- [ ] **Step 1: Write the failing test.** Append to `tests/control/retryTask.test.ts`:

```ts
describe("recovery-retry on a terminally failed run (spec §4.2(3))", () => {
  it("refuses it with run-terminal-failed and leaves it blocked at C; a transiently blocked run still resumes", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const refused = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in refused ? refused.error.code : "resumed").toBe("run-terminal-failed");
      expect(t.body(runId)).toMatchObject({ state: "blocked", drive: { blockedAt: "C", outcome: "failed", blockedReason: "terminal:failed" } });
      poke(t, runId, (run) => { run.drive.outcome = null; run.drive.blockedReason = "control-peer-timeout"; });
      const resumed = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in resumed ? resumed.error : resumed.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId)).toMatchObject({ state: "accepted", drive: { blockedAt: null, blockedReason: null } });
    } finally { await t.h.dispose(); }
  });
});
```

  `tests/entry/skill.test.ts`, in "teaches the rules, the exit codes and the error codes", add to the phrase list (after the
  Task 7 entries): `// Issue fixes spec §4.2(2)-(3): which retry a failed run takes.` then `"run-terminal-failed", "task-not-retryable",`.
- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/retryTask.test.ts tests/entry/skill.test.ts > $S/d5.txt 2>&1; echo rc=$?`
  → rc=1: the new `it` fails (`resumed` ≠ `run-terminal-failed`: today the run goes back to `accepted`); the skill phrases are missing.
- [ ] **Step 3: Implement.** `src/control/driveRecord.ts`, after `RESUME_STATE`:

```ts
/**
 * Issue fixes spec §4.2(3): a run the driver blocked at C because its ccloop run ended with an outcome other than
 * `succeeded`. Sending it back to C would only collect the same terminal again, so recovery-retry refuses it; retry-task
 * (retryTask.ts, which names each failed condition in its refusal) is its way out.
 */
export function isTerminallyFailedRun(run: { state: string; drive?: DriveRecord }): boolean {
  return run.state === "blocked" && run.drive !== undefined && run.drive.blockedAt === "C" && run.drive.outcome !== null && run.drive.outcome !== "succeeded";
}
```

  `src/control/stopIntent.ts`: the import `import { resumeBlockedDriverRun } from "./driveRecord.js";` becomes
  `import { isTerminallyFailedRun, resumeBlockedDriverRun, type DriveRecord } from "./driveRecord.js";`. In `retryRun`, as
  its first statement (before `const blockers = clearedBlockers(store, groupId, runId);`):

```ts
  // Issue fixes spec §4.2(3): checked before anything is cleared, so the refusal leaves the run and its blockers as they were.
  const target = readRunBody(store, runId);
  if (target.groupId === groupId && isTerminallyFailedRun(target as { state: string; drive?: DriveRecord })) throw new ControlError("run-terminal-failed");
```

  `src/control/errors.ts`, after `"run-owner-conflict": 409,`:

```ts
  // Issue fixes spec §4.2(3): recovery-retry on a run ccloop ended failed; only retry-task moves it.
  "run-terminal-failed": 409,
```

  `enErrors`: `"run-terminal-failed": "This run ended in a ccloop failure; retrying the run would only read the same result again. Use Retry task to start a new run of the task.",`
  `zhErrors` (after `"run-not-found": …,`): `"run-terminal-failed": "这个运行已经以 ccloop 失败结束，重试运行只会再读到同样的结果。请用「重试任务」为这个任务开一次新的运行。",`

  `skills/orca-control/SKILL.md`: at the end of the `Notes:` paragraph under the route table append:
  `` `retry-task` starts again a task whose current run ccloop ended failed (in `get groups/<groupId>`, the run is `blocked` with `outcome` set and not `succeeded`): the run becomes `settled-failed` and a new run starts from the group branch's current head; any other task is refused with `task-not-retryable` (409). `recovery-retry` refuses such a run with `run-terminal-failed` (409) and still resumes a run blocked for any other reason. ``
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0; `npm run typecheck` rc=0;
  `./node_modules/.bin/vitest run tests/control/driverRecovery.test.ts tests/control/blockedStaysPut.test.ts tests/control/stopIntent.test.ts tests/panel/refusalCoverage.test.ts > $S/d5b.txt 2>&1; echo rc=$?` rc=0.
- [ ] **Step 5: Mutation.** (a) Delete the `if (… isTerminallyFailedRun …) throw` line → the new `it` red at
  `toBe("run-terminal-failed")`. (b) In `isTerminallyFailedRun` drop `&& run.drive.outcome !== null` → the same `it` red at
  the second half (the transient run is refused instead of resuming). (c) Delete the en or zh entry →
  `refusalCoverage.test.ts` red.
- [ ] **Step 6: Commit.** `git -C $W add src/control/driveRecord.ts src/control/stopIntent.ts src/control/errors.ts web/src/locales/en.ts web/src/locales/zh.ts skills/orca-control/SKILL.md tests/entry/skill.test.ts tests/control/retryTask.test.ts`;
  message `fix(control): refuse recovery-retry on a run ccloop ended failed with run-terminal-failed`.

---

### Task D6: The facts the panel decides a failed run by (pure web helpers)

**Files:**
- Create: `web/src/runFacts.ts`
- Create: `web/tests/runFacts.test.ts`

**Interfaces:**
- Produces: `isTerminalFailure(run: RunViewV1): boolean`; `reasonCode(reason: string): string`;
  `runReasonText(run: RunViewV1): string | null`; `taskRunNumber(view: GroupViewV1, taskId: string): number`. No React, no
  i18n imports (type-only), so `tests/control/*.test.ts` can import it under the root tsconfig.

- [ ] **Step 1: Write the failing test.** Create `web/tests/runFacts.test.ts`:

```ts
/**
 * Issue fixes spec §4.2(5): which runs get "Retry task", which reason a run shows, and the task's run number (the count
 * of its lineage runs that reached the provider, i.e. not failed-before-provider).
 */
import { describe, expect, it } from "vitest";
import type { Amount, GroupViewV1, RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { isTerminalFailure, reasonCode, runReasonText, taskRunNumber } from "../src/runFacts.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const item = (over: Partial<WorkItemViewV1>): WorkItemViewV1 => ({
  taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], ...over,
});
const viewOf = (workItems: WorkItemViewV1[], runs: RunViewV1[]): GroupViewV1 => ({ workItems, runs } as unknown as GroupViewV1);

describe("run facts (spec §4.2(5))", () => {
  it("calls a run a terminal failure only when it is blocked with an outcome other than succeeded", () => {
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed" }))).toBe(true);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "Error: codex-skills-cleanup-failed:EACCES", outcome: "failed" }))).toBe(true);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded" }))).toBe(false);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "control-peer-timeout", outcome: null }))).toBe(false);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "control-peer-timeout" }))).toBe(false);
    expect(isTerminalFailure(run({ state: "settled-failed", outcome: "failed" }))).toBe(false);
  });

  it("reads ccloop's reason code through the Error: prefix its phase errors carry", () => {
    expect(reasonCode("Error: codex-result-invalid: /runs/x")).toBe("codex-result-invalid: /runs/x");
    expect(reasonCode("terminal:failed")).toBe("terminal:failed");
  });

  it("shows ccloop's reason for a failed or settled-failed run, else the blocked reason, else nothing", () => {
    expect(runReasonText(run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /x" }))).toBe("Error: codex-result-invalid: /x");
    expect(runReasonText(run({ state: "blocked", blockedReason: "terminal:exhausted", outcome: "exhausted", stopReason: null }))).toBe("terminal:exhausted");
    expect(runReasonText(run({ state: "settled-failed", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-event-error" }))).toBe("Error: codex-event-error");
    expect(runReasonText(run({ state: "blocked", blockedReason: "reconcile-budget", outcome: "succeeded", stopReason: null }))).toBe("reconcile-budget");
    expect(runReasonText(run({ state: "running" }))).toBe(null);
  });

  it("numbers a task's runs by those of its lineage that reached the provider", () => {
    const runs = [run({ runId: "r1", state: "settled-failed" }), run({ runId: "r2", state: "failed-before-provider" }), run({ runId: "r3", state: "starting" }), run({ runId: "rb", taskId: "b" })];
    expect(taskRunNumber(viewOf([item({ lineageRunIds: ["r1", "r2", "r3"] }), item({ taskId: "b", lineageRunIds: ["rb"] })], runs), "a")).toBe(2);
    expect(taskRunNumber(viewOf([item({ lineageRunIds: [] })], []), "a")).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `cd $W/web && ../node_modules/.bin/vitest run tests/runFacts.test.ts > $S/d6.txt 2>&1; echo rc=$?`
  → rc=1, "Failed to resolve import ../src/runFacts.js".
- [ ] **Step 3: Implement.** Create `web/src/runFacts.ts`:

```ts
/**
 * Issue fixes spec §4.2(5): the facts the runs table and the task detail decide a run's reason and button by. Pure (type
 * imports only, no React or i18n), so the server's criteria compute the same run number the panel shows
 * (tests/control/retryTask.test.ts).
 */
import type { GroupViewV1, RunViewV1 } from "./controlTypes.js";

/** A blocked run whose ccloop run ended with an outcome other than `succeeded`: its button is "Retry task". */
export function isTerminalFailure(run: RunViewV1): boolean {
  return run.state === "blocked" && run.outcome != null && run.outcome !== "succeeded";
}

/**
 * ccloop's phase failures reach Orca as `String(error)` (ccloop runLoop.ts PhaseExecutionError), so the reason code follows
 * an `Error: ` prefix; the explanation tables are keyed by the code.
 */
const ERROR_PREFIX = "Error: ";
export function reasonCode(reason: string): string {
  return reason.startsWith(ERROR_PREFIX) ? reason.slice(ERROR_PREFIX.length) : reason;
}

/** The reason a run shows: ccloop's own for a failed or settled-failed run when it gave one, else the driver's blocked reason. */
export function runReasonText(run: RunViewV1): string | null {
  if (isTerminalFailure(run) || run.state === "settled-failed") return run.stopReason ?? run.blockedReason ?? null;
  return run.state === "blocked" ? run.blockedReason ?? null : null;
}

/** Spec §4.2(2): a task's run number is the count of its lineage runs that reached the provider. */
export function taskRunNumber(view: GroupViewV1, taskId: string): number {
  const lineage = new Set(view.workItems.find((item) => item.taskId === taskId)?.lineageRunIds ?? []);
  return view.runs.filter((run) => lineage.has(run.runId) && run.state !== "failed-before-provider").length;
}
```

- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0; web typecheck rc=0.
- [ ] **Step 5: Mutation.** (a) `isTerminalFailure`: drop `&& run.outcome !== "succeeded"` → first `it` red (out-of-bounds
  line). (b) `reasonCode`: return `reason` unchanged → second `it` red. (c) `runReasonText`: drop the first branch → third
  `it` red (first expectation). (d) `taskRunNumber`: drop `&& run.state !== "failed-before-provider"` → fourth `it` red (3 ≠ 2).
- [ ] **Step 6: Commit.** `git -C $W add web/src/runFacts.ts web/tests/runFacts.test.ts`;
  message `feat(web): decide a run's retry button, reason and run number from the run view`.

---

### Task D7: The driver cleans a settled-failed run; run 2 is claimed and lands (end-to-end, synthetic ccloop)

**Files:**
- Modify: `src/control/executionDriver.ts` (`stepE` end, ~line 727; `driverRunIds` lines 805–816; `advance` lines
  845–854; `pass`'s catch, lines 891–902)
- Test: `tests/control/retryTask.test.ts`

**Interfaces:**
- Consumes: `archiveRun`, `cleanupRunWorkspace`, `savedReport`, `workspaceOf`, `groupRepoId` (all in or imported by
  executionDriver.ts); `taskRunNumber` (D6).
- Produces: `export async function stepCleanupFailed(deps: ExecutionDriverDeps, runId: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test.** Add to the test's imports:

```ts
import { existsSync } from "node:fs";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { taskRunNumber } from "../../web/src/runFacts.js";
```

  and change `import { driverHarness } from "./fixtures/driverHarness.js";` to `import { driverHarness, git } from "./fixtures/driverHarness.js";`.
  After `unchanged` add:

```ts
/** The driver's next round arms a start wake for the ready task (replenishStartWakes); delivering it claims a run. */
async function claimAgain(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}
const archived = (t: Harness, runId: string): number =>
  Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=?").get(runId)!.n);
```

  and append:

```ts
describe("after retry-task: cleanup, a new run, success (spec §4.2(2), §4.4)", () => {
  it("archives and removes the failed run's workspace, claims run 2 from the group branch through normal dispatch, and lands it", async () => {
    const { t, succeedNext } = await failingHarness(); try {
      const { runId, driver } = await failedRun(t);
      const failedDrive = t.body(runId).drive;
      expect(existsSync(failedDrive.workspacePath)).toBe(true);
      expect("error" in retry(t)).toBe(false);
      const head = git(t.repo, "rev-parse", "refs/heads/orca/g");
      succeedNext();
      const second = await claimAgain(t, driver);
      // That same round visited the settled-failed run: archived, its workspace gone, its source directory kept.
      expect(t.body(runId)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: true, cleanupError: null } });
      expect(existsSync(failedDrive.workspacePath)).toBe(false);
      expect(existsSync(failedDrive.sourceDir)).toBe(true);
      expect(archived(t, runId)).toBeGreaterThan(0);
      expect(second).not.toBe(runId);
      expect(work(t, "a")).toMatchObject({ status: "running", currentRunId: second, lineageRunIds: [runId, second].sort() });
      expect(taskRunNumber(view(t), "a")).toBe(2);
      await t.until(driver, () => t.body(second).state === "settled" && t.body(second).drive?.cleanedUp === true);
      expect(t.body(second).drive.base).toBe(head);
      expect(t.body(second).drive.workspacePath).not.toBe(failedDrive.workspacePath);
      expect(work(t, "a")).toMatchObject({ status: "done", currentRunId: second });
      expect(git(t.repo, "show", "refs/heads/orca/g:a")).toBe("a");
      expect(new Map(view(t).runs.map((run) => [run.runId, run.state]))).toEqual(new Map([[runId, "settled-failed"], [second, "settled-recoverable"]]));
    } finally { await t.h.dispose(); }
  });

  it("records a cleanup failure on the failed run, keeps it settled-failed, and still runs the new one", async () => {
    const { t, succeedNext } = await failingHarness(); try {
      const { runId, driver } = await failedRun(t);
      expect("error" in retry(t)).toBe(false);
      let repositoryGone = true;
      t.deps.resolveRepository = () => { if (repositoryGone) throw new Error("repository-unavailable"); return t.repo; };
      await driver.round();
      expect(t.body(runId)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: false, cleanupError: "repository-unavailable" } });
      repositoryGone = false;
      succeedNext();
      const second = await claimAgain(t, driver);
      await t.until(driver, () => t.body(second).state === "settled" && t.body(second).drive?.cleanedUp === true && t.body(runId).drive.cleanedUp === true);
      expect(t.body(runId).drive.cleanupError).toBeNull();
      expect(work(t, "a").status).toBe("done");
    } finally { await t.h.dispose(); }
  });

  it("retries twice: a short reserve on the second retry is refused by dimension and shortfall, and run 3 lands (review focus 2)", async () => {
    const { t, succeedNext } = await failingHarness(); try {
      const { runId: first, driver } = await failedRun(t);
      expect("error" in retry(t)).toBe(false);
      const second = await claimAgain(t, driver);
      await t.until(driver, () => t.body(second).state === "blocked");
      expect(t.body(second).drive).toMatchObject({ blockedAt: "C", outcome: "failed", stopReason: FAILED_REASON });
      expect(taskRunNumber(view(t), "a")).toBe(2);
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const ledger = readWebGroup(t.h.store, "g").ledger;
      const lowered = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: ledger.used.tokens + ledger.committedRemaining.tokens } }));
      expect("error" in lowered ? lowered.error : "lowered").toBe("lowered");
      expect(netOf(t.body(second)).tokens).toBe(10);
      expect(refusal(retry(t))).toEqual({ code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:10" });
      const restored = t.service.setLimit(t.h.command("set-limit", { limit }));
      expect("error" in restored ? restored.error : "restored").toBe("restored");
      expect("error" in retry(t)).toBe(false);
      succeedNext();
      const third = await claimAgain(t, driver);
      expect(taskRunNumber(view(t), "a")).toBe(3);
      await t.until(driver, () => t.body(third).state === "settled" && [first, second, third].every((id) => t.body(id).drive?.cleanedUp === true));
      expect(new Map(view(t).runs.map((run) => [run.runId, run.state]))).toEqual(new Map([[first, "settled-failed"], [second, "settled-failed"], [third, "settled-recoverable"]]));
      expect(work(t, "a")).toMatchObject({ status: "done", currentRunId: third });
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/retryTask.test.ts > $S/d7.txt 2>&1; echo rc=$?`
  → rc=1: the first and third new `it`s fail at `cleanedUp: true` / the final `until` (the driver never visits a
  `settled-failed` run, so its workspace stays); the second fails at `cleanupError` (`null`).
- [ ] **Step 3: Implement.** `src/control/executionDriver.ts`, after the closing brace of `stepE`:

```ts
/**
 * Issue fixes spec §4.2(2): a run retry-task settled as failed keeps its evidence and loses its workspace. Its saved
 * terminal report is the stop proof (stepC wrote it before blocking). Like stepE's cleanup it never blocks: a failure is
 * recorded in `cleanupError` by the round and retried next round, and the task's new run has its own workspace.
 */
export async function stepCleanupFailed(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "settled-failed" || run.drive === undefined || run.drive.cleanedUp) return false;
  const drive = run.drive;
  const report = await savedReport(store, runId);
  await archiveRun(store, { runId, sourceDir: drive.sourceDir, repoDir: join(drive.sourceDir, "repo"), stopProof: report.candidate?.stopProof ?? null }, archiveAdmission(deps));
  await cleanupRunWorkspace(deps.resolveRepository(groupRepoId(store, run.groupId)), deps.roots, runId, workspaceOf(drive));
  write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "settled-failed" || current.drive === undefined) return;
    current.drive = { ...current.drive, cleanedUp: true, cleanupError: null };
    saveDriverRun(store, current);
  });
  return true;
}
```

  `driverRunIds`: replace
  `if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && (!run.drive.cleanedUp || run.drive.publishError !== null))) ids.push(runId);`
  with

```ts
    if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && (!run.drive.cleanedUp || run.drive.publishError !== null))
      // Issue fixes spec §4.2(2): a settled-failed run until its evidence is archived and its workspace removed.
      || (run.state === "settled-failed" && run.drive !== undefined && !run.drive.cleanedUp)) ids.push(runId);
```

  `advance`, work chain: after `case "landed": case "settled": return stepE(deps, runId);` add
  `case "settled-failed": return stepCleanupFailed(deps, runId);`.

  `pass`'s catch: replace

```ts
          if (run.state === "settled") {
            write(deps, () => {
              const current = readDriverRun(deps.store, runId);
              if (current.state === "settled" && current.drive !== undefined && !current.drive.cleanedUp) {
```

  with

```ts
          // Issue fixes spec §4.2(2): a settled-failed run's cleanup failure is recorded the same way.
          if (run.state === "settled" || run.state === "settled-failed") {
            write(deps, () => {
              const current = readDriverRun(deps.store, runId);
              if ((current.state === "settled" || current.state === "settled-failed") && current.drive !== undefined && !current.drive.cleanedUp) {
```

  and update the comment directly above that block's first line from "A settled run stays settled" to
  "A settled (or settled-failed) run stays where it is".
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0. Then
  `./node_modules/.bin/vitest run tests/control/executionDriver.test.ts tests/control/driverSettle.test.ts tests/control/driverHandoff.test.ts tests/control/blockedStaysPut.test.ts > $S/d7b.txt 2>&1; echo rc=$?` rc=0;
  `npm run typecheck` rc=0.
- [ ] **Step 5: Mutation.** (a) Remove the `settled-failed` clause from `driverRunIds` → first `it` red at
  `cleanedUp: true`. (b) Remove the `case "settled-failed":` from `advance` → same. (c) Put the catch back to
  `run.state === "settled"` only → second `it` red (the run is blocked at E instead: `state` ≠ `settled-failed`).
  (d) Delete the `archiveRun(…)` call → first `it` red at `archived(t, runId)`. (e) Delete the final `write(…)` → first
  `it` red at `cleanedUp: true`.
- [ ] **Step 6: Commit.** `git -C $W add src/control/executionDriver.ts tests/control/retryTask.test.ts`;
  message `feat(control): archive and clean a settled-failed run's workspace in the driver loop`.

---

### Task D8: Web — Retry task button, explained reasons, run number

**Files:**
- Create: `web/src/RunReason.tsx`
- Modify: `web/src/ControlGroupView.tsx` (runs table, lines 196–215)
- Modify: `web/src/TaskDetail.tsx` (imports lines 11–18; runs list lines 178–187)
- Modify: `web/src/controlApi.ts` (imports line 14–40; `ControlAction` after `recovery-retry`, line 251;
  `controlCommandPath` after `case "recovery-retry"`, line 296–297)
- Modify: `web/src/locales/en.ts` (`control.group` after `retryRun`, line 243; `control.task` after `runsOf`, line 278;
  `enErrors`), `web/src/locales/zh.ts` (`control.group` after `retryRun`, line 150; `control.task` after `runsOf`,
  line 185; `zhErrors`)
- Test: `web/tests/driverRetry.test.tsx` (add `it`s), `web/tests/failureReasons.test.ts` (create)

**Interfaces:**
- Consumes: Part A `explainRunReason`; D6 `isTerminalFailure`, `reasonCode`, `runReasonText`, `taskRunNumber`.
- Produces: `ControlAction` member `{ verb: "retry-task"; groupId: string; expectedRevision: number; payload: RetryTaskPayloadV1 }`,
  path `groups/<groupId>/retry-task`; `RunReason` component; i18n keys `control.group.retryTask`, `control.task.runNumber`;
  errors-table entries for the ccloop reasons of spec §4.2(1): `codex-result-invalid`, `codex-events-invalid`,
  `codex-no-completion`, `codex-usage-invalid`, `codex-usage-unavailable`, `codex-event-error`, `codex-timeout`,
  `codex-skills-cleanup-failed`, `codex-skills-path-conflict`, `codex-skills-pending`, `codex-skills-setup-failed`,
  `codex-skills-source-invalid`, and `terminal` (the exhaustion/cancellation outcomes, `terminal:<outcome>`).

- [ ] **Step 1: Write the failing test.** Append to `web/tests/driverRetry.test.tsx` (add `TaskDetail` and
  `controlCommandPath` imports: `import { TaskDetail } from "../src/TaskDetail.js";`,
  `import { controlCommandPath } from "../src/controlApi.js";`, and `WorkItemViewV1` to the `controlTypes` type import):

```tsx
// Issue fixes spec §4.2(5): a run ccloop ended failed is retried as a task; a settled-failed run explains itself and offers nothing.
const FAILED = { state: "blocked" as const, blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /runs/r/attempt-1" };
describe("retrying a task whose run ccloop ended failed (issue fixes spec §4.2(5))", () => {
  it("offers Retry task, not Retry run, and explains ccloop's reason beside the raw reason", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([run(FAILED)])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryAllByRole("button", { name: /^Retry run/ })).toHaveLength(0);
    expect(screen.getByText(/did not answer in the required JSON format/)).toBeTruthy();
    expect(screen.getByText("Error: codex-result-invalid: /runs/r/attempt-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } });
    expect(controlCommandPath({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } })).toBe("/api/control/groups/g/retry-task");
  });

  it("keeps Retry run for a blocked run whose ccloop run succeeded (out of bounds)", () => {
    render(<ControlGroupView view={view([run({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded", stopReason: null })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Retry run/ })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /^Retry task/ })).toHaveLength(0);
  });

  it("explains a settled-failed run's reason and offers no button", () => {
    render(<ControlGroupView view={view([run({ ...FAILED, state: "settled-failed", stopReason: "Error: codex-event-error" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText(/reported an error/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Retry (run|task)/ })).toHaveLength(0);
  });

  it("shows the task's run number and Retry task in the task detail", () => {
    const onCommand = vi.fn();
    const item: WorkItemViewV1 = { taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
      derivedContractHash: "f".repeat(64), currentRunId: "run-2", pendingRunId: null, lineageRunIds: ["run-1", "run-2"] };
    const runs = [run({ runId: "run-1", state: "settled-failed", outcome: "failed", blockedReason: "terminal:failed" }), run({ runId: "run-2", ...FAILED })];
    render(<TaskDetail view={{ ...view(runs), workItems: [item] }} item={item} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByText("Run 2 of this task")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } });
  });
});
```

  Create `web/tests/failureReasons.test.ts`:

```ts
/**
 * Issue fixes spec §4.2(1), §2.2(a): every ccloop failure reason the run views show has text in both languages, and a
 * reason as ccloop sends it (behind `Error: `) reaches that text.
 */
import { describe, expect, it } from "vitest";
import { enErrors } from "../src/locales/en.js";
import { zhErrors } from "../src/locales/zh.js";
import { explainRunReason } from "../src/refusalExplain.js";
import { reasonCode } from "../src/runFacts.js";

const REASONS = [
  "codex-result-invalid", "codex-events-invalid", "codex-no-completion", "codex-usage-invalid", "codex-usage-unavailable", "codex-event-error",
  "codex-timeout", "codex-skills-cleanup-failed", "codex-skills-path-conflict", "codex-skills-pending", "codex-skills-setup-failed",
  "codex-skills-source-invalid", "terminal",
];

describe("ccloop failure reasons (spec §4.2(1))", () => {
  it("has an English and a Chinese entry for every reason", () => {
    expect(REASONS.filter((code) => !Object.hasOwn(enErrors, code) || !Object.hasOwn(zhErrors, code))).toEqual([]);
  });

  it("explains a reason as ccloop sends it, through its Error: prefix, and an outcome through its detail", () => {
    expect(explainRunReason(reasonCode("Error: codex-result-invalid: /runs/r/attempt-1"))).toBe(enErrors["codex-result-invalid"]);
    expect(explainRunReason(reasonCode("terminal:exhausted"))).toContain("exhausted");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `cd $W/web && ../node_modules/.bin/vitest run tests/driverRetry.test.tsx tests/failureReasons.test.ts > $S/d8.txt 2>&1; echo rc=$?`
  → rc=1: the four new `driverRetry` `it`s fail (no "Retry task" button, no explanation, no run number;
  `controlCommandPath` returns `undefined` for `retry-task`), and both `failureReasons` `it`s fail (the entries are missing).
- [ ] **Step 3: Implement.** Create `web/src/RunReason.tsx`:

```tsx
/**
 * Issue fixes spec §4.2(5), §2.2(a): a run's reason, explained in the reader's language, with the raw reason beside it
 * (monospace) -- ccloop's own for a failed run, else the driver's blocked reason. Nothing for a run with neither.
 */
import type { JSX } from "react";
import type { RunViewV1 } from "./controlTypes.js";
import { explainRunReason } from "./refusalExplain.js";
import { reasonCode, runReasonText } from "./runFacts.js";

export function RunReason(props: { run: RunViewV1 }): JSX.Element | null {
  const raw = runReasonText(props.run);
  if (raw === null) return null;
  const text = explainRunReason(reasonCode(raw));
  return <> — {text ?? raw}{text !== null && <> <code>{raw}</code></>}</>;
}
```

  `web/src/controlApi.ts`: add `RetryTaskPayloadV1,` to the type import list (after `RecoveryRetryPayloadV1,`); in
  `ControlAction` after the `recovery-retry` member add
  `| { verb: "retry-task"; groupId: string; expectedRevision: number; payload: RetryTaskPayloadV1 }`; in
  `controlCommandPath` after `case "recovery-retry": return "/api/control/recovery/retry";` add
  `case "retry-task":` / `return \`${group}/retry-task\`;`.

  `web/src/ControlGroupView.tsx`: add imports `import { RunReason } from "./RunReason.js";` and
  `import { isTerminalFailure } from "./runFacts.js";`. In the runs table cell replace

```tsx
                {run.blockedReason ? ` — ${run.blockedReason}` : ""}
```

  with `<RunReason run={run} />`, and replace the block

```tsx
                {run.state === "blocked" && run.blockedReason ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId } })}
                  >
                    {t("control.group.retryRun", { id: run.taskId ?? run.runId })}
                  </button>
                ) : null}
```

  with

```tsx
                {/* Issue fixes spec §4.2(5): a run ccloop ended failed is retried as a task (a new run); any other blocked
                    run keeps the run-scope recovery-retry, which refuses a terminal failure (run-terminal-failed). */}
                {isTerminalFailure(run) && run.taskId !== null ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "retry-task", groupId, expectedRevision: revision, payload: { taskId: String(run.taskId) } })}
                  >
                    {t("control.group.retryTask", { taskId: String(run.taskId) })}
                  </button>
                ) : run.state === "blocked" && run.blockedReason ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId } })}
                  >
                    {t("control.group.retryRun", { id: run.taskId ?? run.runId })}
                  </button>
                ) : null}
```

  `web/src/TaskDetail.tsx`: add imports `import { RunReason } from "./RunReason.js";` and
  `import { isTerminalFailure, taskRunNumber } from "./runFacts.js";`; after `const runs = view.runs.filter((run) => run.taskId === item.taskId);`
  add `const runNumber = taskRunNumber(view, item.taskId);`; replace the runs block

```tsx
      <h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>
      {runs.length === 0 ? <p>{t("common.none")}</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)} <EvidenceList runId={run.runId} />
            </li>
          ))}
        </ul>
      )}
```

  with

```tsx
      <h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>
      {/* Issue fixes spec §4.2(2): the run number counts the runs that reached the provider. */}
      {runNumber > 0 && <p>{t("control.task.runNumber", { n: runNumber })}</p>}
      {runs.length === 0 ? <p>{t("common.none")}</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)}<RunReason run={run} /> <EvidenceList runId={run.runId} />
              {isTerminalFailure(run) && (
                <button type="button" onClick={() => onCommand({ verb: "retry-task", groupId, expectedRevision: view.summary.commandRevision, payload: { taskId: item.taskId } })}>
                  {t("control.group.retryTask", { taskId: item.taskId })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
```

  Locales. `en.ts` `control.group`, after `retryRun: "Retry run {{id}}",`: `retryTask: "Retry task {{taskId}}",`;
  `control.task`, after `runsOf: "Runs of {{taskId}}",`: `runNumber: "Run {{n}} of this task",`.
  `zh.ts` `control.group`, after `retryRun: "重试运行 {{id}}",`: `retryTask: "重试任务 {{taskId}}",`; `control.task`,
  after `runsOf: "{{taskId}} 的运行",`: `runNumber: "这个任务的第 {{n}} 次运行",`.

  `enErrors` (keep key order; if Part A already added `terminal`, keep Part A's text and add only the others — check with
  `grep -n '"terminal"' web/src/locales/en.ts web/src/locales/zh.ts > $S/terminal.txt; echo rc=$?` and read the file):

```ts
  // Issue fixes spec §4.2(1): ccloop's failure reasons, matched by their prefix up to the first ':' (the rest is evidence).
  "codex-event-error": "The model reported an error, for example a quota or service failure.",
  "codex-events-invalid": "The model's event stream could not be read.",
  "codex-no-completion": "The model stopped without finishing its turn.",
  "codex-result-invalid": "The model did not answer in the required JSON format.",
  "codex-skills-cleanup-failed": "The skills given to the model could not be removed afterwards.",
  "codex-skills-path-conflict": "A skill's path collides with a file already in the workspace.",
  "codex-skills-pending": "Skills from an earlier attempt were still in the workspace.",
  "codex-skills-setup-failed": "The model's skills could not be put in place.",
  "codex-skills-source-invalid": "A skill's source is not valid.",
  "codex-timeout": "The model did not finish within its time limit.",
  "codex-usage-invalid": "The model reported its token usage in a form that could not be read.",
  "codex-usage-unavailable": "The model did not report its token usage.",
  "terminal": "The ccloop run ended {{detail}} instead of succeeding. Retry task starts a new run.",
```

  `zhErrors`:

```ts
  // Issue fixes spec §4.2(1): ccloop's failure reasons, matched by their prefix up to the first ':' (the rest is evidence).
  "codex-event-error": "模型报告了错误，例如额度用尽或服务故障。",
  "codex-events-invalid": "读不懂模型的事件流。",
  "codex-no-completion": "模型没有完成这一轮就停了。",
  "codex-result-invalid": "模型没有按要求的 JSON 格式作答。",
  "codex-skills-cleanup-failed": "给模型的 skills 事后没能移除。",
  "codex-skills-path-conflict": "某个 skill 的路径和工作区里已有的文件冲突。",
  "codex-skills-pending": "工作区里还留着上一次尝试的 skills。",
  "codex-skills-setup-failed": "没能为模型放好 skills。",
  "codex-skills-source-invalid": "某个 skill 的来源不合法。",
  "codex-timeout": "模型没有在时限内完成。",
  "codex-usage-invalid": "模型报告的 token 用量格式无法读取。",
  "codex-usage-unavailable": "模型没有报告 token 用量。",
  "terminal": "ccloop 运行以 {{detail}} 结束，没有成功。「重试任务」会开一次新的运行。",
```

  (Comments stay English in `zh.ts` too; Chinese is only in the string values.)
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0. Web typecheck rc=0 (`controlCommandPath` covers the new
  member). `cd $W/web && ../node_modules/.bin/vitest run > $S/d8b.txt 2>&1; echo rc=$?` rc=0 (the whole web suite: i18n key
  parity, pseudo-locale and width criteria see the new keys). `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/d8c.txt 2>&1; echo rc=$?` rc=0.
- [ ] **Step 5: Mutation** (web: `npm run build --workspace web` in the clone first). (a) In `ControlGroupView`, swap the
  two branches' order so `run.state === "blocked" && run.blockedReason` is tested first → "offers Retry task, not Retry
  run" red (a Retry run button appears). (b) Delete the `isTerminalFailure(run) && run.taskId !== null ? (…) :` branch →
  same `it` red at the "Retry task a" click. (c) Replace `<RunReason run={run} />` with the old blocked-reason text → same
  `it` red at the explanation and "explains a settled-failed run's reason" red. (d) Delete the TaskDetail button →
  "shows the task's run number and Retry task" red at the click; delete the `runNumber` paragraph → same `it` red at
  "Run 2 of this task". (e) Delete `zhErrors["codex-result-invalid"]` → `failureReasons.test.ts` first `it` red.
  (f) Make `reasonCode` the identity in the clone → `failureReasons.test.ts` second `it` red (if it stays green, Part A's
  `explainRunReason` strips `Error: ` itself; record that, and the D6 criterion still pins `reasonCode`).
- [ ] **Step 6: Commit.** `git -C $W add web/src/RunReason.tsx web/src/ControlGroupView.tsx web/src/TaskDetail.tsx web/src/controlApi.ts web/src/locales/en.ts web/src/locales/zh.ts web/tests/driverRetry.test.tsx web/tests/failureReasons.test.ts`;
  message `feat(web): offer Retry task for a run ccloop ended failed, explain its reason, and show the run number`.

---

### Task D9: End-to-end against real ccloop and fake codex

**Files:**
- Modify: `tests/control/executionDriverE2E.test.ts` (imports lines 1–7; a new `it` after "T1", before the `R1` `it.each`, ~line 143)

**Interfaces:**
- Consumes: `ccloopWorlds`'s `world`/`startGroup`/`raw`/`until`/`workRuns` (fixtures/ccloopWorld.ts); fake codex's
  `script` mode, which reads the script file on every call and exits 3 at `execute` for a task with no entry (ccloop
  `tests/fixtures/fake-codex.mjs`); `taskRunNumber` (D6). Gated like the rest of the file on `ORCA_CCLOOP_BIN`.

- [ ] **Step 1: Write the failing test.** Imports: add `import { writeFile } from "node:fs/promises";` after the `node:fs`
  import and `import { taskRunNumber } from "../../web/src/runFacts.js";` after the `controlViews.js` import. After the
  "T1" `it`:

```ts
  // Issue fixes spec §4.4 (issue 16): a run ccloop ended failed keeps ccloop's reason; retry-task settles it, the group
  // view reads at once, and the pump and driver run the task again from the group branch. The script has no entry for
  // task a at first, so fake codex exits 3 at execute and ccloop ends the run with its own reason; the script is then
  // given the entry (fake codex reads it on every call).
  it("R-F: retry-task after a ccloop failure settles the run as settled-failed, and run 2 lands", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"] }], {});
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId, 1_000_000);
      runtime.startPump(50);
      await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "the first run to fail");
      const first = workRuns(runtime)[0]!;
      expect(first.body.drive.blockedAt).toBe("C");
      expect(first.body.drive.outcome).not.toBe("succeeded");
      expect(typeof first.body.drive.stopReason).toBe("string");
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs[0]).toMatchObject({ state: "blocked", stopReason: first.body.drive.stopReason, outcome: first.body.drive.outcome });
      await writeFile(join(w.root, "codex-script.json"), JSON.stringify({ a: { files: { "a.txt": "A\n" } } }));
      const retried = runtime.service.retryTask(raw(runtime, "retry", "retry-task", { taskId: "a" }));
      expect("error" in retried ? retried.error : retried.result).toEqual({ kind: "task-retried", taskId: "a", fromRunId: first.runId });
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs.map((run) => run.state)).toEqual(["settled-failed"]);
      await until(() => workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true), 240_000, "run 2 to land and both runs to be cleaned");
      const second = workRuns(runtime).find((run) => run.runId !== first.runId)!;
      expect(new Map(workRuns(runtime).map((run) => [run.runId, run.body.state]))).toEqual(new Map([[first.runId, "settled-failed"], [second.runId, "settled"]]));
      expect(taskRunNumber(readControlGroup(runtime.store, runtime.epoch, "g"), "a")).toBe(2);
      expect(w.show("a.txt")).toBe("A");
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
```

- [ ] **Step 2: Run it, expect FAIL.** This criterion needs D1–D8 to compile and run at all, so its red is shown by the
  Step 5 mutations rather than before the implementation. The run command (the real binary is what the gate uses; `$BIN`
  = the absolute path of the gate's clone build of the pinned ccloop `bin`):
  `cd $W && ORCA_CCLOOP_BIN=$BIN ./node_modules/.bin/vitest run tests/control/executionDriverE2E.test.ts -t "R-F" > $S/d9.txt 2>&1; echo rc=$?`.
- [ ] **Step 3: Implement.** No production change: D1–D8 implement it. The world's HOME/XDG relocation (`relocateHome`)
  already covers this `it` (Rule 17).
- [ ] **Step 4: Run, expect PASS.** The Step 2 command on `$W` → rc=0 (with `ORCA_CCLOOP_BIN` unset the describe is
  skipped and rc=0 proves nothing — the gate (Part F) runs it with the binary set; record which).
- [ ] **Step 5: Mutation.** In a clone: remove the D2 `...stopReason` patch in `stepC` → red at
  `typeof first.body.drive.stopReason`; remove the D7 `driverRunIds` clause → red at the second `until` (timeout).
- [ ] **Step 6: Commit.** `git -C $W add tests/control/executionDriverE2E.test.ts`;
  message `test(control): retry a task after a real ccloop failure and land its second run`.

---

### Task D10: ERRATUM to the execution driver spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-execution-driver-design.md` (append at the end of the file, after line 238;
  the original text is not touched — Rule 13)

- [ ] **Step 1: Write the failing check.** `grep -c "ERRATUM (issue fixes, 2026-10-08" $W/docs/superpowers/specs/2026-09-25-execution-driver-design.md > $S/d10.txt; echo rc=$?` → prints `0`, rc=1.
- [ ] **Step 2: Run it, expect FAIL.** As Step 1.
- [ ] **Step 3: Implement.** Append exactly (one blank line before it):

```markdown

## ERRATUM (issue fixes, 2026-10-08, Orca session e34dc963)

§2.3's last line ("no new human commands; abandoning a run goes through the existing stop/recover path") is amended by
human ruling H2 of `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` (§4). A run blocked at C whose ccloop run
ended with an outcome other than `succeeded` is no longer sent back to C by `recovery-retry`, which now refuses it with
`run-terminal-failed` (409); a transiently blocked run is resumed as before. The new group command `retry-task`
(payload `{ taskId }`) settles such a run in the new run state `settled-failed` (inactive; its booked usage kept, its
remainder released and the task's grant re-reserved), returns its task to `ready` with `currentRunId` still on that run,
and normal dispatch starts a new run from the group branch's current head. The driver archives a `settled-failed` run's
evidence and removes its workspace as it does a settled run's (§3.5), recording a failure in `cleanupError`. The drive
record also keeps ccloop's own `stopReason` (first 500 UTF-16 units). The text above this section is unchanged.
```

- [ ] **Step 4: Run, expect PASS.** The Step 1 command prints `1`, rc=0; `git -C $W diff --stat > $S/d10b.txt` shows only
  additions to this file.
- [ ] **Step 5: Mutation.** None (documentation; the check in Step 1 is its criterion).
- [ ] **Step 6: Commit.** `git -C $W add docs/superpowers/specs/2026-09-25-execution-driver-design.md`;
  message `docs(spec): erratum — retry-task and settled-failed amend the execution driver's no-new-command rule`.

---

### Part D exit check

`cd $W && npm run typecheck > $S/dx1.txt 2>&1; echo rc=$?` rc=0; web typecheck rc=0;
`./node_modules/.bin/vitest run tests/control tests/panel tests/entry > $S/dx2.txt 2>&1; echo rc=$?` rc=0 (read whole; only
registered load flakes allowed, each named); `cd $W/web && ../node_modules/.bin/vitest run > $S/dx3.txt 2>&1; echo rc=$?`
rc=0. The full gate is Part F's.
