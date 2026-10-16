# Task 5 report — the one automatic estimate retry

Who: implementer subagent, Orca session 4de777f4, 2026-10-17. Branch `codex/round-20261017`.
Commit: `c71204c9 feat(control): one automatic estimate retry that tells the model what was wrong` (parent `6c66e801`).

## What was implemented

- `src/control/estimateRetry.ts` (new):
  - `RetrySkipCode`, `RetryDecision` exactly as in the brief.
  - `decideEstimateRetry(input)`: pure, plain comparisons. `none` when there is no failure, the estimate has `origin`,
    the reason code is not one of `estimate-output-invalid` / `estimate-output-plan-mismatch` /
    `estimate-call-failed:single-call-output-invalid`, or the problems are empty. Skip checks in spec §4.3 order:
    group-not-prestart (stopped, `archived` key present, status not draft/ready) → budget-deficit → usage-unknown →
    dispatch-blocked → reserve-insufficient (null dimension fits) → proposal-unknown → proposal-changed → superseded →
    tokenizer-unavailable (exact) → input-too-large.
    Note: proposal-unknown is checked before proposal-changed (an absent version cannot be compared); the spec lists them together.
  - `retryPromptFits(contract, request, problems)`: builds bytes with
    `buildEstimatePrompt(contract.instructionVersion, canonical request, { taskIds: estimateTaskIds(request), retryProblems: problems })`
    (the same call `prepare` makes), ceil(bytes × num / den) + framing + maxOutputTokens ≤ frozen window and ≤ grant tokens.
  - `estimateRetryId(groupId, failedId)` = `estimate-${sha256Canonical({ groupId, retryOf }).slice(0, 24)}`.
  - `writeEstimateRetry(store, groupId, failed, contract, problems)`: version = max + 1; the row reuses the failed one's
    profile, mode, request/requestHash, estimatorSlot, proposalVersion, grant ESTIMATE_GRANT, `origin`; the contract
    (old + `retryProblems`) is written through `persistEstimateArtifacts` (canonical record + outbox
    `estimate-contract:<groupId>:<estimateId>`); `budget-estimate` wake `scheduler-wake:<g>:estimate:<id>`. Not a
    command-ledger entry; no actor field (controller ruling).
- `src/control/webService.ts` `completeEstimateInStore`: the contract is read once (hoisted; repair used to read it
  inline). After the settlement numbers and `setReserve`, the decision runs; `retrySkipped` or `retriedAs` is set on the
  failed row before it is written; on `retry`, `writeEstimateRetry` runs and the grant is reserved
  (`committedRemaining += ESTIMATE_GRANT`, reserve = residual) — all in the same transaction, before the receipt.
- Controller-carried fix: `estimateFailureProblems` now returns `["plan-mismatch"]` for a post-repair
  `estimate-output-plan-mismatch` (was `["output-not-canonical"]`).
- `singleCallPurposes.ts` `prepare`: already passed `contract.retryProblems` (Task 4); unchanged.

## Criterion rewrite

- `tests/control/estimator.test.ts` "holds gaps/unknown usage and refunds only settled remainder": it settled with `{}`
  (invalid), which now queues a retry whose grant the reserve funds (reserve was 250 000 lower). Rewritten with a
  `Ruling (session 4de777f4, 2026-10-17)` comment to settle with `null` (a failed call, not retried) and assert no
  `retriedAs`, so the criterion still pins the refund alone.

## Tests

New `tests/control/estimateRetry.test.ts` (21 criteria): unrepairable answer → `retriedAs`, retry row (`origin`,
non-empty problems incl. `task-missing:a`), one new wake, contract = old + retryProblems; driving it makes exactly 2
single calls, second bad → retry `failed`, no `retriedAs`/`retrySkipped`, no third call after 3 more rounds; prompt of
the retry = `buildEstimatePrompt` with the feedback paragraph; good second answer → retry `ready`, newest in the panel
view; `single-call-output-invalid` → `["no-json-object"]` + cut-off hint in the prompt; `codex-rate-limited` /
`single-call-timeout` → no retry, no `retrySkipped`; refusal issues (`field-invalid:groupRationale…`) and
`output-not-canonical` (-0) carried as problems; plan-mismatch (via the classify seam) → `["plan-mismatch"]`; replay
(twice the same raw answer) → one retry row under the pinned id; skips recorded with no wake and the receipt committed:
deficit (soft overrun 50M tokens: deficit > 0, group `blocked`, settlement committed, run `settled-restartable` — see
concern 1), proposal-changed, reserve-insufficient, superseded, proposal-unknown, tokenizer-unavailable, input-too-large,
group stopped; unit criteria of `decideEstimateRetry` for none cases, usage-unknown, dispatch-blocked, archived,
running status, reserve with a null dimension, order, 20×200-char problems, tight window.

Commands (worktree, commit c71204c9 contents before commit; `ORCA_CCLOOP_BIN=/private/tmp/ccb6-qswQ/ccloop/dist/cli.js`,
`CCLOOP_CACHE_DIR=$(mktemp -d /private/tmp/cc-t-XXXX)`, `ECC_GATEGUARD=off DISABLE_OMC=1`):
- `./node_modules/.bin/vitest run tests/control/estimateRetry.test.ts tests/control/{driverEstimate,estimateE2E,estimateOutcome,planImport,webMutations,estimator,schedulerBridge}.test.ts`
  → exit 0, `Test Files 8 passed (8)  Tests 118 passed (118)`.
- Earlier: same plus `tests/control/estimate*.test.ts` → exit 0, `14 passed (14)`, `182 passed (182)`.
- `npm run typecheck` → exit 0.
- Full root suite once (`vitest run`, before the estimator rewrite): `2 failed | 426 passed (428)`, tests
  `2 failed | 3911 passed | 36 skipped (3949)`. Failures: estimator.test.ts (fixed by the rewrite above) and
  `schedulerBridge.test.ts > runs a real conflicting graph … success` — 30 s timeout; it passed alone in the run above
  (load flake, not this change). The full suite was not re-run after the rewrite. 36 skipped are pre-existing skips.
  Web tests not run (no web file touched).

## TDD evidence

Honest note: the implementation was written before the test file. RED was captured afterwards in the clone with the
pre-implementation sources (`git checkout 6c66e801 -- src/control/webService.ts`, estimateRetry.ts moved away):
`vitest run tests/control/estimateRetry.test.ts` → exit 1, `Cannot find module '../../src/control/estimateRetry.js'`.
The behavioural red evidence is the mutation table below. GREEN: the runs above.

## Mutations (Rule 9)

Clone `git clone --local` at `/private/tmp/mut-OVZL/repo` (node_modules symlinked), baseline = the worktree files.
Script `/private/tmp/mut-OVZL/mutate.py`; each mutation runs `vitest run tests/control/estimateRetry.test.ts`, then
`git checkout --` the file; restore proof `git diff`/`git diff --cached` bytes. Logs `/private/tmp/mut-OVZL/logs/`.
Every row: restore 0/0.

| mutation | exit | red criteria |
|---|---|---|
| a remove the `origin` check (brief 5a) | 1 | "…retry that fails again gets no third call"; unit none-cases |
| b throw on deficit (brief 5b) | 1 | deficit criterion: "driver did not get there: run blocked "deficit", estimate running" |
| c retry id from version (brief 5c) | 1 | replay criterion (pinned id), first criterion, panel criterion |
| d drop the plan-mismatch problem line | 1 | plan-mismatch criterion |
| e drop the empty-problems guard | 1 | unit none-cases |
| f every estimate-call-failed retryable | 1 (after adding the transport-with-problems unit assertion; first run survived because the empty-problems guard masked it) | unit none-cases |
| g drop group-not-prestart | 1 | deficit, group stopped, unit order |
| h drop budget-deficit | 1 | unit order |
| i drop usage-unknown / j drop dispatch-blocked | 1 / 1 | unit |
| k drop reserve-insufficient | 1 | reserve criterion, unit |
| l proposal-unknown / m proposal-changed / n superseded / o tokenizer | 1 each | its own criterion |
| p drop the size check / q size without the feedback | 1 / 1 | input-too-large (+ unit for p) |
| r no grant reserved | 1 | 4 criteria (the retry's claim fails assertKnownConservation) |
| s no retryProblems in the contract | 1 | 3 criteria |
| t no wake | 1 | first criterion, replay |

On mutation c: the replay itself cannot tell the id scheme apart — the `estimate-result` receipt returns early on the
second completion, so no second row is ever written. The replay criterion pins the id derived from the failed
estimate, and that assertion is what reds.

## Spec §5: a retry still queued when the group starts (observed, not changed)

Probe in the clone (deleted afterwards): confirm → claim → settle with `{}` → retry queued (confirm does not bump
proposalVersion, so it is not `proposal-changed`) → `start` is accepted (`scheduled`; a queued estimate does not block
it) → `deliverSchedulerWakes`: wakes are delivered in rowid order, the retry's `budget-estimate` wake first. The retry
is **claimed and goes `running`** (estimate run `starting`, active) and the start wake also claims task `a` (work run
`starting`, work item `running`); the stored group status stays `ready`. So the retry runs (and is paid for) alongside
the group's first work run. This is what any queued estimate does at start today; nothing was changed.

## Concerns

1. budget-deficit cannot be reached end to end on its own: any usage past a grant blocks the group (usage.ts sets
   status `blocked`), so a real deficit always reports `group-not-prestart` first under the spec's order. The integration
   criterion therefore pins "the decision did not throw, the settlement committed" with `group-not-prestart`; the
   `budget-deficit` code is pinned by the unit criteria. The order is the spec's; I did not reorder.
2. A retry is queued for a **confirmed** proposal (still `ready`, same proposalVersion). Its result cannot advise
   the budget (the panel's `adviceOf` needs an editable proposal), and per §5 above it then runs alongside the
   first work run. The spec's skip list has no code for this; I did not invent one. The controller may want a ruling.
3. The full suite was run once before the estimator.test rewrite; not re-run in full after it (the named files plus
   estimator and schedulerBridge were).

## Files changed

- `src/control/estimateRetry.ts` (new)
- `src/control/webService.ts`
- `tests/control/estimateRetry.test.ts` (new)
- `tests/control/estimator.test.ts` (one criterion rewritten under the ruling)

## Fix round 1 (session 4de777f4, 2026-10-17; commit e0c89b7f, parent c71204c9)

Changes:
1. Controller ruling: new `RetrySkipCode` `proposal-confirmed`. `RetryInput` gains `proposalConfirmed: boolean`. The
   settlement passes `proposal.state === "confirmed"`. It is checked right after `group-not-prestart`, so the order
   is now group-not-prestart → proposal-confirmed → budget-deficit → … The web view and types take `retrySkipped` as
   any string (controlTypes.ts:300, webProtocol.ts:1341), so nothing there changed. This resolves concern 2 above.
2. Review minor: the tokenizer guard is now `kind !== "utf8-upper-bound"` → `tokenizer-unavailable`, which covers
   any unknown kind. A null request has its own guard with a comment saying it is unreachable (claimEstimate refuses
   an estimate without a request). The real size failure is a separate line. The null-request guard still records
   `input-too-large`: no listed code fits better, and I added no new code for an unreachable path. If the controller
   wants another code there, it is a one-line change.

Covering tests (tests/control/estimateRetry.test.ts):
- New integration criterion: webFixture → confirm (refused while an estimate runs, so it comes first) → claim →
  settle an unrepairable answer → failed, `retrySkipped: "proposal-confirmed"`, no `retriedAs`, 1 estimate row, no
  new budget-estimate wake. (Earlier I tried confirming during the call; it was refused with estimate-in-flight.)
- Unit: `proposalConfirmed: true` → proposal-confirmed; a stopped group still comes first; proposal-confirmed comes
  before a deficit.

Command (`ORCA_CCLOOP_BIN=/private/tmp/ccb6-qswQ/ccloop/dist/cli.js`, fresh `CCLOOP_CACHE_DIR`, `ECC_GATEGUARD=off DISABLE_OMC=1`):
`./node_modules/.bin/vitest run tests/control/estimateRetry.test.ts tests/control/{driverEstimate,estimateE2E,estimateOutcome,planImport,webMutations,estimator}.test.ts`
→ exit 0, `Test Files 7 passed (7)`, `Tests 110 passed (110)`. `npm run typecheck` → exit 0.

Mutations (clone /private/tmp/mut-OVZL/repo re-baselined on these files; logs /private/tmp/mut-OVZL/logs/):
- u: remove the proposal-confirmed check → exit 1. Red: the proposal-confirmed criterion and the unit order
  criterion. Restore diff 0/0.
- v: remove the tokenizer guard → exit 1. Red: the tokenizer-unavailable criterion. Restore diff 0/0.
