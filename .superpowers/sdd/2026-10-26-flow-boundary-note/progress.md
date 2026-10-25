# SDD ledger — plan: docs/superpowers/plans/2026-10-26-flow-boundary-pause-and-note.md
Spec: live transcript design §10.5.1/§10.5.2
Worktree: /private/tmp/orca-ffec7b28/flow-note (branch feat/flow-boundary-note). Append-only; entries below are per task.

## T1 — flow stop marker, deadline and resume side-door
- Scope: StopIntentV1.flowStop (optional, strict), flowHandoffDeadline(acceptedAt, perAttemptTimeoutMs), handoffStopInTransaction extraction, applyFlowHandoffStop, resume side-door refusal, error catalog `flow-pause-resume-via-flow` (409, en+zh).
- TDD: tests/control/flowHandoffStop.test.ts written first — RED run 1/9 passed (8 failed: `TypeError: applyFlowHandoffStop is not a function`), then 9/9 green.
- Focused: `PATH=/usr/local/bin:$PATH npx vitest run tests/control/flowHandoffStop.test.ts tests/control/stopIntent.test.ts tests/control/handoffStop.test.ts tests/panel/refusalCoverage.test.ts` — 64/64 passed (55 pre-existing + 9 new); typecheck `npx tsc --noEmit -p tsconfig.json` 0 errors; `npm run build` 0.
- Full unit (pinned env `ORCA_CCLOOP_BIN=/private/tmp/orca-ffec7b28/ccloop-c205d55/dist/cli.js CCLOOP_CACHE_DIR=/private/tmp/orca-ffec7b28/ccloop-cache-h7`): root `Test Files 3 failed | 555 passed (558)`, `Tests 3 failed | 4886 passed | 35 skipped (4924)`; web `159 passed (159)`.
  - Failure 1 (change-caused): tests/commands/drift.test.ts — generated error-codes.md stale after the new catalog code. Fixed with `npm run gen:cli-docs` (adds `| \`flow-pause-resume-via-flow\` | 409 |`); rerun drift.test.ts + startForm.test.ts = 13/13 passed.
  - Failures 2–3 (environmental, unrelated): tests/flow/startForm.test.ts ECONNRESET and tests/control/skillsE2E.test.ts real-ccloop `blocked: a=checkpoint-usage-high-water`; startForm passed in the 13/13 rerun, skillsE2E passed 4/4 alone (35.49 s).
- Mutation M1 (drop `+ 60_000` from flowHandoffDeadline): RED at the deadline criterion — `AssertionError: expected '2026-10-26T01:00:00.000Z' to be '2026-10-26T01:01:00.000Z'` (test "adds the attempt timeout plus one minute"). Restored from a backup; `cmp` + sha256 identical.
- Mutation M2 (remove the flowStop refusal from applyResumeDispatch): RED at "refuses a marked stop from the generic resume verb" — expected `{ error: { code: "flow-pause-resume-via-flow" } }`, received `{ error: { code: "stop-mode-conflict" } }`. Restored from a backup; `cmp` + sha256 identical.
- Restoration proof (post-T1, pre-commit): `cmp src/control/stopIntent.ts /tmp/t1-mutation/stopIntent.ts.bak` and the continuation.ts pair both clean; sha256 stopIntent.ts `769602957f30045ac26dc1126e101a1a856bd6c1f86817dca4899b028c5147b3`, continuation.ts `39f64a006b1230b01daf7f482e0f6bc1fc6085a65c98bd32bdd412314a55374e`.
- Deviation: `skills/orca-control/references/error-codes.md` was regenerated inside T1 (plan places the doc regen in T8) to keep the unit suite green.
- Files: src/control/stopIntent.ts, src/control/continuation.ts, src/control/errors.ts, web/src/locales/en.ts, web/src/locales/zh.ts, tests/control/flowHandoffStop.test.ts, skills/orca-control/references/error-codes.md, .superpowers/sdd/2026-10-26-flow-boundary-note/progress.md.
- Status: complete (implementer); no review/gate claimed.
