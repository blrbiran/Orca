# Final fix wave (controller session 3156185d, 2026-10-09)

Source: every "Queued for the final fix wave" line in progress.md, plus D9 concern 2. Two implementers run in parallel
on disjoint files: FW-S (server) and FW-W (web). Each commits only its own paths (`git commit -- <paths>`).
Rules: common-implementer.md with session2-overrides.md. TDD for each item: write the test, see it RED for the expected
reason, implement, see it GREEN; one mutation per new branch, seen RED, in a clone made after your commit.

## FW-S (server: src/control/**, tests/control/**, tests/panel/** only — do NOT touch web/**)

S1 (E4 minor 1). Refuse an archived group in `preflightWebCommand` (src/control/commandLedger.ts), booked durably the
same way `revision-conflict` is booked there, so `group-archived` comes before any pre-transaction probe (estimator /
ccloop capability probe) and no probe runs for an archived group. Keep the gate in `applyWebCommand` as the in-transaction
backstop. Test: an archived group + a probe-spawning verb (e.g. the estimate path) → refusal `group-archived`, booked, and
the probe counter stays 0. The verbs that must still pass on an archived group (unarchive-group, and any read-only /
non-group verb) must still pass.

S2 (E4 minor 3). Test: a command accepted BEFORE the group is archived, re-sent with the same command id AFTER archiving,
replays its stored result (idempotent replay wins over the archive gate) — and nothing new is booked.

S3 (E4 minor 4). In the existing walk test over `commandVerbSchema` (E4's gate test), assert that every verb in its
NOT_GROUP set has a target kind that is neither group nor task, so a group verb cannot hide in NOT_GROUP.

S4 (B10 scope gap). In src/control/integrationResolve.ts, the transition to `resolving` (the owner's approval save) and
the `resolving → conflict` failure save each write one `integration` activity row through `recordActivity` (same row shape
as the settle rows B10 added). Tests for both rows.

## FW-W (web: web/**, plus tests/panel/refusalCoverage.test.ts if a new code needs listing — do NOT touch src/control/**)

W1 (E4 minor 2). en and zh `archive-stop-pending`: add the clause "if it is unresolved, retry recovery first" (zh: the
same meaning in natural Chinese). en text never contains its own code.

W2 (D9 concern 2). en + zh explanations for `codex-exit-error`. ccloop sends `Error: codex-exit-error: …`; the run view
reason goes through `explainRunReason` (web/src/refusalExplain.ts). Add it wherever the other codex-* stop reasons are
listed, including refusalCoverage's VIEW_REASONS, so coverage is enforced. Plain words: the codex process exited with an
error before giving an answer; what to do: look at the run's evidence, then retry the task.

W3 (E9 re-review gap). A styles test pins that `.dep-node text.dep-stall` uses `var(--stall)` (today reverting it to
`var(--warn)` stays green).

W4 (E11 review minor 1). `RunActivity` (web/src/TaskDetail.tsx) resets its entries when `runId` changes, so a retried
task never shows the previous run's rows under the new run's label. Test: render with run A's entries, switch to run B
whose fetch is pending, assert run A's rows are gone.

## Report
FW-S → task-FW-S-report.md, FW-W → task-FW-W-report.md (same directory). Reply with the short contract only.

## Addendum (after E12)
S5 (FW-S). tests/control/activityRuns.test.ts "a driver run gets endedAt when it lands, kept through settle, and a run-settled row…": give it a 30 s timeout (driverSettle precedent) — it times out at 5 s under load and is green alone.
