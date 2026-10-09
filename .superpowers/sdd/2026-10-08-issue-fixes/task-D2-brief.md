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

