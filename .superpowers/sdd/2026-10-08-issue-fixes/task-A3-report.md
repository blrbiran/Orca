# Task A3 report (implementer A3, session e34dc963, 2026-10-08)

Status: DONE. Commit 640cb39 feat(web): explain every refusal in English and Chinese (base 6c19224).
(First pass was BLOCKED on two unapproved reds; the controller ruled both rewrites approved -- see 'Ruling applied' below.)

## Files changed (all in 640cb39)
web/src/locales/en.ts (enErrors appended, 243 keys, same keys and order as zhErrors -- checked by script),
web/src/locales/zh.ts (command-result-not-found -> {{detail}}; 18 view-shown reasons appended, verbatim from brief),
web/src/i18n.ts (errorTable/errorEntry/fillEntry/refusalDetail/refusalText, verbatim from brief),
web/src/Refusal.tsx (doc, verbatim), tests/panel/refusalCoverage.test.ts (verbatim),
web/tests/refusalText.test.tsx (verbatim + controller amendment: in the first test, for `a-code-nobody-listed` in English,
`expect(screen.getByTestId("refusal-code").textContent).toBe("a-code-nobody-listed")` beside the SENT message assertion),
web/tests/decisionsStatusFilter.test.tsx (verbatim).

## TDD
RED (scratchpad/orca/A3/red-root.txt, red-web.txt; load 3.70): coverage 5/5 failed (zh missing the 18 view reasons;
en: "Cannot convert undefined or null to object"); web: the rewritten first test (enErrors undefined), the {{detail}} test
(got 'labels-invalid:count:17'), decisionsStatusFilter (enErrors undefined).
GREEN: coverage 5/5 rc=0; `npm run typecheck` rc=0; web refusalText, decisionsStatusFilter, usagePanel, i18nKeys,
i18nPseudo: 5 files, 61 tests rc=0.

## BLOCKER: `npm run --workspace web check` rc=1 (web.txt; tsc ok; 77/79 files, 617/619 tests pass; load 16.38)
Both are deterministic consequences of spec §2.2(a) (English now shows the code's entry), not load flakes:
1. web/tests/authGate.test.tsx "keeps the login form and shows the refusal when the login is refused" (line 76):
   `await screen.findByText("the name or the password is wrong")` -- the fixture's server message for `login-failed`;
   the page now shows enErrors["login-failed"] "The user name or password is wrong." (code still shown).
   Proposed rewrite: `await screen.findByText(enErrors["login-failed"])` (+ import), with a "Rewritten for spec 2026-10-08
   §2.2(a)" comment.
2. web/tests/outcome.test.tsx "Refusal > renders the server's code and message" (line 55):
   `expect(html).toContain(alreadyRecorded.message)` ("distinct panel refusal sentence") -- now the
   correction-already-recorded entry is shown. Proposed rewrite: assert `enErrors["correction-already-recorded"]`
   (HTML-escaped quotes: the entry contains `"Record another"`, renderToStaticMarkup emits `&quot;` -- so compare with the
   escaped form, or assert via a code with no entry to keep "message as sent"), and rename to "renders the server's code
   and the entry for it".
Needs a ruling approving these two rewrites; then: apply, run web check, commit (brief Step 6 paths + these two files),
run the 5 mutations in a clone.

## en wording notes (judgment calls, for review)
- Verbatim entries from the brief used as given. Others: zh {{message}} -> {{detail}}; one action sentence only where a
  real action exists (e.g. estimate-stale -> "Re-estimate", panel buttons "Retry run", "Resume dispatch").
- http-unreachable mirrors the brief's panel-unreachable text (same zh text for both).
- control-owner-changed: "Another process took over the control store." (src/control/store.ts: owner nonce changed).
- run-generation-conflict: "attempt number" instead of "generation"; stop-proof-generation: "a different attempt of this
  run" (plain word over jargon per controller note) -- reviewer may prefer otherwise.
- control-estimator-unconfigured / control-port-unconfigured: restart advice; flags not named (not verified).

## Ruling applied (controller): the two blocking rewrites
1. web/tests/authGate.test.tsx "keeps the login form and shows the refusal when the login is refused":
   old `await screen.findByText("the name or the password is wrong");`
   new `await screen.findByText(enErrors["login-failed"]!);` + `expect(screen.getByTestId("refusal-code").textContent).toBe("login-failed");`
   (form-stays and app-body-absent assertions kept).
2. web/tests/outcome.test.tsx "Refusal > renders the server's code and message" -> renamed "renders the server's code and the English entry for it":
   old `expect(html).toContain(alreadyRecorded.message);`
   new `expect(html).toContain(enErrors["correction-already-recorded"]!.split('"').join("&quot;"));` +
       `expect(html).not.toContain(alreadyRecorded.message);` (code assertion kept). Exact match against the escaped entry.

## Final verification (scratchpad/orca/A3; load 9.45)
`npm run --workspace web check` rc=0 (web2.txt: tsc ok, 79 files, 619 tests passed); `npm run typecheck` rc=0;
refusalCoverage 5/5 rc=0. Worktree `/usr/bin/git diff | wc -c` = 0 and `--cached` = 0 after commit and after mutations.

## Mutation (clone of 640cb39 at scratchpad/orca/A3/mut, web built; discarded after)
1. delete enErrors "group-not-found" -> RED "has a en entry ..." and "keeps the two tables over the same codes" (m1.txt)
2. delete zhErrors "group-not-found" -> RED "has a zh entry ..." (and the same-codes test) (m2.txt)
3. en labels-invalid uses {{message}} -> RED "never repeats the code in English" (m3.txt)
4. refusalText passes detail: refusal.message -> RED "fills {{detail}} ..." (got 'The labels are not valid: labels-invalid:count:17') (m4.txt)
5. restore `if (currentLanguage() !== "zh") return refusal.message;` -> RED "renders an English refusal's entry ..." (and fills {{detail}}) (m5.txt)
All five seen red.

## Fix round 1 (review findings 1-6) -- commit f7daa8a on top of c60b5a5 (A3, 2026-10-08)
Changes:
1. skills-unsupported-agent (en+zh): claude OR codex -- verified webService.ts:152 and executionDriver.ts:289 (`kind !== "claude" && kind !== "codex"`).
2. checkpoint-usage-high-water (en+zh): "differs" -- verified checkpoints.ts:24 / driverHandoff.ts:335 use `!==`.
3. control-internal-error en: "failed internally ({{detail}}). Retry; ..." -- no double period.
4. web/src/i18n.ts fillEntry: for an empty value, drop ` (...{{x}})` / `（...{{x}}）`, turn a trailing `: {{x}}` into "." (`：{{x}}` into "。"), and drop a mid-sentence `: {{x}}`.
5. work-already-active (en+zh) reworded to be true at budget.ts:131/continuation.ts:37 (active run, bare) and continuation.ts:148 (not held, detail = work item id): "This task already has a run in progress, or is not paused waiting to be continued ({{detail}}). Wait for its run to settle, then read the group again."; spend-cap-repository-unknown and identity-space-exhausted gain {{detail}} (en) / {{message}} (zh).
6. Stale "124 at ac969bb" comment in en.ts replaced ("refusalCoverage.test.ts pins the count").
Tests: refusalText.test.tsx -- the bare labels-invalid pin now "The labels are not valid." and new test "drops the separator around an
empty detail ..." (recovery-blocked bare, control-internal-error bare and with "disk full.", parenthesis in en and zh, zh trailing colon).
DEVIATION: web/tests/refusalExplain.test.ts (A4's test) pinned the same dangling colon ("The plan was not imported: " for a bare
control-plan-rejected); rewritten to "The plan was not imported." with a comment -- same root as the finding's approved labels pin.
Verification (scratchpad/orca/A3, load 5.46): refusalCoverage 5/5 rc=0 (f1-cov.txt); typecheck rc=0 (f1-tc.txt); web check first
rc=1 on the A4 pin only (f1-web.txt), after rewrite rc=0, 80 files / 627 tests (f1-web2.txt). Worktree diff/cached 0/0 after commit and after mutation.
Mutation (clone mut2 of f7daa8a, discarded): fillEntry's empty-value branch disabled -> RED "fills {{detail}} ..." (got 'The labels are not valid: ')
and "drops the separator ..." (got 'Recovery is blocked: . Clear ...') (f1-mut.txt).
