# Task A7 report (implementer, Orca session 026d10e3 subagent, 2026-10-15)

Status: DONE_WITH_CONCERNS
Commit: 5c54e447 `feat(web): explain ccloop's codes in English and Chinese wherever the panel shows one` (on 265642c3, branch feat/error-codes-start-guard)

## What changed (lines at 5c54e447)
- `web/src/ccloopCodes.ts` (new, brief text verbatim): `explainCcloopCode`, `codeAndDetail`, `peerExitReason`, `explainEstimateReason`.
- `web/src/refusalExplain.ts:8` import; `:35` `ccloop-failed` special case in `explainRefusal`; `:41-52` `PEER_PREFIXES`, `USAGE_UNKNOWN`, new `explainRunReason` (brief text verbatim).
- `web/src/AgentSelectionEditor.tsx:16,74`; `web/src/AgentSettings.tsx:11,119`; `web/src/ControlGroupView.tsx:22,490` (brief text verbatim).
- `web/src/TaskDetail.tsx:21,308-309` — DEVIATION 2 below.
- `web/src/RequirementsPanel.tsx:13-14` imports; `:263-264` `failedCall`; `:308` failed-call paragraph (verbatim); `:273-275,310` blocked-run explanation — DEVIATION 1 below.
- `web/src/locales/en.ts`: `ccloop` keys before `enums:` (`:1034-1035`), `enErrors["control-peer-exit"]` after `ccloop-failed` (`:1065-1066`), `enCcloopErrors` at end (`:1354-1363`). `web/src/locales/zh.ts`: same three places (`:933-934`, `:1002`, `:1290-1299`). Texts per the brief table, generic per R3 (`{{code}}: {{detail}}` / `{{code}}：{{detail}}`, `{{code}}`).
- `tests/panel/refusalCoverage.test.ts`: imports, `"control-peer-exit"` in VIEW_REASONS, `CCLOOP_CODES` test (verbatim).
- `web/tests/ccloopCodes.test.tsx` (new), appended tests in `web/tests/agentSelectionEditor.test.tsx`, `web/tests/agentSettings.test.tsx`.

## R3 literal substitution
Applied mechanically to every literal (10 in ccloopCodes.test.tsx + 1 in agentSelectionEditor.test.tsx = 11, not the 9 R3 counts):
`ccloop failed with X: y`→`X: y`, `ccloop failed with X.`→`X`, `ccloop 失败（X）：y`→`X：y`, `ccloop 失败（X）。`→`X`.

## Deviations (Rule 1 step 2: reversible, decided here)
1. **RequirementsPanel blocked-run line.** The brief's verbatim `explainRunReason(blockedRun.reason)` explained every blocked reason, which turned the existing criterion `web/tests/requirements.test.tsx:196-198` ("names a blocked call's reason and retries that run", expects `/^repository-path · This step's call is blocked/`) red (seen in a7-green-web.log, first run). Not edited. Implementation narrowed: `blockedWords = blockedRun?.reason?.includes(":") ? explainRunReason(blockedRun.reason) : null` — only a reason that carries a code after its prefix is explained. Both that existing test and the new "a failed requirement…" row are green; each pins one side of the condition.
2. **TaskDetail saved-result line + its test.** After R3 the generic text for an unknown code is the bare code, so the verbatim line rendered `<code>X</code> X`. That turned the existing criterion `web/tests/savedResultRecovery.test.tsx:26-30` red ("Found multiple elements with the text: /saved-result-legacy-ref-missing/" — `saved-result-legacy-ref-missing` is an Orca code with no table entry). Not edited. Implementation: the explanation is appended only when it differs from the code. The R3-substituted "a saved-result reason" test (`toContain("omp-new-thing")`) would also have been vacuous (the `<code>` itself contains it), so it now uses a known code `omp-model-catalog-unavailable` and asserts `"omp-model-catalog-unavailable omp could not list its model catalog. Check that omp is installed and starts, then retry."` (en) and `"omp-model-catalog-unavailable omp 无法列出它的模型目录。请确认 omp 已安装且能启动，然后重试。"` (zh). Reviewer's A7g TaskDetail mutation spec must change: e.g. `{"from": "{words!==answer.reason?` ${words}`:\"\"}", "to": ""}`.

## Commands (all logs under /private/tmp/oec/logs/, read whole)
- RED web `a7-red-web.log` rc=1: ccloopCodes.test.tsx failed to load (`../src/ccloopCodes.js` missing); agentSelectionEditor appended test red at `toContain` (slot line); agentSettings appended test red at `toContain`; 34 others passed.
- RED root `a7-red.log` rc=1: refusalCoverage 3 failed (en and zh `["control-peer-exit"]`; CCLOOP_CODES `TypeError` on undefined import), 3 passed.
- GREEN web `a7-green-web.log` rc=0: 10 files, 117/117 passed (ccloopCodes, agentSelectionEditor, agentSettings, refusalExplain, refusalText, codexRateLimited, requirements, i18nKeys, i18nPseudo, runReasonDiagnosis).
- Extra web neighbours (files whose tests touch the changed surfaces) `a7-neighbours-web.log` rc=0: 18 files, 117/117 passed (first run before deviation 2: 1 failed, savedResultRecovery).
- `a7-saved.log` rc=0: ccloopCodes + savedResultRecovery 12/12.
- web tsc `a7-webtsc.log` rc=0. Web build `a7-webbuild.log` rc=0. Root `a7-green.log` rc=0: refusalCoverage + scanPanelText + tests/metrics, 11 files 74/74. Root `npm run typecheck` `a7-typecheck.log` rc=0. No skipped tests in any log.

## Concerns
- Same R3 duplication, no test reds it: for an unknown code the generic explanation equals the code already on screen at AgentSelectionEditor (`unavailable · X · X`), AgentSettings (`Detection unavailable · X X`) and the RequirementsPanel failed-call paragraph (`X · X`). Kept per brief; suggest the same "skip when equal to the code" guard there (controller's call).
- Mutation specs A7g (TaskDetail) needs the new `from` text (above); the others match the committed text.

## Controller follow-up (approved "show an unknown code once"; implementer subagent, 2026-10-15)

Commit: 3c5f21bd `fix(web): show an unknown ccloop code once, not beside itself` (on 5c54e447)

- `web/src/ccloopCodes.ts`: new `explainBesideCode(code): string | null`, which returns the explanation, or null when it equals the code (R3 generic). All four surfaces that show the code beside its explanation now use it: AgentSelectionEditor `FailedCell`, AgentSettings failure line, TaskDetail saved-result line (replaces the inline guard from 5c54e447), and the RequirementsPanel failed-call line. ControlGroupView (`explainEstimateReason`) and the blocked-run line are unchanged; their prefixed code is never equal to the explanation.
- New criteria for an unknown code, with literal text:
  - `agentSelectionEditor.test.tsx` "shows a slot's unknown ccloop code once, not beside itself": `toBe("unavailable for now, Re-read to ask again · omp-new-thing")`.
  - `agentSettings.test.tsx` "shows a failed detection's unknown ccloop code once": `toBe("Detection unavailable · omp-new-thing")`.
  - `ccloopCodes.test.tsx` "an unknown code is shown once on the failed-call line and the saved-result line": the status paragraphs contain exactly `"omp-new-thing"`, and the saved-result paragraph `toBe("Saved results are unavailable for verification. omp-new-thing")`.
  - The known-code criteria from 5c54e447 are kept: the slot, detection, failed-call and saved-result rows with `omp-model-catalog-unavailable` / `agent-config-invalid` / `omp-single-call-cap-exceeded`. They go red if the explanation is removed.
- Seen red: the three new web tests were run against 5c54e447 in clone `/private/tmp/oec/mut/a7f-red` (only the test files copied in). Log `a7f-red.log` rc=1, 3 failed / 44 passed. Each failed on its own assertion: `"… · omp-new-thing · omp-new-thing"`, `"Detection unavailable · omp-new-thing omp-new-thing"`, `['omp-new-thing · omp-new-thing'] to include 'omp-new-thing'`. The clone stays there for the reviewer; deleting it needs the human.
- Green results:
  - `a7f-green-web.log` rc=0: 14 files, 164/164 (ccloopCodes, agentSelectionEditor, agentSettings, savedResultRecovery, requirements, refusalExplain, refusalText, i18nKeys, i18nPseudo, runReasonDiagnosis, agentPreviewRefresh, controlPanel, requirementsI18n, feedbackRequirements).
  - Web tsc `a7f-webtsc.log` rc=0. Root typecheck `a7f-typecheck.log` rc=0. Web build `a7f-webbuild.log` rc=0.
  - Root refusalCoverage + scanPanelText `a7f-root.log` rc=0, 9/9. No skipped tests.

Updated mutation `from` texts for the reviewer (A7g, at 3c5f21bd):
- AgentSelectionEditor: `{"from": "{words !== null ? ` · ${words}` : \"\"}", "to": ""}`, test `tests/agentSelectionEditor.test.tsx`. This reds the known-code slot line. The unknown-code test stays green under this mutation by design. To see the unknown-code test red, use `{"from": "  return words === code ? null : words;", "to": "  return words;"}` in `web/src/ccloopCodes.ts`. That reds all three new unknown-code tests and savedResultRecovery.
- AgentSettings: `{"from": "{explainBesideCode(installation.failureCode) !== null ? ` ${explainBesideCode(installation.failureCode)}` : \"\"}", "to": ""}`, test `tests/agentSettings.test.tsx`.
- TaskDetail: `{"from": "{words!==null?` ${words}`:\"\"}", "to": ""}`, test `tests/ccloopCodes.test.tsx` ("a saved-result reason").
- RequirementsPanel failed call: `{"from": "{explainBesideCode(failedCall.reason) !== null ? ` · ${explainBesideCode(failedCall.reason)}` : \"\"}", "to": ""}`, test `tests/ccloopCodes.test.tsx` ("a failed requirement…").
- ControlGroupView: unchanged from the brief.

## Fix round 1 (task-A7-review.md C1, I1; implementer subagent, 2026-10-15)

Commit: 0a09d096 `test(web): pin the failed call a requirement shows and the explained rejected slot`

- **C1 (my miss).** My A7 change turned `web/tests/agentsI18n.test.tsx:126` red, and my report did not say so: I ran only the targeted and neighbouring files, and my neighbour grep did not cover this file. Under the controller's ruling, that one assertion is rewritten to `["协调", "被拒 · agent-installation-missing · 安装表里没有这个 agent。", ""]`, with a comment above it: "A rejected slot shows its code and the Orca-table explanation, spec 2026-10-15 ccloop error codes §4.6." The same test has no en counterpart. `:103` uses `toContain` on the `被拒 · agent-installation-missing` prefix, still passes, and is untouched.
- **I1.** New test in `web/tests/ccloopCodes.test.tsx`: "a failed requirement names its latest failed call, and a drafting one names none".
  - (a) A failed round with calls `omp-model-catalog-invalid` then `omp-single-call-cap-exceeded`: one status paragraph is exactly `omp-single-call-cap-exceeded · <EN_CAP>`, and the panel text does not contain `omp-model-catalog-invalid`.
  - (b) A drafting round that holds a failed `omp-model-catalog-invalid` call: the panel text does not contain `omp-model-catalog-invalid`.
  - Seen red in clone `/private/tmp/oec/mut/a7f-red`, after the clone's web sources were synced to the worktree; the file was restored after each run and `cmp` with the worktree gives 0.
    - Dropping `.reverse()`: `a7-fix1-i1a.log` rc=1, red at `:120` (`expected [ Array(1) ] to include 'omp-single-call-cap-exceeded · …'`).
    - `step?.state === "failed" ?` changed to `step ?`: `a7-fix1-i1b.log` rc=1, red at `:124` (`not to contain 'omp-model-catalog-invalid'`).
  - Both logs are kept whole on disk. I filtered only my on-screen view of them, to hide stack-trace lines.
- **Full web suite** `a7-fix1-web-full.log` rc=0: 129 files, 1118/1118 passed, 0 skipped. Web tsc `a7-fix1-webtsc.log` rc=0. Root typecheck `a7-fix1-typecheck.log` rc=0.
