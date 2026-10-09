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

