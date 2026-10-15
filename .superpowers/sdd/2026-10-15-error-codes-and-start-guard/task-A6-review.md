# Task A6 review — a human group retry recomputes the requirement's output bound

Reviewer: task-reviewer subagent of Orca session 026d10e3, 2026-10-15. Reviewed commit f84aee56 (package
`review-a72f3e22..f84aee56.diff`), clone `/private/tmp/oec/mut/a6` at f84aee56.

## Spec: ✅

Checked against the brief, spec A §4.8 and K5:
- Frozen selection: `retryOutputBound` probes `group.requirement.agentSlot.selection` (K5), not today's preferences
  or the partial. Pinned by test 1's `asked` assertion (A6c red).
- Preflight: `this.deps.profileRouter.resolve("budget-estimate", requirement.profile.profileId, requirement.profile.profileHash)`,
  then `profile.snapshot.profile.estimatorPreflight.maxOutputTokens`; bound = `singleCallOutputBound(preflight.maxOutputTokens, observation.resolution)`.
- Stored only inside the transaction and only when `requeue` is true, i.e. after the existing round/draft
  failed-or-interrupted checks (`stopIntent.ts:557-559`), before `saveRequirementGroup`.
- Profile no longer resolves → `kept(describeError(error))`; probe fails → `kept(probeFailureCode ?? "probe-failed")`;
  both return null so the retry proceeds as today with the frozen bound and write exactly one stderr line
  `orca-control: recovery-retry <groupId>: output bound kept at <n>: <reason>\n`. `probe()` itself catches the port's
  error (`profiles.ts:169-189`); its only uncaught throw (`profile-changed` when the router no longer holds the same
  object) is unreachable right after `resolve` on the same router.
- Scope "run" and "task" targets pass `null` (`webService.ts:582`); automatic retries never reach
  `retryRequirementInTransaction` with a bound (its only caller is `retryGroup`, only caller `applyRecoveryRetry`;
  default `outputBound = null`).
- The added `preflightWebCommand` before the probe matches the convention at `webService.ts:438,629,643,666,787,978`
  (replay/stale/archived answer without paying for a probe). Not called out by the brief but it is the brief's own
  code for `recoveryRetry`, verbatim.
- Fixture change in `requirementHarness.ts` is default-preserving (override null), as the brief's Step 1 specifies.
- Implementer deviations (import line 2 instead of 1; `ExecutionProfileRouter` type import added; non-existent
  `requirementRecovery.test.ts` dropped, four related files added to the green run) are accurate and harmless.

Nothing extra beyond the brief.

## Findings

### Critical
None.

### Important
- **I1 — the spec-named "profile no longer resolves" branch has no criterion** (`src/control/webService.ts:600-601`).
  Spec A §4.8 names two fallbacks ("If the profile no longer resolves or the agent probe fails"); only the probe
  failure is pinned (test 2). Extra mutation **A6d** (`catch (error) { return kept(describeError(error)); }` →
  `catch (error) { throw error; }`, i.e. a new refusal when the profile changed) stays **green** (rc=0).
  Fix (new test only, in `tests/control/requirementRetryBound.test.ts`): after round 1 fails, make the requirement's
  profile stop resolving (e.g. rewrite the stored group body's `requirement.profile.profileHash` to `"0".repeat(64)`
  via `x.store.db`, or build the harness with a router that does not allow `budget-estimate`), then assert the retry
  answers `{ kind: "recovery-observed", resolved: true }`, `[maxOutputTokens, round(1).state]` equals
  `[64_000, "drafting"]`, and the filtered stderr lines equal
  `["orca-control: recovery-retry r: output bound kept at 64000: profile-changed\n"]`; the reviewer re-runs A6d red.
  (Check first that changing the hash does not make the later driver claim crash the test before the assertions;
  the assertions above all run before the call is claimed, or `x.dispose()` handles it.)

### Minor
- **M1 — `estimator-preflight-missing` branch has no criterion** (`webService.ts:603`). Whether a `budget-estimate`
  profile can carry `estimatorPreflight: null` is not visible from the diff; if it can, the same "retry as before +
  one log line" shape applies and a one-line variant of the I1 test would pin it. Acceptable to register as a gap.
- **M2 — the `requeue &&` guard of the store has no criterion** (`stopIntent.ts:559`). Dropping `requeue &&` would only
  differ when the pre-transaction read saw a failed/interrupted step but the transaction no longer does (a race the
  harness cannot stage deterministically). It is the spec's "only after its existing state checks still find…"
  clause; correct as written, recorded so it is not mistaken for pinned.

## Mutations (clone `/private/tmp/oec/mut/a6`, head f84aee56; runner self-check: bad spec → exit 2, `.mutate`
"found 0"; green baseline `requirementRetryBound.test.ts` 2/2 passed, 0 skipped, `/private/tmp/oec/logs/a6r-baseline.log`)

| Name | File | Result | Red on | sha before = restored ≠ after | restore bytes (diff / cached) |
|---|---|---|---|---|---|
| A6a skip the store | `src/control/stopIntent.ts` | red (rc=1) | test 1, `:20` `maxOutputTokens` — expected 100000, received 64000 | yes | 0 / 0 |
| A6b probe failure refuses | `src/control/webService.ts` | red (rc=1) | test 2, `:34` the retry rejects `ControlError: recovery-blocked:retry-bound` | yes | 0 / 0 |
| A6c probe the partial | `src/control/webService.ts` | red (rc=1) | test 1, `:21` `asked` — received `[{ agent: "codex" }]` | yes | 0 / 0 |
| A6d (extra) unresolvable profile rethrows | `src/control/webService.ts` | **green (rc=0)** | — (I1) | yes | 0 / 0 |

Logs: `/private/tmp/oec/mut/logs/a6{a,b,c,d}.*`, specs `/private/tmp/oec/mut/specs/a6{a,b,c,d}.json`.
Each `.mutate` reads "applied 1 replacement spec(s)". Clone `git status --porcelain` after all runs: 0 bytes.
`pgrep -fl "fake-ccloop|worker.js|vitest"` before and after: no processes (rc=1 both times).

## ⚠️ Cannot verify from diff
- Whether a `budget-estimate` profile can have `estimatorPreflight === null` (M1 reachability).
- The implementer's reported flake (`driverRecovery.test.ts` "drives a retried run on…" 5005 ms under parallel load);
  their `a6-green2.log` shows 9 files / 157 passed and `a6-typecheck.log` rc=0 — left for Task G's full gate.

## Re-review 1 (fix 265642c3, package `review-f84aee56..265642c3.diff`; same reviewer session, 2026-10-15)

**I1: ADDRESSED.** The fix adds one test only, in `tests/control/requirementRetryBound.test.ts:41-56`. After round 1
fails, the test rewrites the stored `requirement.profile.profileHash` to `"0".repeat(64)`. It then asserts that the
retry answers `recovery-observed, resolved: true`, that `[maxOutputTokens, round(1).state]` equals `[64_000, "drafting"]`,
and that exactly one line reads `orca-control: recovery-retry r: output bound kept at 64000: profile-changed\n`.
All expected values are literals. Nothing is asserted before the call by reading back the hash the test itself wrote.

Clone `/private/tmp/oec/mut/a6r1` (head 265642c3, made with the same recipe). The baseline run of
`requirementRetryBound.test.ts` gave 3/3 passed, 0 skipped (`/private/tmp/oec/logs/a6r1-baseline.log`).

| Name | File | Result | Red on | sha before = restored ≠ after | restore bytes (diff / cached) |
|---|---|---|---|---|---|
| A6d (re-run) unresolvable profile rethrows | `src/control/webService.ts` | red (rc=1). Runner exit 0; `.mutate` reads "applied 1 replacement spec(s)" | new test 3, `:52`: the `recoveryRetry` call rejects with `ControlError: profile-changed` (from `profiles.ts:165` via `webService.ts:599`), which is the new refusal the criterion forbids. Tests 1 and 2 stay green | yes (601fcf30… / f083aa49… / 601fcf30…) | 0 / 0 |

Logs: `/private/tmp/oec/mut/logs/a6d-r1.*`. After the run, `git status --porcelain` in the clone printed 0 bytes.
`pgrep -fl "fake-ccloop|worker.js|vitest"` found no processes before or after.

**New breakage: none.** The fix changes only the test file and no source. The new test writes the group body with
`JSON.stringify` instead of canonical bytes. That only affects this test's own setup: the test reads the body back
through `readRequirementGroup` and passes. M1 and M2 remain as recorded (Minor).

**Updated verdict:** Spec ✅; Quality: Approved; Critical 0, Important 0, Minor 2; mutations 4/4 red.
