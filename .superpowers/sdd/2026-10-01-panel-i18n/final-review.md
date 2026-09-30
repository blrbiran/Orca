# Final whole-branch review — loop-plans follow-ups (W1–W7) + panel i18n

Reviewer: final whole-branch review subagent of session `e604b1ba`, 2026-10-01. Range `9d4a335..2bcd2b0` on local `main`,
37 commits, read from `.superpowers/sdd/2026-10-01-panel-i18n/review-9d4a335..2bcd2b0.diff` (1 081 149 bytes, `wc -c` at
`2bcd2b0`) in parts, plus the current files. Read-only on the repository. Probes ran only in
`$SCRATCHPAD/final-review/clone` (`git clone --local` at `2bcd2b0`, `node_modules` symlinked); the clone is kept (P10).
The full test gate is another agent's; I ran targeted single-file runs only (`> file 2>&1; echo rc=$?`, files read whole).

Inputs read: `docs/superpowers/specs/2026-10-01-panel-i18n-design.md` (rev 2), the plan's "Controller rulings",
`docs/superpowers/specs/2026-09-30-loop-plans-design.md` §12, both ledgers, the eleven `task-N-review.md` files.

## Verdict

**Ready after fixes** — one Critical (a server/web cross-layer defect no task review could see), no Important. Everything
else is Minor, the deferred minors included; the triage below names the few worth one commit before the human pushes.

## Strengths

- The one design decision that carries the round — the server sends loop-plan fields and the panel builds the words
  (`src/control/webProtocol.ts:953-968`, `web/src/LoopPlanCard.tsx:40-56`) — is done cleanly: the strict schema refuses
  `summary`/`planName` (`tests/control/loopPlanViewFields.test.ts`), the English lines are pinned as literals from the
  removed `describeLoopPlan`, and versioned keys (`loopPlan.plan.<id>.v<n>`) mean a v2 rename can never retitle a v1 task.
- W6 is the right shape: `planHash` stays the archive's identity while the model reads effective contracts
  (`src/control/estimator.ts:53-58`), and `readEstimateRecord` accepts only an archive copy whose loop tasks re-expand and
  re-hash (`src/control/taskAmendments.ts:102-119`), with seven forgeries pinned red
  (`tests/control/estimateEffectiveContracts.test.ts:77-102`).
- The timer cap is complete. I traced every timer the contract's time fields reach: ccloop's phase timer is
  `min(perAttemptTimeoutMs, timeRemainingMs)` (`node_modules/ccloop/dist/src/controller/runLoop.js:308-309,325`), so capping
  `perAttemptTimeoutMs` alone suffices even when `totalRuntimeBudgetMs` (= `activeMs`) exceeds 2^31−1;
  `partialOutcomeRecoveryWindowMs` reaches only a prompt (`prompts.js:39`) and is ≤ 60 000 by derivation. Orca derives the
  phase timeout in exactly three places (`executionSnapshot.ts:210`, `controlViews.ts:396`, `service.ts:127`) and all three
  are capped; the scheduler's original v2 contract (`planFile.ts:163`, perAttempt 2^31−1 > total 14 400 000) is not refined by
  ccloop's schema (`contract/schema.js:38-39`) and is clamped by `getPhaseTimeoutMs` at run time.
- i18n safety measured, not assumed: with i18next 26.4.2 (`node -e 'require("i18next/package.json").version'` at
  `2bcd2b0`) a value containing `$&`, `` $` ``, `$1`, `$$`, `$t(two)` or `{{a}}` renders byte-for-byte
  (`$SCRATCHPAD/final-review`, probe in this review's session); `web/tests/i18nPseudo.test.tsx:237` pins it. The only
  markup-bearing string (`loopPlan.git`) interpolates a group id the server constrains to `idSchema`; `refusalText` uses a
  function replacer, so `$` in a server message is inert; `hasOwnProperty` guards `zhErrors` (`web/src/i18n.ts:101-104`);
  no `dangerouslySetInnerHTML`/`innerHTML` in `web/src` (grep, 0 hits).
- Rule 13 held: `git diff --numstat 9d4a335..2bcd2b0 -- .superpowers docs` shows additions only (4930/29/244, 0 deletions);
  spec §12 is a new section. Protocol/web parity is compile-checked both ways for `GroupViewV1`, `SetTaskLoopPayload`,
  the metrics report and coverage (`tests/panel/webParity.test.ts:43-71,153-165,221-222`); the three H18 rewrites there
  normalise only the optional codes.
- Every task review was real: each found unseen `t`/`enumText` sites and forced a fix round (Tasks 1, 2, 4, 10, 11), and
  the mutation discipline (named deletion seen red, clone-only, `cmp`-verified restore) is visible in every report.

## Issues

### Critical (must fix before the human pushes)

#### C1. A label-chosen loop task cannot take an estimate's one-click suggestion, and a budget-only change on it marks every estimate stale (W5 × W6 × W7 × W3)

- **Where:** `src/control/webService.ts:628-629`
  ```ts
  const expanded: LoopTaskExpansion = kept ? keptExpansion(taskId, repoPath, { ...current.loop!, chosenBy: "explicit", inputs: structuredClone(payload.inputs) })
  ```
  The W7 "kept" path (same plan, same inputs) keeps the plan version and the contract bytes, but rewrites the recipe's
  `chosenBy` to `"explicit"`. For a task whose plan was chosen by its labels (a plan file without `plan`, `planFile.ts:163`
  → `chosenBy: "labels"`), the amendment record's recipe therefore differs from the effective one even though the contract
  is identical. The effective plan (`effectivePlan`, which carries `task.loop`) changes bytes, so:
  1. `refuseStaleEstimate` at the end of the same transaction (`webService.ts:694-695`) sees the estimate's snapshot ≠ the
     new effective plan and throws `estimate-stale`; the whole set-task-loop rolls back. **One-click Apply (H6) and "Apply
     all" (H16) are refused for every label-chosen loop task** on its first change — and label choice is the default.
  2. A plain budget-only change (no provenance) succeeds but flips the recipe to explicit: every ready estimate becomes
     `stale: true` (`controlViews.ts:415`), the card shows "This estimate predates a plan change" for a change that was not
     a plan change (contradicting the W3 ruling and spec §12 "a budget-only change never shows it"), and the title changes
     from ``chosen by label `bug` `` to "chosen by hand".
- **Measured** (`$SCRATCHPAD/final-review/probe-labels.txt`, clone at `2bcd2b0`, fixture `{ taskId: "a", loop: {…no plan},
  labels: ["bug"] }`, import-time estimate driven to `ready`):
  ```
  BEFORE chosenBy labels planId bugfix stale false
  APPLY ANSWER {"code":"estimate-stale",...}
  HUMAN ANSWER {"kind":"task-loop-set","taskId":"a","loopVersion":1,"proposalVersion":2}
  AFTER chosenBy explicit amended false stale true proposalVersion 2
  ```
- **Why no task review saw it:** every server fixture uses `loop("a")` with `plan: "standard"` (explicit,
  `tests/control/fixtures/taskLoop.ts:12`) and `setTaskLoopVersion.test.ts:24` builds its v1 recipe with
  `chosenBy: "explicit"`. The web criterion for Apply all (`web/tests/loopSuggestionApply.test.tsx:27`) *does* use
  `chosenBy: "labels"` — against a mocked server that answers success. The layers were each green; only the pair fails.
- **Fix (one line, verified in the clone, `$SCRATCHPAD/final-review/fix-probe.txt` rc=0, 8 files / 54 criteria green
  including `setTaskLoopVersion`, `setTaskLoopModel`, `estimateEffectiveContracts`, `setTaskLoop`, `setTaskLoopConfirmed`,
  `taskAmendments`, `loopPlanView`):** drop the override — `{ ...current.loop!, inputs: structuredClone(payload.inputs) }`.
  A budget-only change with the same plan and inputs keeps the recipe's `chosenBy` (the plan is still the one the labels
  chose); the non-kept path (`expandLoopPlan`) still records `explicit`, which is right for a change of plan or inputs.
  `recipeExpandsTo` does not read `chosenBy`, so amendment verification, `isAmendedCopyOf` and `chosenByLabel` are unaffected.
  After the fix the probe reads `APPLY ANSWER {"kind":"task-loop-set",…}` and `AFTER chosenBy labels amended false stale false`.
- **Criterion to add (Rule 9, seen red before the fix):** in `tests/control/setTaskLoopVersion.test.ts` or
  `setTaskLoopModel.test.ts`, a label-chosen fixture (`labels: ["bug"]`, no `plan`) — (a) a suggestion with `workProvenance`
  is accepted; (b) the view's `chosenBy` stays `"labels"` and the estimate's `stale` stays `false` after a budget-only
  change; (c) an input change still sets `chosenBy: "explicit"`. Deletion mutation: restore the `chosenBy: "explicit"`
  override → (a) red with `estimate-stale`, (b) red on `stale`.

### Important (should fix)

None found. The candidates I checked and closed:

- **Staleness vs `readEstimateRecord`'s copy check** — consistent: both use `effectivePlan`'s bytes; `estimateViews` gets
  the same bytes `readControlGroup` builds (`controlViews.ts:731-733`). Old records (archive copies) still parse.
- **Kept-version vs sticky "changed"** — in the kept path the contract bytes are identical by construction, so
  `planChanged` is never set (`webService.ts:662`) and `amended` stays false; the H12 sticky flag only rides real contract
  changes. Correct once C1 is fixed.
- **Apply-all sequencing** — proposal-edit first at the poll's revision, each set-task-loop at the previous success's
  `commandRevision` (`web/src/App.tsx:318-330`); a set-task-loop for one task does not move another's `loopVersion`; the
  estimate stays current across the kept path. Pinned end to end (`loopSuggestionApply.test.tsx:151-181`).
- **W1's predicate** (`refuseAfterTaskStarted`, status-based) vs set-task-loop's (any `runs` row) — see Minor 1.
- **English byte-identity** — the pre-round `Git workspace` sentence (`9d4a335:web/src/LoopPlanCard.tsx:179`) equals the
  `Trans` rendering of `loopPlan.git`; `budgetLine` equals `:178`; each area's review measured its DOM against base
  (Tasks 5, 6, 9 with `cmp`); the pseudo-locale criterion (§6.5, fixed after Task 11's I1) is the backstop.
- **Schema parity** — `stale?`/`workProvenance?`/`caveatCodes?` optional on the web mirror is the file's stated precedent;
  the server always sets them; both-way compile checks remain (rulings F12, W6).
- **i18n separators** — no enum value or key contains `.` or `:` (grep of `en.ts`, 0 hits), so `i18n.exists` cannot
  misparse one; refusal codes go through `zhErrors` (P8).

### Minor

1. **Two definitions of "started" in `webService.ts` (Rule 7).** `refuseAfterTaskStarted` (`:103-108`) refuses on
   `status ∉ {draft, ready}`; set-task-loop (`:598-599`) refuses on any `runs` row "because a finished run returns its task
   to ready". A task whose run settled restartable (`stopIntent.ts:695`, "a run proved never to have started") is `ready`
   again: proposal-edit / set-agent / confirm pass W1's check and `reopenProposal` resets it to draft, then a re-confirm
   clears `lineageRunIds` (`:524`) while the runs row stays. No budget is wrong (that run consumed nothing), so this is a
   ruling, not a defect: either W1 adopts the runs-row predicate or the set-task-loop comment names why it is stricter.
2. **Task-3 stale doc text inside rewritten criteria** (`tests/control/loopPlanView.test.ts:10,16`,
   `tests/panel/taskLoopApi.test.ts:13`) still describes the removed server-built summary. Comment-only; Rule 12.
3. **`labelSource` dynamic `t()` has no raw fallback** (`web/src/TaskDetail.tsx`, Task 7 review Minor 2): a wire value
   outside `plan|operator` renders the key path where every other family renders the value. `enumText`-style fallback.
4. **Unrendered Chinese enum values are unpinned** (Task 7 Minor 1, Task 9 Minor 3): `Translation<typeof en>` proves the
   key exists, not that the value is Chinese. A table-driven check that each `zh.enums.<family>.<value>` differs from `en`
   unless listed as identical (S/M/L/XL, `ok`, …) closes it in ten lines.
5. **Compatibility of the cap with stored snapshots:** `validateExecutionSnapshot` now recomputes the expected derived
   contract with `MAX_TIMER_MS` (`controlViews.ts:396`). A group confirmed before `219582c` whose task had
   `activeMs > 2^31−1` *and* an original `perAttemptTimeoutMs` above that would now read `derived-contract-forged`. No such
   data can exist from the registry (v1 = 3 600 000) — only a hand-written contract plus a >24.8-day allocation — so no
   migration; recording it here is enough.
6. **`readEstimateRecord` now re-expands every loop recipe of an amended snapshot on every read** (`queries.ts:253-257`);
   `readControlGroup` reads every estimate per 2 s poll. Cost is estimates × loop tasks × `expandRecipe` (object build +
   canonical JSON) — fine at panel scale; worth a note if estimate counts grow.
7. **Two commits carry no trailer** (`7ff0d48`, `d812323`, the checkpoint commits; 35 of 37 have `Claude-Session`). The plan's
   Global Constraint says every commit; the user's rule prefers new commits over amending, so leave them, note it.
8. **`chainsI18n` case 3 replaces `globalThis.fetch` without restoring** (Task 6 Minor 3) — file-local today.
9. **`web/vite.config.ts` comment cites 4968 ms without command/commit** (Task 7 Minor 3; Rule 14) — append
   "(`npm run check --workspace web` at `4ff8d23`)".
10. **`estimate-stale` after confirmation is not re-checked** — ruled (H15); the cost the ruling names (a confirmed budget
    derived from an estimate of the old contract) is real and should stay in the human's summary.

## Triage of the deferred minors (which must be fixed before the human pushes?)

| Task | Deferred minor | Ruling |
|---|---|---|
| 1 | scan script cosmetics (context labels without fixture; `--ui` as root path; `--ui` mutation unlisted) | No. Test-only tooling; the dangerous branches were pinned in the fix round. |
| 2 | four `t`/`enumText` sites rendered but unasserted in zh; Badge titles; `shell.loading` scan-only | No. Task 11's pseudo-locale renders Shell with both badges and reads `title`/`aria-label`; `shell.loading` is a startup string. |
| 3 | picker option text unpinned | Done (Task 8 pinned en/zh with the id-swap mutation red). |
| 3 | card's own `useTranslation()` unobservable | No (convention; protects a future memo boundary). |
| 3 | stale doc text in rewritten criteria | **Fix in the same commit as C1** (comment-only, Minor 2). |
| 3 | verbatim user text unpinned | Done (`i18nPseudo.test.tsx:237`). |
| 4 | evidence read partially; `caveatCode` single literal; `key={caveat}` | No. |
| 5 | zh wording ×3 (仓库 twice, 错了 —— 选错了, 选择了) | Not a push gate — the human's zh review (spec §5) is still open; list them there. |
| 6 | 启动 vs 开跑; `USD` beside 美元 | Same: the human's zh review. |
| 6 | fetch not restored | Cheap; optional (Minor 8). |
| 7 | unrendered zh enum values unpinned | **Recommended before push** (Minor 4) — it is the one gap the human's reading of `zh.ts` might also miss. |
| 7 | `labelSource` no fallback | Cheap; recommended (Minor 3). |
| 7 | vite.config comment provenance | Cheap; recommended (Minor 9). |
| 7 | zh wording (配置/profile, 待定, 停止 暂停 已暂停, 版本 twice) | The human's zh review. |
| 7 | vacuous brief substrings | No (exact assertions exist beside them). |
| 8 | complexity enum unobservable; weak brief substrings; compact reporter | No; no; ruled. |
| 9 | zh spacing; 执行 for two things | The human's zh review. |
| 9 | 9/12 `selectionSource` zh values unrendered | Same as Task 7's (Minor 4). |
| 9 | no permanent English DOM pin for agents | No (measured once by `cmp`; the pseudo criterion and existing English tests hold the line). |
| 10 | hand-listed code set is static; empty message leaves a bare "："; review minors 2–3 | No. The catalog half is read at run time; a hand-list code with no entry falls back visibly (code + message). |
| 11 | values < 4 chars blind; branches no fixture renders; other attributes; `⟦` guard weak | No (disclosed residuals of §6.5; per-area criteria cover). |

**Must fix before push:** C1 (with its criterion). **Worth the same commit:** Minors 2, 3, 4, 9. **Human's, not a gate:**
the zh wording rows (spec §5 review, `zh-review.tsv`), the C4 v2 plan-content naming (uncommitted by ruling), the W1
predicate ruling (Minor 1).

## Declined to judge

- The Chinese wording itself (spec §5 assigns it to the human; I checked only that terms in §5's table are used).
- The uncommitted C4 patch (`scratchpad/w7/c4-impl-only.patch`): not in the range; its ruling waits for the human's naming.
- `npm audit` findings (pre-existing dev dependencies, registered in the ledger; none from the three i18n packages, whose
  lock entries resolve to `registry.npmjs.org` at the spec §8 versions).
- The Rule 14 deviation of Task 8's compact reporter (ruled by the controller; the first pass's full outputs exist).
- Whether the round should have run on a worktree branch (ruled: local `main`, no other agent in the tree).
- The full test gate (another agent's; my targeted runs: `probe-labels.txt` rc=0, `fix-probe.txt` rc=0 with the fix).

## Recommendations

- Land C1 with the label-chosen criterion; then re-run `tests/control/setTaskLoop*.test.ts`, `estimateEffectiveContracts`,
  `taskAmendments`, `loopPlanView` and the web `loopSuggestionApply` file (all green in my clone with the fix).
- Add the zh-enum completeness check (Minor 4) — ten lines, closes the last class of "English left in zh" the criteria cannot see.
- Record in the ledger: W1 vs set-task-loop "started" predicates (Minor 1) as a ruling to make, and Minor 5 as a known
  non-migration.

## Assessment

**Ready to merge:** with fixes (C1).

**Reasoning:** The seven follow-ups and the i18n conversion are individually sound and unusually well pinned; the one
defect is at the seam none of the per-task fixtures crossed — a label-chosen loop task meeting the kept-version path —
and it breaks the human's H6/H16 request for the default kind of task. The fix is one line, verified, and its criterion is
a fixture change away.

## Re-review of the fix wave

Reviewer: scoped re-review subagent of session `e604b1ba`, 2026-10-01. Fix range `2bcd2b0..c73b220` (`0698645`, `c73b220`),
read from `review-2bcd2b0..c73b220.diff` and `final-fix-report.md`. Read-only on the repository. Runs only in
`$SCRATCHPAD/final-review/clone`: its HEAD is still `2bcd2b0`; the seven files of the fix range were written from
`git show c73b220:<f>` (`git diff c73b220 --stat` then lists only the two new files, untracked), plus the probe file.

### Finding verdicts

- **C1 — kept path rewrote `chosenBy` to explicit** — ADDRESSED. `src/control/webService.ts:630` now passes
  `{ ...current.loop!, inputs: … }`; the non-kept path (`expandLoopPlan`, :631) still records explicit. Probe re-run
  (`$SCRATCHPAD/final-review/rereview-probe.txt`, rc=0): `APPLY ANSWER {"kind":"task-loop-set","taskId":"a","loopVersion":1,…}`,
  `AFTER chosenBy labels amended false stale false`. (The probe's second command now answers `task-loop-version-conflict`:
  the probe reuses the pre-apply `baseLoopVersion` 0 — a probe artefact; the budget-only case is the fix's own test 2.)
  Criterion `tests/control/setTaskLoopLabels.test.ts` covers the reviewer's (a), (b), (c); report shows it red on HEAD
  sources (tests 1, 2) and M1/M1b/M2 seen red. Focused run in the clone (`rereview-root.txt`, rc=0): `setTaskLoopLabels`
  3/3, `loopPlanView` 4/4, `setTaskLoopVersion` 3/3, `setTaskLoopModel` 3/3.
- **Minor 2 — Task 3 stale doc text** — ADDRESSED. `tests/control/loopPlanView.test.ts:9-13` and
  `tests/panel/taskLoopApi.test.ts:11-15` now describe fields / versions + registry-pinned English texts. The title rename at
  `loopPlanView.test.ts:17` is inside the human-named rewrite: Task 3's brief (line 16) names
  `tests/control/loopPlanView.test.ts:2,16-25` as an H18 rewrite, the `it` carries both the H19 and H18 comment lines
  (:18-19), and no assertion changed (diff: title line only).
- **Minor 3 — `labelSource` raw fallback** — ADDRESSED. `web/src/TaskDetail.tsx:54-58` `labelSourceText` (`i18n.exists` →
  `t`, else the raw value), used at :146. `web/tests/labelSourceFallback.test.tsx` pins en and zh, unknown and known
  (`rereview-web.txt`, rc=0, 2/2).
- **Minor 4 — zh-enum completeness** — ADDRESSED (already covered before this wave; the final review missed it).
  `web/tests/i18nPseudo.test.tsx:274-308`, from `c840da5` (`git log -S SAME_IN_CHINESE`), reads all 30 families / 146
  values through `enumText` under zh, requires zh.ts's value and inequality with en except `complexity.S/M/L/XL`; green in
  `rereview-web.txt` (22/22).
- **Minor 9 — vite.config comment provenance** — ADDRESSED. `web/vite.config.ts:17` names
  `npm run check --workspace web` at `4ff8d23` and the Task 7 report; `4ff8d23` is the commit the report says the number
  was observed at (fixer's deviation 1, which I accept).

### New breakage in the fix diff

None Critical or Important. Minor: `web/tests/labelSourceFallback.test.tsx` leaves the i18n language at `zh` after its
last case (no `afterAll` back to `en`); file-local under vitest's per-file isolation, so no effect today.

### Out-of-scope observations

- `src/panel/controlViews.ts:499` derives `chosenByLabel` from the task's *current* labels, while the recipe's `planId` was
  chosen by the labels at import. Now that the kept path keeps `chosenBy: "labels"` across set-task-loop, a task whose
  labels were later changed (set-labels) can show "chosen by label X" for a label that would choose another plan (or
  `null`). The same was already true with no set-task-loop at all, so not introduced by this wave; not probed.

### Verdict

**Fix round:** all findings addressed, no new Critical/Important breakage.
