# Task B3 report (implementer, Orca session 026d10e3 subagent, 2026-10-15)

Status: DONE_WITH_CONCERNS (one deviation from the brief's expected-red list; no code deviation)
Commit: 9eab8af08536369c0c003b22a32963c68760b2ea on feat/error-codes-start-guard (parent 08276cf2)
Subject: `feat(control): let unstarted tasks' loop plans change while the group runs or is paused`

## What changed (lines measured at 9eab8af0)
- `src/control/webService.ts:27` — `readStopIntent` added to the `./stopIntent.js` import (brief said :26; the import is at :27).
- `src/control/webService.ts:988-995` — Step 1 of `setTaskLoop`: the old `(status not draft/ready) || group.stopped` check
  replaced verbatim by the brief's `editable` predicate (`["draft","ready","running","review"].includes(group.status) &&
  ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause")`). `assertKnownConservation` still first.
  The `task-already-started` check (now :1000-1002) is untouched.
- `web/src/LoopPlanCard.tsx:181-183` — `open` follows the server predicate, as given in the brief.
- `tests/control/setTaskLoopRunning.test.ts` (new) — C7 review group with a running task, C7 paused group, C7 handoff-stopped
  group, C8 retry path; verbatim from the brief.
- Named rewrites: `tests/control/setTaskLoop.test.ts:24-44` (done/blocked refuse; running/review accept on a confirmed group);
  `web/tests/loopPlanEdit.test.tsx:148-164` (old `at` helper line identical to the brief's, kept); `web/tests/budgetI18n.test.tsx:150-151`.
- `tests/control/setTaskLoop.test.ts:33` ("refuses a stopped group…") NOT rewritten (K6) and green.

## Commands (PATH starts with /Users/biran/.nvm/versions/node/v22.13.1/bin; logs in /private/tmp/oec/logs/, read back)
- RED root `vitest run tests/control/setTaskLoopRunning.test.ts tests/control/setTaskLoop.test.ts` → b3-red-root.log, rc=1,
  5 failed | 19 passed (24). Failed: "accepts … running", "accepts … review" (group-state-invalid at :42), "C7: in a review
  group…" (group-state-invalid instead of task-already-started, :31), "C7: a paused group…" (group-state-invalid, :45),
  "C8: …" (group-state-invalid instead of task-already-started, :69).
- RED web `vitest run tests/loopPlanEdit.test.tsx tests/budgetI18n.test.tsx` → b3-red-web.log, rc=1, 1 failed | 18 passed
  (19): the rewritten loopPlanEdit test, no "Change plan" button for running (:161). budgetI18n rewrite green at RED.
- GREEN root `vitest run tests/control/setTaskLoopRunning.test.ts tests/control/setTaskLoop*.test.ts tests/control/retryTask.test.ts`
  → b3-green-root.log, rc=0, 8 files, 71 passed (71), 0 skipped.
- `npm run build --workspace web` → b3-webbuild.log, rc=0.
- `vitest run tests/panel/scanPanelText.test.ts` → b3-green-scan.log, rc=0, 3 passed (3).
- `npm run typecheck` → b3-typecheck.log, rc=0. Web `tsc --noEmit -p tsconfig.json` → b3-webtsc.log, rc=0.
- GREEN web `vitest run tests/loopPlanEdit.test.tsx tests/budgetI18n.test.tsx tests/loopPlanCard.test.tsx tests/loopPlanDraft.test.tsx`
  → b3-green-web.log, rc=0, 4 files, 30 passed (30).
- FULL web suite (web/src touched) `cd web && vitest run` → b3-web-full.log, rc=0, 129 files, 1118 passed (1118), 0 failed/skipped.

## Deviations
- The brief listed C8 as green at RED ("pins unchanged refusals"). It was red: C8's group is in `review`, so the old status
  check answered `group-state-invalid` before the per-task `task-already-started` check could. After the change it is
  green, and it now isolates the per-task check (the reviewer's B3d mutation targets exactly that). No test or code text
  was changed because of this; it only means C8 also guards the status widening.

## Concerns
- None beyond the deviation above. Mutations B3a-B3f are left to the reviewer (clone `b3`), per the contract.

## Fix round 1 (implementer, Orca session 026d10e3 subagent, 2026-10-15; review: task-B3-review.md, mutation B3x)
Commit: aa73953d122563bb71ea0e5510adf196476cef91 (parent 9eab8af0), `test(control): pin that a shutting-down group refuses a loop-plan change`. Test only.
- `tests/control/setTaskLoopRunning.test.ts:61-75` — new "C7: a shutting-down group does not". This is a real state: a
  `driverHarness` group with tasks a and b; `t.claim()` makes `a` active, then the real global shutdown
  (`applyPanelShutdown`, `src/panel/controlLifecycle.ts:183`, used the way `activityRuns.test.ts:229` uses it) freezes it
  and writes the `shutdown` stop intent. The test then asserts:
  - the premise: `stop_intents.mode` is `"shutdown"`;
  - `set-task-loop` on the unstarted `b` is refused with the literal `group-state-invalid`;
  - `b`'s `derivedContractHash` is unchanged and it has no `amendmentHash`.
  `:12` gained the import of `applyPanelShutdown`.
- Why there is no `admissionGate`: on my first try I passed `t.h.deps.admissionGate`. The shutdown then drains the gate,
  so `setTaskLoop` threw `panel-draining` at `admissionGate.ts:27` before reaching the predicate (logged in the first
  b3-fix1-root.log run, 1 failed). That refusal would hide B3x, so the gate is left out, as `activityRuns.test.ts` does.
  The persisted intent is what refuses.
- Runs, logs in /private/tmp/oec/logs/:
  - `vitest run tests/control/setTaskLoop*.test.ts` → b3-fix1-root.log, rc=0, 7 files, 57 passed (57).
  - `npm run typecheck` → b3-fix1-typecheck.log, rc=0.
- Not done by me: per the contract, the implementer runs no mutations, so the reviewer still has to see B3x go red on this
  criterion.
