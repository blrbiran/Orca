# Final whole-branch review: feat/error-codes-start-guard (28ac9eae..4095c659)

Reviewer: final-review seat, Orca session 026d10e3, 2026-10-15. Read-only review at head `4095c659`. Worktree status
was clean when the review started. I read: both specs, `common-preamble.md` (R1-R5, K1-K8), `progress.md`, every
per-task review's findings and minors, and the full `src/`, `skills/`, `web/src/` and test/fixture diff of the branch.
Spot reads covered ccloop `src/runtime/omp/ompSingleCall.ts:42` and `src/control/command.ts:343-350`.
I ran no tests (the full gate is running in the background); every claim below comes from reading the code.

Verdict: **Ready with fixes.** Critical 0, Important 1, Minor 9.

---

## 1. Cross-task seams

### 1a. ccloop-code paths, end to end (A1 → A2/A3/A4/A5 → A7)

| Path | Stored / sent (server) | Shown and explained (web) | Result |
|---|---|---|---|
| Command or read that hits a peer exit | 424 `ccloop-failed`, message `ccloop-failed:<code\|unknown>[: <detail>]` (controlErrors.ts:90-97) | `RefusalNotice` → `explainRefusal` (refusalExplain.ts:35); `refusalText` surfaces show "ccloop failed: <code>: <detail>" verbatim | **The ccloop code is not visible on the RefusalNotice surface; see I1** |
| apply-agent-update peer exit after reserve | plain Error → 500 (K2; webService.ts:738-744) | uncertain, the id is kept | OK |
| Profile probe / estimator slot | `probeFailureCode = peerCode` → `agent-selection-rejected:estimator:<code>` | ControlGroupView estimate line: the reasonCode, then `explainEstimateReason` | OK (Minor m1: an unknown code is repeated) |
| Selection preview, unavailable slot | `code: peerCode`, classification still on `error.code` | AgentSelectionEditor: the code, then `explainBesideCode` | OK |
| Agent-update observe / reconcile | `peerCode`, else `control-internal-error` | AgentSettings: the code, then the words | OK |
| Saved-result eligibility | `peerCode` | TaskDetail: the code, then the words | OK |
| Run reason (describeError, accept-refused) | `control-peer-exit:<exit>[:<code>][: <detail≤512>]` | RunReason: the explanation, then the raw `<code>` | OK, explained once |
| Single call, usage unknown | `<usageUnknownReason>:<code>` | `explainRunReason` USAGE_UNKNOWN branch; RequirementsPanel `blockedWords` | OK (m1 again for an unknown code) |
| Single call, estimate failed | `estimate-call-failed:<code>` (webService.ts:1174-1175, only when the classifier says call-failed; rawOutput is null for any non-complete outcome, executionDriver.ts:703-707) | estimate line | OK |
| Single call, clarify/split failed | call `outcome: "failed", reason: <code>`; pre-spawn refusals fail at once | RequirementsPanel: the latest failed call of a `failed` step (:264, :308) | OK |
| Paths left "unknown" (A8) | one stderr line each | n/a | OK |

Nothing is explained twice. One surface loses the code; see I1.

### 1b. Start predicate (B1) vs the guard (B2) vs editability (B3) vs the web (ControlGroupView Start, LoopPlanCard)

| Group state | B1 `executionPending` | B2 `start` | B3 `set-task-loop` (unstarted task) | Web Start (CGV:211) | LoopPlanCard open (:183) |
|---|---|---|---|---|---|
| ready, start/no-start/resume wake pending | true | 409 `group-execution-pending` (pre-probe + in-tx) | accepted | hidden | open |
| ready, only an estimate run active | false | `estimate-in-flight` | `estimate-in-flight` | shown (spec-intended) | open |
| running / review | true while busy | `group-execution-pending` if busy, else `group-state-invalid` | accepted | hidden (state ≠ ready) | open |
| paused (pause intent) | usually true | `group-execution-pending` if pending, else `stop-mode-conflict` | accepted | hidden (stopMode) | open |
| handoff-stopped / shutdown | true if held | `group-execution-pending` if held/pending | `group-state-invalid` | hidden | notOpen |
| held task | true | `group-execution-pending` | accepted (other tasks) | hidden | open |
| blocked / done | n/a | `group-execution-pending` or `group-state-invalid` | `group-state-invalid` | hidden | notOpen |
| clarifying | excluded | `requirement-not-split` (pre-probe exclusion, webDispatch.ts:130) | `requirement-not-split` | hidden | not rendered |
| `stopped` flag with no intent | — | — | `group-state-invalid` | hidden | **open** (summary has no `stopped`; this existed before the branch, Minor m7) |

Server and web agree in every state the branch touches. `controlOverview.ts:94-103` still counts every active run and the
`continuation` wake kind. It is strictly more conservative than the shared predicate, so it never offers a start the
server refuses, which matches the recorded interpretation.

### 1c. A5 errorCode → A6 retry → A7 RequirementsPanel

- A5 records a pre-spawn refusal as a failed call and fails the step with `clarify-output-invalid` / `split-output-invalid`.
- A6 `retryOutputBound` picks its step the same way `retryRequirementInTransaction` does: consensus null → latest
  round, else latest draft (webService.ts:597 vs stopIntent.ts:545-556). It stores the bound only when that transaction
  still re-queues (stopIntent.ts:559).
- A7 shows the latest failed call only on a `failed` step. After the retry the step is `drafting` (round) or a new
  draft, so the line disappears.
- The cap text ("…caps this model's output above the bound…") matches ccloop's check `row.maxTokens > request.maxOutputTokens`
  (ompSingleCall.ts:42).
- The seam is consistent.

---

## 2. Findings

### Important

**I1. A `ccloop-failed` refusal never shows ccloop's code, and some forms also drop the detail.** The surface is
`web/src/RefusalNotice.tsx:21` together with `web/src/refusalExplain.ts:35` and `web/src/ccloopCodes.ts:20`.

What happens:
- `explainRefusal` replaces the text with `explainCcloopCode(code, detail)`.
- `RefusalNotice` then prints `refusal.code`, which is `ccloop-failed`, beside that text.

Three consequences:
- **The ccloop code is never on screen** for any known code. For example `ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT`
  renders as "omp could not list its model catalog (spawn ENOENT)… · `ccloop-failed`".
- **The detail is dropped** whenever the matching entry has no `{{detail}}` slot. That is true of
  `single-call-unsupported` and `single-call-output-invalid` in the ccloop table.
- **In zh, the detail is dropped for every Orca-table fallback.** Examples: `agent-version-drift`,
  `agents-table-invalid`, `agent-selection-invalid`. Their zh entries interpolate `{{message}}`, and `explainCcloopCode`
  fills `message: ""` (ccloopCodes.ts:20). The en entries use `{{detail}}`, so the two languages differ.

Why it matters:
- Human ruling 2 (spec A §2): "always show ccloop's code and its (truncated) detail".
- The project rule pinned in `tests/panel/refusalCoverage.test.ts:82`: "The code is on screen beside the explanation".
- Every other §4.6 surface prints the code beside the words; this is the only one that does not.
- No criterion catches it: `web/tests/ccloopCodes.test.tsx` asserts only `explainRefusal(...).text`.

Fix (small, web-only):
- In `RefusalNotice`, print `refusal.code === "ccloop-failed" ? refusal.message : refusal.code` in the `<code>`. The
  message is already cut to 512 by the server.
- In `explainCcloopCode`, fill `message: detail` as well as `detail`, so zh Orca entries keep the detail.
- Add one criterion: render `RefusalNotice` for a known code in en and zh, and assert that `omp-model-catalog-unavailable`
  and the detail are in the text. Mutation: revert the `<code>` change.

### Minor

- **m1 (A7 deferred Minor 1, still open).** An unknown code is repeated: `estimate-call-failed:omp-new-thing · omp-new-thing`
  (ControlGroupView.tsx:490), and the blocked-run line likewise. Fix: in `explainEstimateReason` (ccloopCodes.ts:47-51)
  return null when the words equal the stripped code, and the same in the USAGE_UNKNOWN branch of `explainRunReason`
  (refusalExplain.ts:51). Then update the one literal at `agentSelectionEditor.test.tsx:324` / ccloopCodes.test.tsx:122.
  Optional.
- **m2. Driver round-failure log lines are now cut too.** `describeError` (executionDriver.ts:125-129) also feeds the
  stderr lines at :1016, :1019, :1033 and :1053. A peer exit there now logs 512 flattened units instead of the whole
  stderr, and a ccloop stack trace is no longer anywhere: §4.4 stopped storing it and these logs were the last copy.
  The spec cut only the stored reason (§4.4) and the §4.9 lines. Fix if wanted: log
  `error instanceof ControlError ? \`${error.code}:${error.detail}\` : describeError(error)` on those four lines.
- **m3. `group-execution-pending` says "dispatched automatically" in states where nothing will be.** A paused or
  handoff-stopped group with a pending wake or a held task now answers `group-execution-pending` instead of
  `stop-mode-conflict` (webDispatch.ts:133-137, 164-165). That precedence is spec B §3.2's.
  - en.ts:1135 and SKILL.md:32 ("dispatches the group's next task itself") can make an agent wait on a paused group.
  - Fix: reword, e.g. "…its next task is dispatched automatically unless the group is paused or stopped (read its stop
    state)". Change SKILL.md:32 the same way.
- **m4. SKILL.md does not describe 424 `ccloop-failed`.** §3 step 4 (SKILL.md:120) says "Other 4xx … do not retry the
  same payload", and §4 says to look up any `retryable: true` error first. A 424 is both, and it is never ledgered.
  Fix: one sentence saying that 424 `ccloop-failed` names ccloop's code, that nothing was booked, and that the lookup
  finds nothing and the command may be re-sent after the cause is fixed.
- **m5. `recoveryRetry` probes outside the admission gate** (webService.ts:580-583, :603). `confirm`, `setTaskLoop` and
  `scheduleStart` enter the gate before their first await. Here a ccloop probe can be spawned while the panel drains;
  `applyRecoveryRetry` then refuses with `panel-draining`. Harmless, but it does not match the neighbours (Rule 11).
  Fix: enter the gate in `recoveryRetry` around the probe and the apply.
- **m6. The cap-exceeded explanation says "this requirement"** (en.ts:1360, zh.ts equivalent), but it is also shown on
  the estimate line for `estimate-call-failed:omp-single-call-cap-exceeded` (pinned at ccloopCodes.test.tsx:87). There
  "Retry" means a new estimate. Fix: neutral wording ("the bound this call was prepared with … a retry or a new estimate
  recomputes it").
- **m7 (pre-existing).** For a `stopped` flag with no intent, LoopPlanCard shows the form, which the server refuses.
  The old card had the same gap. Not introduced here.
- **m8 (B2 Minors 1 and 3).** Two small leftovers:
  - The orphaned `scheduleStart` JSDoc at webDispatch.ts:127 now sits above `startRefusedAsPending`.
  - The stale title at `tests/control/shutdownHealing.test.ts:108` ("…and then accepts start") contradicts the
    criterion it names (Rule 9).
  Both are one-line fixes; recommended before merge.
- **m9 (A8 Minor 2).** `stopIntent.ts:657` writes `ccloop control-capability-probe-failed` for a failure that did not
  come from ccloop. This is accepted under the recorded "code only" interpretation. Optional: write the line only when
  the probe's error was a peer exit.

### Behaviour changes for real users not pinned by any test (Review Focus §2)

- I1 and m1-m6 above.
- Estimate-only active run → Start reappears and answers `estimate-in-flight`. This is spec-intended (B §3.1), and it is
  pinned in the server (startGuard C3) but not in the web.
- Selection-preview `unavailable` slots now carry ccloop codes. `App.tsx:1037` still auto-retries every `unavailable`
  slot, including one whose code is a definite ccloop refusal printed through exit 1. Unchanged control flow, noted only.
- set-task-loop in a running group moves `committedRemaining`/reserve live (webService.ts:1092-1093). It is guarded by
  `assertKnownConservation` at the end (:1121) and by setTaskLoopRunning C7/C8. I found no defect. The
  `enableOptionalTokenPolicy` branch (:1052-1056) is now reachable in a running group and has no running-group
  criterion. I could not verify it from the diff.

---

## 3. Every rewrite of an existing criterion

| File:line (head) | Old → new | Authority |
|---|---|---|
| tests/panel/agentSelectionApi.test.ts:273-276 | 500 `control-internal-error` → 424 `ccloop-failed`, message `ccloop-failed:unknown` | Spec A §5 (named) |
| tests/control/driverEstimate.test.ts:88 | `estimate-usage-unknown` → `estimate-usage-unknown:single-call-output-invalid` | Spec A §5 (named; K3 keeps :27) |
| tests/control/driverEstimate.test.ts:139 | `estimate-call-failed` → `estimate-call-failed:single-call-output-invalid` | Spec A §5 (named) |
| tests/control/driverRequirementSplit.test.ts:59 | call `outcome: "invalid"` → `"failed", reason: "single-call-output-invalid"` | Spec A §5 (named) |
| tests/control/setTaskLoop.test.ts:27 | `it.each(running, review, done, blocked)` refuse → `it.each(done, blocked)`, plus a new accept test (:36) | Spec B §5 (named; K6 keeps :33) |
| tests/control/shutdownHealing.test.ts:140-143 | start → `scheduled` becomes: deliver the no-start wake, then start → `group-execution-pending` | Ledger Ruling (B2, option a) |
| tests/control/handoffFailedRetry.test.ts:45-46 | `reopen().claim` sends a fresh start → claims through the waiting wake when pending (no assertion changed) | Ledger Ruling (B2, handoffFailedRetry) |
| web/tests/agentsI18n.test.tsx:126-127 | `被拒 · agent-installation-missing` → `… · 安装表里没有这个 agent。` | Ledger Ruling (A7 C1) |
| web/tests/budgetI18n.test.tsx:150-151 | `running` → `done` for the notOpen text | Spec B §5 (named) |
| web/tests/controlI18n.test.tsx:73-76, :145-146 | attempt label → "本次运行内第 N 次尝试（…） · 这个任务的第 1 次运行" | Human-named #61 (preamble "Existing criteria that change") |
| web/tests/loopPlanEdit.test.tsx:148-163 | running/review/paused notOpen → done/blocked/handoff/shutdown notOpen; draft/running/review/paused open | Spec B §5 (named) |
| tests/panel/refusalCoverage.test.ts:49-50, :57-58 (VIEW_REASONS) | additions only (`control-peer-exit`, `codex-rate-limited`); imports widened | Plan A7 / S2 (additive, no assertion weakened) |

None is unauthorised. Every other test file in the diff is new or additive (numstat: no deleted lines outside the rows
above). The ccloop `registry.test.ts:80` retitle (S3) is outside this branch and covered by R5 and the ledger.

## 4. Fixture changes: could one hide a real defect?

- **driverHarness.claim() (R1).** The first claim is unchanged (a fresh `start`). A later claim, while the group is
  pending, either delivers the dispatch wake already waiting or calls the production `replenishStartWakes`, then
  `deliverScheduledStart`.
  - This is the path production takes now that a second start is refused, so the fixture models production more
    closely than before.
  - The one thing it gives up is a revision bump per claim. No criterion I read depends on that for its intent.
  - It throws when replenish would arm nothing, so it cannot quietly claim nothing.
  - B2x showed the 10 handoffFailedRetry criteria depend on the "deliver a waiting wake" branch, and that branch is
    exactly what the driver does.
  - Low risk.
- **estimateHarness / requirementHarness.** Both are default-preserving: an absent `errorCode` keeps
  `single-call-output-invalid`, and `setResolveAgent(null)` keeps the base resolver. `baseResolveAgent` is exposed only
  for A6's tests. Low risk.
- **handoffFailedRetry `reopen()`** follows the same pending → claim pattern; it is covered by the ruling.

## 5. Deferred minors: triage

| Minor | Must fix before merge? |
|---|---|
| A1 M1 (brief over-claims A1a red list), M2 (style) | No |
| A5 m1 (A5g reds at the harness wait), m2 (split `reasons` unchanged is unpinned) | No |
| A6 M1 (`estimator-preflight-missing` unpinned), M2 (`requeue &&` unpinned) | No; registered gaps |
| A7 m1 (unknown code repeated on the estimate/blocked line) | No; optional (m1 above) |
| A7 m2 (brief over-claim), m3 ("unknown" wording) | No |
| A8 m1 (Set dedupe in peerFailureLog.test.ts:22 vs its comment) | No; reword the comment or assert the sequence (cheap) |
| A8 m2 (non-peer code logged as "ccloop") | No (m9) |
| B1 m1 (`kind === "task"` filter unpinned), m2 (phase list omits "estimate") | No |
| B2 m1 (orphaned JSDoc), m3 (stale shutdownHealing title) | **Recommended** (one line each; m3 is a criterion title that now says the opposite) |
| B2 m2 (startGuardSocket `?.code`) | No; optional |

No deferred minor blocks the merge. The one item to fix before merge is the new **I1**.

## 6. Verdict

**Ready with fixes.**
- Fix I1 (web-only, roughly 3 lines plus one criterion with its mutation seen red).
- Fix the two one-line B2 leftovers (m8) in the same pass.
- The other Minors are optional and can be filed.
- Server seams (A1-A6, B1-B3) are consistent across every group state I traced. The fixture changes do not mask a
  production path.

---

## Re-review 1 (fix commit 53c9a16a, diff review-4095c659..53c9a16a.diff)

This is a read-only scoped re-review. I read the whole fix diff and `task-final-fix-report.md`.

Verification run at 53c9a16a: `cd web && ../node_modules/.bin/vitest run tests/ccloopCodes.test.tsx tests/agentSelectionEditor.test.tsx tests/groupRefusal.test.tsx`
→ 3 files, 43/43, rc=0 (log `/private/tmp/oec/logs/final-rr-web.log`, read back whole). Worktree status was clean.
I did not re-run the implementer's mutations (M1-M4). Their reported reds land on the named assertions, and each
mutation is the direct inverse of its fix line.

| Item | Verdict | Where |
|---|---|---|
| I1: the notice hides ccloop's code | **ADDRESSED** | `web/src/RefusalNotice.tsx:22` prints `refusal.message` for `ccloop-failed`, so the code and the cut detail are on screen, including for entries without a `{{detail}}` slot. Pinned by `web/tests/ccloopCodes.test.tsx:131-144` (en catalog, en single-call-unsupported, zh catalog). |
| I1: the zh Orca fallback drops the detail | **ADDRESSED** | `web/src/ccloopCodes.ts:20` fills `message: detail`; pinned by the zh agent-version-drift literal (ccloopCodes.test.tsx:142-143). `explainBesideCode` passes `""`, so the other surfaces are unchanged. |
| m8: scheduleStart doc comment | **ADDRESSED** | `src/control/webDispatch.ts:137`, directly above `scheduleStart`. |
| m8: shutdownHealing title | **ADDRESSED** (title) | `tests/control/shutdownHealing.test.ts:108`. Leftover: the comment at `:107` still ends "and accept `start`" (Minor, cosmetic). |
| m1: an unknown code is shown twice (estimate line) | **ADDRESSED** | `web/src/ccloopCodes.ts:49-50` (`explainBesideCode`); pinned by `agentSelectionEditor.test.tsx` › "shows an estimate's unknown ccloop code once". |
| m1: an unknown code is shown twice (blocked-run line) | **ADDRESSED** | `web/src/refusalExplain.ts:51-54`; pinned by `ccloopCodes.test.tsx` › "an unknown code is shown once on the blocked-run line" (full literal). |
| m3: group-execution-pending text without "dispatched automatically" | **ADDRESSED** | `web/src/locales/en.ts:1135`, `web/src/locales/zh.ts:1071`, `skills/orca-control/SKILL.md:32`. Spec B §3.2 still quotes the old sentence. It was left unedited on purpose under Rule 13; a correction note can be appended (optional). |
| m4: SKILL.md names the 424 | **ADDRESSED** | `skills/orca-control/SKILL.md:121` (§3 step 5): it names `ccloop-failed`, says it is a definite refusal, and gives the message shape. |

### Assertions that changed

All three changed assertions are in criteria this branch itself added in A7. None was a criterion before the branch.
- `web/tests/agentSelectionEditor.test.tsx:324`. The test "explains a slot's ccloop code and an estimate's ccloop reason" does not exist at `28ac9eae` (`git show 28ac9eae:…` | grep count 0).
- `web/tests/ccloopCodes.test.tsx:84` and `:108`. The file does not exist at `28ac9eae`.

The only line of a pre-existing test that changed is the shutdownHealing **title** (:108), and m8 names that change.
No pre-existing assertion changed.

### New breakage in the fix diff

None found.
- `refusal.message` is used only for `ccloop-failed`. The server always builds that message (`ccloopFailedMessage`), so
  no localised or unexpected text reaches the `<code>`.
- `message: detail` cannot affect any en entry: en entries never interpolate `{{message}}` (refusalCoverage :86).
- The rewrite at `ccloopCodes.test.tsx:108` (`…settled. · `) is weaker than the old literal. The new blocked-run test
  pins the full line, so coverage is not lost.

**Re-review verdict:** every targeted item is ADDRESSED. Two optional cosmetic leftovers remain: the stale comment at
shutdownHealing.test.ts:107 and the spec B correction note. **Ready to merge** as far as this review's findings go.
