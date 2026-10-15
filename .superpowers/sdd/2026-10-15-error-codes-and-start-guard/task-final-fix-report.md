# Final fix wave: report

Implementer: final-fix seat, Orca session 026d10e3, 2026-10-15. Base 4095c659 → commit **53c9a16a** (one commit total):
"fix(web): show ccloop's code and detail on a ccloop-failed refusal; final-review fix wave".

Status: DONE_WITH_CONCERNS (one concern: the scratch clone could not be deleted, see Concerns).

## What changed

1. **I1**
   - `web/src/RefusalNotice.tsx:22`: the `<code>` now prints `refusal.message` when `refusal.code === "ccloop-failed"`, else
     `refusal.code`. The message is `ccloop-failed:<code>[: <detail>]` (the server cuts it to 512). So ccloop's code is on
     screen, and the detail stays visible even when the entry has no `{{detail}}` slot (single-call-unsupported,
     single-call-output-invalid).
   - `web/src/ccloopCodes.ts:20`: `explainCcloopCode` fills `message: detail`, so zh Orca-table fallbacks such as
     agent-version-drift and agents-table-invalid (which use `{{message}}`) keep the detail.
   - New criterion: `web/tests/ccloopCodes.test.tsx` › "a refusal notice shows ccloop's code and detail beside the words,
     in both languages". It renders `RefusalNotice` and asserts both `<p>` texts as literals:
     - en: omp-model-catalog-unavailable, and single-call-unsupported (an entry with no detail slot);
     - zh: omp-model-catalog-unavailable, and agent-version-drift (the Orca-table `{{message}}` fallback).
2. **m8**
   - `src/control/webDispatch.ts`: the "Commit the durable start wake…" JSDoc now sits directly above `scheduleStart`. The
     two helpers (`startRefusedAsPending`, `refuseStart`) are above it.
   - `tests/control/shutdownHealing.test.ts:108`: title only, now "…and then dispatches the queued wake and refuses a
     second start". The comment above it (:107, "…and accept `start`") was left as it is, because the brief said title only.
3. **Unknown code shown twice**
   - `explainEstimateReason` (ccloopCodes.ts:49-50) now uses `explainBesideCode`.
   - The USAGE_UNKNOWN branch of `explainRunReason` (refusalExplain.ts:51-54) adds the words only when
     `explainBesideCode` returns non-null.
   - New criteria:
     - `web/tests/agentSelectionEditor.test.tsx` › "shows an estimate's unknown ccloop code once": the estimate `<li>` ends
       with ` · estimate-call-failed:omp-new-thing`.
     - `web/tests/ccloopCodes.test.tsx` › "an unknown code is shown once on the blocked-run line": the full literal alert
       text.
   - Existing assertions rewritten under this fix-wave ruling:
     - `web/tests/agentSelectionEditor.test.tsx:324`: `"estimate-call-failed:omp-new-thing · omp-new-thing"` →
       `"estimate-call-failed:omp-new-thing"`.
     - `web/tests/ccloopCodes.test.tsx:84`: the 3rd expected value `"omp-new-thing"` → `null`.
     - `web/tests/ccloopCodes.test.tsx:108`: `"…cannot be settled. omp-new-thing"` → `"…cannot be settled. · "`.
4. **group-execution-pending text**
   - en.ts:1135 now reads "This group is already starting or running; a second start is not needed."
   - zh.ts:1071 now reads "这个组已在启动或运行中，不需要再次启动。"
   - SKILL.md:32 now reads "…refuses `start` with `group-execution-pending` (409); the group is already starting or
     running, and a second start is not needed."
   - No test asserted the old literal: I grepped web/tests and tests for "dispatched automatically", "自动派发" and
     "dispatches the group" and found nothing. Spec B line 60 quotes the old text; I did not change it, because published
     specs are not edited (Rule 13).
5. **SKILL.md §3 step 5 (new)**: "A ccloop failure answers 424 `ccloop-failed` with ccloop's own code and detail in the
   message (`ccloop-failed:<code>[: <detail>]`); it is a definite refusal, not an uncertain outcome, so fix the cause that
   code names before sending again."

## Commands run (PATH starts with node v22.13.1; logs are in /private/tmp/oec/logs/; each log was read back whole)

| Command | Log | Exit | Result |
|---|---|---|---|
| web vitest ccloopCodes, agentSelectionEditor, refusalExplain, refusalText, groupRefusal | final-fix-web-targeted.log | 0 | 5 files, 57/57 |
| root vitest tests/entry/skill, tests/control/shutdownHealing, startGuard, tests/panel/startGuardSocket | final-fix-root-targeted.log | 0 | 4 files, 27/27 |
| `npm run typecheck` | final-fix-typecheck.log | 0 | clean |
| `cd web && tsc -p . --noEmit` | final-fix-webtsc.log | 0 | clean |
| `npm run build --workspace web` | final-fix-webbuild.log | 0 | built |
| root vitest tests/panel/refusalCoverage + scanPanelText (after the build) | final-fix-panel.log | 0 | 2 files, 9/9 |
| FULL web suite `cd web && vitest run` | final-fix-web-full.log | 0 | 130 files, 1125/1125, 0 skipped |

## Red proof

Setup: a clone at commit 53c9a16a, made with `git clone --local <wt> /private/tmp/oec/mut/final-fix`, with
`node_modules` and `web/node_modules` symlinked. In that clone I applied one mutation at a time and ran only the named
test with `-t`. Every test went red on its named assertion. Logs: final-fix-mut{1..4}.log.

| # | Mutation | Test run | Result |
|---|---|---|---|
| M1 (I1) | `<code>{refusal.code}</code>` restored | ccloopCodes "a refusal notice…" | **red**, exit 1. :137 received `"ccloop-failed"`, expected `"ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT"` |
| M2 (I1) | `message: ""` restored | same test | **red**, exit 1. :142 received `"agent 版本与记录的不一致。"`, expected `"…：recorded 1.2.0, found 1.3.0"` |
| M3 | estimate line uses `explainCcloopCode` again | agentSelectionEditor "estimate's unknown ccloop code once" | **red**, exit 1. :333 received `"… · estimate-call-failed:omp-new-thing · omp-new-thing"` |
| M4 | blocked-run line always appends the words | ccloopCodes "shown once on the blocked-run line" | **red**, exit 1. :152 the alert text did not include the literal |

Restore: each mutation was reverted with `git checkout -- <file>`. Afterwards `git diff` and `git diff --cached` in the
clone were 0 bytes and 0 bytes (final-fix-restore-diff.txt and final-fix-restore-cached.txt). The main worktree was not
touched by any mutation.

## Concerns

- I could not discard the clone. The permission system denied `rm -rf /private/tmp/oec/mut/final-fix`, so it is still on
  disk at that path, clean at 53c9a16a. A human can delete it.
- The comment at shutdownHealing.test.ts:107 still says "and accept `start`". It was left because the brief said to change
  the title only.
- Spec B line 60 still quotes the old group-execution-pending text. It was left because published specs are not edited
  (Rule 13). A correction section could be added if that is wanted.
