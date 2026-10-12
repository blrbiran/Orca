# Task 8 scoped fix re-review

Scope: commit `56925d0e42a3e936d65227261b7e388bae0904be..87463dc8188676d36d987ac506acc36041f98040`, reviewed only against the three required findings in `task-8-independent-review.md` and for breakage introduced by this fix. I read the complete 527-line scoped diff, the fix report, gate manifest, and relevant raw logs. Current HEAD/tree match the manifest: `87463dc8188676d36d987ac506acc36041f98040` / `11ed492fda9eb02abd9111f7cc53bcd7cfcc9c1c`. No source, index, or HEAD changes and no tests rerun by this reviewer.

## Finding 1: browser no-estimator import — ADDRESSED

`web/src/ControlPanel.tsx:136-137` now renders the no-estimator note alongside the ordinary repository/plan controls. `web/src/ControlPanel.tsx:202-215` constructs an import payload with only group/repository/plan when defaults are null, while preserving the configured estimator fields otherwise. The note is truthful in both locales (`web/src/locales/en.ts:347`, `web/src/locales/zh.ts:233`). The new browser test clicks the real import button and checks the exact three-field payload, plus the configured path and Chinese text (`web/tests/importNoEstimator.test.tsx:21-47`). This closes the normal browser path identified in the first review.

## Finding 2: null-mask inheritance labels — ADDRESSED

`web/src/AgentFields.tsx:179-183` now treats a stored `null` model/context field as inherited; `web/src/AgentFields.tsx:205-208` does the same for a null Agent field, using the server-resolved value and provenance. The masked-Agent fallback also uses the resolved selection at `web/src/AgentFields.tsx:170-176`. The added test masks all three plan fields and checks the concrete inherited values and sources (`web/tests/agentSelectionEditor.test.tsx:257-270`). No new field resolution or hash computation was introduced in the browser.

## Finding 3: claim-time capability reason — ADDRESSED

`src/control/estimator.ts:116-130` factors the existing degradation predicate into named reasons, including the shared selected-resolution compatibility reasons and degradation relative to the queued request. `src/control/webService.ts:519-525` stores those reasons on the blocked estimate while retaining the historical generic `reasonCode`. The existing panel projection exposes that optional field. The single-call regression now asserts the stored and projected `single-call-unavailable` reason and no run (`tests/control/estimateSingleCallGate.test.ts:35-45`); the context-shrink criterion checks `context-window-degraded` (`tests/control/estimator.test.ts:38-41`). I found no changed behavior in the boolean gate: the new reason checks cover the former null context, handoff, usage, budget, and strict-bound refusal branches.

## New breakage check

No new issue found in the scoped changes. The no-estimator payload remains valid for the existing optional import schema; configured payload fields are unchanged. The claim path continues to block rather than dispatch on degraded capability, and the new reason array is a nonempty optional field on blocked records. The inheritance fix changes display text and option fallback only.

## Gate evidence and limits

`task8-fix-gates.json` records exit 0 on this exact HEAD for root typecheck, root build, Web build, focused root, diff check, and a final unfiltered Web check. Raw logs corroborate focused root **20/20 files and 252/252 tests** (`task8-fix-focused-root.log`) and final Web **107/107 files and 941/941 tests** (`task8-fix-full-web-retry.log`). The first full Web run returned 1 with one `overviewDecisionNavigation` timeout and 940 passed; its raw log is retained. That file then passed 10/10 in each of three isolated runs, followed by the unfiltered green retry at the same HEAD. The raw type/build logs show normal completion and their manifest exit codes are 0. No whole-root run was repeated in this fix round; Task 14 owns that separate gate.

## Verdict

**All three required findings are addressed.** The scoped fix is acceptable for Task 8, subject to the separate Task 14 whole-root gate. This verdict covers the fix diff, not untouched code or deployment.
