# Decisions Review and Correction Withdraw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the panel's Decisions page, a person sees who reviewed a decision and every correction on it, and can
withdraw their own review or their own open correction; every number built on reviews or corrections reads the
withdrawal.

**Architecture:** Reviews gain an appended `withdrawn` action; a person's review state is their latest
`reviewed`/`withdrawn` row in file order, computed by one function that coverage, the to-do list, the writer's dedupe
and `compact-reviews` all share. Correction withdrawals live in a separate append-only file
(`correction-withdrawals.jsonl`) next to `corrections.jsonl`, so the strict corrections file never sees a new shape.
Two new panel routes write withdrawals; `GET /api/decision` returns the review/correction state; the detail pane shows
it with Withdraw buttons.

**Tech Stack:** TypeScript (ESM, Node), zod, Express panel, vitest (root `tests/**/*.test.ts`; web
`web/tests/**/*.test.tsx`), React 19 + i18next.

**Spec:** `docs/superpowers/specs/2026-10-18-decisions-review-withdraw-design.md`. **§10 overrides earlier sections.**
Executors read the spec, `web/DESIGN.md` (Task 6) and `CLAUDE.md` Rules 9, 14, 17.

## Global Constraints

- Append-only: no code path deletes or rewrites an existing line of `reviews.jsonl`, `corrections.jsonl` or
  `correction-withdrawals.jsonl`. `corrections.jsonl` must be byte-identical before and after any withdrawal.
- Every criterion writes under a temp dir via `ORCA_CORRECTIONS_DIR` / the test harness's dir — never the real `~/.orca`
  (Rule 17). New file created with mode `0o600` (`CORRECTIONS_FILE_MODE`), never inherited from umask; an existing
  file's mode is left alone.
- Refusal codes, verbatim: `review-not-active`, `review-has-open-correction`, `correction-not-found` (exists),
  `correction-target-not-a-decision` (exists), `correction-not-yours`, `correction-already-withdrawn`,
  `correction-closed`, `correction-withdrawn`, `correction-withdrawals-unreadable`.
- Report field name, verbatim: `withdrawn_corrections`.
- Existing tests may be changed **only** where this spec's behavior change makes the old assertion false (human, this
  session: 「本 spec 必需的都允许」). Every such change is recorded in the SDD ledger as `Ruling:` with file:line, the
  old assertion and why it had to change. Never loosen an unrelated assertion.
- Each new branch: name the mutation that deletes it and see it go red (Rule 9). Record mutation + observed red in the
  ledger. Mutations only in a `git clone --local` copy (Rule 15).
- Verification output always redirected to a file and read back whole (Rule 14).
- Comments in English, match the surrounding density; ERRATUM blocks go at the end of an existing comment block.

## Review Focus

1. A reviewed → withdrawn → reviewed cycle survives `orca compact-reviews --apply` (decision stays reviewed). → Task 2.
2. Two panel tabs both press Withdraw at once: exactly one `withdrawn` row lands, the other gets `duplicate`. → Task 1.
3. A withdrawals file with a torn or garbage line: metrics name it as malformed and keep going; the strict reader used
   inside the store lock refuses with a named error rather than silently treating everything as not withdrawn. → Task 3/4.
4. A person who agreed, then corrected, then withdraws the correction: decision is unreviewed afterwards. → Task 5.
5. Withdraw on a correction whose decision is no longer listed (repo removed): 404 `decision-not-found`, nothing
   written. → Task 5.

---

### Task 1: Review state and the writer's dedupe

**Files:**
- Create: `src/panel/reviewState.ts`
- Modify: `src/panel/reviewsStore.ts` (`ReviewAction`, `ReviewsWriter`), `src/panel/coverage.ts` (`reviewedKeys`,
  `computePanelCoverage`)
- Test: `tests/panel/reviewState.test.ts` (new), existing `tests/panel/reviewsStore.test.ts`,
  `tests/panel/coverageDuplicates.test.ts`

**Interfaces:**
- Produces:
  - `ReviewAction = "opened" | "reviewed" | "withdrawn"`
  - `type ReviewStateAction = "reviewed" | "withdrawn"`
  - `reviewStates(rows: readonly ReviewRow[]): Map<string, Map<string, ReviewStateAction>>` — outer key
    `keyOf(projectKey, decisionId)` (reuse `coverage.ts`'s `keyOf`; move it to `reviewState.ts` and re-export if
    needed), inner key `by`; value = latest state row in file order; `opened` ignored.
  - `activeReviewers(states, projectKey, decisionId): string[]` — `by`s whose state is `reviewed`, in first-seen order.
  - `reviewedKeys(reviews)` keeps its signature; returns keys with ≥1 active reviewer.
  - `ReviewsWriter.stateOf(projectKey, decisionId, by): ReviewStateAction | undefined` (in-memory, after `load()`).
  - `ReviewsWriter.append(row)` unchanged signature; `"duplicate"` for a state row equal to the current state.

- [ ] **Step 1: Failing tests** in `tests/panel/reviewState.test.ts`:
  - `reviewStates`: rows `reviewed(a)`, `withdrawn(a)` ⇒ state `withdrawn`; then `reviewed(a)` ⇒ `reviewed`.
  - `reviewedKeys`: `reviewed(a), withdrawn(a)` ⇒ empty; `reviewed(a), reviewed(b), withdrawn(a)` ⇒ contains the key.
  - `computePanelCoverage` on a high-tier decision with `reviewed(a), withdrawn(a)` ⇒ `reviewed_high_tier: 0`.
  - Writer (temp dir): `reviewed`→`written`, `reviewed`→`duplicate`, `withdrawn`→`written`, `withdrawn`→`duplicate`,
    `reviewed`→`written`; file has exactly 3 lines. `opened` twice ⇒ second `duplicate` (unchanged rule).
  - Writer concurrency: two `append(withdrawn)` started together after one `reviewed` ⇒ one `written`, one
    `duplicate`, one `withdrawn` line on disk.
  - Writer reload: after the file is replaced (identity change) holding `reviewed, withdrawn`, `append(reviewed)` ⇒
    `written`.
- [ ] **Step 2:** Run `npx vitest run tests/panel/reviewState.test.ts > $LOGS/t1-red.log 2>&1`; read it: fails on
  missing module / wrong states.
- [ ] **Step 3: Implement.** The writer keeps `opened` keys in today's `seen` set and a separate
  `Map<stateKey, ReviewStateAction>` for state rows, where `stateKey = [projectKey, decisionId, by]` joined by
  `UNIT_SEPARATOR`. The claim stays synchronous before the first `await` (existing comment explains why): set the map
  to the new action and remember the previous value; on write failure restore the previous value. `inFlight` keeps
  claims across `load()` as today (for state rows: the claimed action overrides the disk state). `computePanelCoverage`
  uses `reviewedKeys`, so there is one definition. Add an ERRATUM at the end of the class comment: the bound is no
  longer two rows per decision; state rows grow with real withdraw/re-review acts only.
- [ ] **Step 4:** Run the new file plus `tests/panel/reviewsStore.test.ts tests/panel/coverageDuplicates.test.ts
  tests/panel/todo.test.ts tests/panel/decisionsApi.test.ts` → all pass. Fix only assertions this spec makes false;
  ledger them.
- [ ] **Step 5: Mutations** (clone): (a) `reviewStates` takes the first row instead of the latest ⇒ cycle test red;
  (b) writer dedupe back to `(pk,id,by,action)` ⇒ re-review test red; (c) no restore on write failure ⇒ a test that
  makes the append throw once then retries must go red (add it if Step 1 lacks one).
- [ ] **Step 6: Commit** `feat(panel): reviews gain a withdrawn action and a latest-row review state`.

### Task 2: `compact-reviews` keeps state changes

**Files:** Modify `src/panel/compactClassify.ts` (`classifyLine`, `classifyReviews`). Test:
`tests/panel/compactClassify.test.ts`, `tests/panel/compactReviews.test.ts`.

**Interfaces:** Consumes Task 1's `ReviewStateAction`. No new exports.

- [ ] **Step 1: Failing tests:** classify `reviewed(a), withdrawn(a), reviewed(a)` on a judged, top-level decision ⇒
  three `kept`, zero `duplicate`; `reviewed(a), reviewed(a)` ⇒ second `duplicate` (unchanged);
  `reviewed(a), withdrawn(a), withdrawn(a)` ⇒ third `duplicate`. One `compactReviews` end-to-end (`--apply`) on the
  cycle file: the decision is still in `reviewedKeys` of the compacted file.
- [ ] **Step 2:** Run, see red on the cycle case.
- [ ] **Step 3: Implement:** for `reviewed`/`withdrawn` rows, duplicate iff the action equals the running state for
  `(projectKey, decisionId, by)` among rows already kept; otherwise update the state. `opened` and any other action
  string keep today's `(pk, id, by, action)` rule. Orphan / not-judged order unchanged.
- [ ] **Step 4:** Run both compaction test files + `tests/panel/compactReviewsCli.test.ts` → pass.
- [ ] **Step 5: Mutation:** restore the old key for state rows ⇒ cycle test red.
- [ ] **Step 6: Commit** `fix(panel): compact-reviews keeps a withdraw and a re-review`.

### Task 3: Correction withdrawals store

**Files:**
- Create: `src/corrections/withdrawals.ts`
- Modify: `src/corrections/paths.ts` (add `withdrawalsFile`), `src/corrections/store.ts` (`recordCorrection`),
  `src/corrections/correct.ts` (close-existing branch)
- Test: `tests/corrections/withdrawals.test.ts` (new), `tests/corrections/store.test.ts`,
  `tests/corrections/close.test.ts`

**Interfaces:**
- Produces:
  - `withdrawalsFile(dir: string): string` → `join(dir, "correction-withdrawals.jsonl")`
  - `withdrawalSchema` (zod `.strict()`): `{ correctionId: string.min(1), projectKey: string.min(1), by:
    string.min(1), at: string.min(1) }`; `type CorrectionWithdrawal`.
  - `readWithdrawals(dir): Promise<CorrectionWithdrawal[]>` — strict, ENOENT ⇒ `[]`, a bad line throws
    `CorrectRejection("correction-withdrawals-unreadable", …)`.
  - `withdrawnIds(rows: readonly CorrectionWithdrawal[]): Set<string>`
  - `withdrawCorrection(dir, input: { correctionId: string; by: string; at: string; isClosed: (c: DecisionCorrection) => boolean }): Promise<{ correction: DecisionCorrection; withdrawal: CorrectionWithdrawal }>`
    — inside `withStoreLock`: refusals in spec §5.2 order (`correction-not-found`, `correction-target-not-a-decision`,
    `correction-not-yours`, `correction-already-withdrawn`, `correction-closed`), then append with the same newline
    separator rule and `{ mode: CORRECTIONS_FILE_MODE }` as `appendCorrectionLocked`.
  - Constants exported: `CORRECTION_NOT_YOURS`, `CORRECTION_ALREADY_WITHDRAWN`, `CORRECTION_CLOSED`,
    `CORRECTION_WITHDRAWN`.
- [ ] **Step 1: Failing tests:** each refusal code, in order (a row that is both not-yours and withdrawn ⇒
  `correction-not-yours`); success writes one line, file mode `0o600` under umask `0o022`; `corrections.jsonl` bytes
  unchanged (compare `readFile` before/after); `recordCorrection` after a withdrawal of the same person's correction on
  the same decision succeeds **without** `again`; a garbage line in the withdrawals file makes `withdrawCorrection`
  and `recordCorrection` refuse `correction-withdrawals-unreadable` (never "nothing is withdrawn"); `orca correct --close <id>` on a withdrawn correction exits non-0
  with `correction-withdrawn` (use the existing close harness in `tests/corrections/close.test.ts`).
- [ ] **Step 2:** Run, see red.
- [ ] **Step 3: Implement.** `recordCorrection`'s `correction-already-recorded` lookup skips ids in
  `withdrawnIds(await readWithdrawals(dir))` (read inside the same lock hold). The close-existing branch in
  `correct.ts` refuses `correction-withdrawn` right after `loadCorrection` (before the target check's sibling), with
  a message naming the withdrawal's `by`/`at` and saying to record a new correction.
- [ ] **Step 4:** Run `tests/corrections/` whole → pass.
- [ ] **Step 5: Mutations:** drop the withdrawn skip in `recordCorrection` ⇒ red; drop the close refusal ⇒ red; swap
  not-yours and already-withdrawn order ⇒ red; drop explicit mode ⇒ red.
- [ ] **Step 6: Commit** `feat(corrections): an append-only withdrawals store beside corrections`.

### Task 4: Metrics read withdrawals

**Files:** Modify `src/metrics/lenientRead.ts` (add `readWithdrawalsLeniently`), `src/metrics/collect.ts`,
`src/metrics/types.ts` (`Observations.withdrawnCorrections: number`, `MetricsReport.withdrawn_corrections: number`,
`METRICS_FIELDS`), `src/metrics/compute.ts`, `src/metrics/report.ts` (one text line). Test:
`tests/metrics/collect.test.ts`, `tests/metrics/compute.test.ts`, `tests/metrics/lenientRead.test.ts`, report goldens.

**Interfaces:** Consumes `withdrawalSchema`, `withdrawalsFile` (Task 3). Produces `MetricsReport.withdrawn_corrections`.

- [ ] **Step 1: Failing tests:** fixture with two decision corrections, one withdrawn ⇒ correction rate numerator,
  backlog `open_corrections`, breakdown and `unresolved_decisions` count only the other; `withdrawn_corrections: 1`.
  With `asOf` before the withdrawal's `at` ⇒ both counted, `withdrawn_corrections: 0`. Wall-clock mode with a
  withdrawal dated in the future ⇒ `future-rows-without-as-of` naming `<correctionId> (withdrawn)`. A garbage line in
  the withdrawals file ⇒ appears in `malformed_lines`, command still answers.
- [ ] **Step 2:** Run, see red.
- [ ] **Step 3: Implement:** in `collect`, read withdrawals leniently before the corrections loop; a withdrawal counts
  iff `keep(w.at, \`${w.correctionId} (withdrawn)\`)`; corrections whose id is withdrawn are skipped (counted into
  `withdrawnCorrections`) before `keep(row.at, …)`. Pending-target rows stay skipped as today. Add
  `withdrawn_corrections` to `METRICS_FIELDS` (position per that list's comment: not the declaration order).
- [ ] **Step 4:** Run `tests/metrics/` and `tests/panel/metricsApi*.test.ts` (whatever exists) and web metrics type
  users (`npx tsc --noEmit -p tsconfig.json`, web `npm run --ws check` only if web reads `MetricsReport`) → pass;
  update goldens that now carry the new field (ledger them).
- [ ] **Step 5: Mutations:** drop the withdrawn skip ⇒ red; drop the `keep` on withdrawals ⇒ asOf test red.
- [ ] **Step 6: Commit** `feat(metrics): withdrawn corrections leave every correction number`.

### Task 5: Panel routes and decision review state

**Files:** Modify `src/panel/api.ts`. Test: `tests/panel/decisionsApi.test.ts`, `tests/panel/correctApi.test.ts`, new
`tests/panel/withdrawApi.test.ts`.

**Interfaces:**
- Consumes Tasks 1, 3, 4.
- Produces (HTTP, consumed by Task 6):
  - `GET /api/decision` answers `{ decision, review: DecisionReviewState }` where
    `DecisionReviewState = { reviewers: Array<{ by: string; at: string }>; mine: "reviewed" | "none";
    corrections: Array<{ id: string; kind: CorrectionKind; because: string; chose_instead?: string; by: string; at:
    string; state: "open" | "withdrawn" | "closed"; mine: boolean; withdrawable: boolean }> }` — `reviewers` are the
    active reviewers with the `at` of their latest `reviewed` row; `corrections` are the decision-target corrections
    on this `(projectKey, decisionId)` in file order; `closed` from `currentMetrics`'s `overturned` ids;
    `withdrawable = mine && state === "open"`. (The `opened` append after the response stays as is.)
  - `POST /api/reviews/withdraw {projectKey, decisionId}` ⇒ `{ result: "written" | "duplicate" }`; 404
    `decision-not-found`; 409 `review-not-active`; 409 `review-has-open-correction`.
  - `POST /api/corrections/withdraw {correctionId}` ⇒ `{ withdrawal, review: "written" | "duplicate" | "skipped" }`;
    the correction's decision must be listed (404 `decision-not-found`); refusals from Task 3 as 409 with the panel's
    own sentence (like the existing `correction-already-recorded` handler; `corrections-store-busy` 409); after the
    withdrawal, append `withdrawn` for `deps.opts.by` iff their state is `reviewed` and they have no other open
    decision-target correction on it (`skipped` otherwise); if that append fails, 409 naming both, like today's
    "correction recorded but reviewed mark not written".
- [ ] **Step 1: Failing tests** (existing panel app harness used by `decisionsApi.test.ts`/`correctApi.test.ts`):
  detail state after agree / after correct / after withdraw; agree→withdraw→`/api/todo` lists the decision again;
  withdraw with nothing active ⇒ 409 `review-not-active`, file unchanged; withdraw review with an open correction ⇒
  409 `review-has-open-correction`; agree-then-correct-then-withdraw-correction ⇒ `review: "written"`, decision
  unreviewed; two open corrections (second via `again`), withdraw one ⇒ `review: "skipped"`, still reviewed; each
  Task 3 refusal reaches HTTP with its code; correction on an unlisted repo ⇒ 404 and no line written.
- [ ] **Step 2:** Run, see red.
- [ ] **Step 3: Implement** the three handlers next to the existing review/correction routes, same membership check
  (`isListedDecision`) and `objectBody`. `isClosed` passed to `withdrawCorrection` is built from the same request's
  `currentMetrics` observations (`overturned` ids), taken **before** the lock (spec §5.2 accepted window).
- [ ] **Step 4:** Run `tests/panel/` whole → pass.
- [ ] **Step 5: Mutations:** drop the open-correction check on review withdraw ⇒ red; review withdraw after correction
  withdraw unconditional ⇒ the two-corrections test red; `withdrawable` ignoring `mine` ⇒ red.
- [ ] **Step 6: Commit** `feat(panel): withdraw routes and a decision's review state`.

### Task 6: Detail pane shows review state and Withdraw buttons

**Files:** Modify `web/src/api.ts` (`fetchDecision` type, `withdrawReview`, `withdrawCorrection`),
`web/src/DecisionDetail.tsx`, `web/src/App.tsx` (detail fetch keeps `review`, two submit paths),
`web/src/locales/en.ts`, `web/src/locales/zh.ts`, and CSS only if an existing class does not fit. Test:
`web/tests/decisionDetail.test.tsx`, `web/tests/decisionsApp.test.tsx` (or a new `web/tests/decisionWithdraw.test.tsx`),
`web/tests/decisionsI18n.test.tsx`.

**Interfaces:** Consumes Task 5's HTTP shapes. `DecisionDetail` gains props `review?: DecisionReviewState`,
`onWithdrawReview?: () => void`, `onWithdrawCorrection?: (id: string) => void`.

Read `web/DESIGN.md` first. Copy (en / zh), exact:
- review heading: "Reviewed by" / "已审"; button "Withdraw review" / "撤回审阅";
- corrections heading: "Corrections" / "纠正"; states "open" / "未关闭", "withdrawn" / "已撤回", "closed" / "已关闭";
- button "Withdraw" / "撤回"; disabled Agree text "Reviewed" / "已审";
- recorded notices: "Review withdrawn." / "已撤回审阅。", "Correction withdrawn." / "已撤回纠正。";
- refusals use the server's message (existing `Refusal` component).

- [ ] **Step 1: Failing tests:** detail with `review.mine === "reviewed"` and no open own correction shows "Withdraw
  review" (secondary, not `.btn-primary`) and a disabled Agree; with an own open correction no "Withdraw review"; own
  open correction row has a "Withdraw" button, another person's or a withdrawn/closed one has none; reviewers block
  has `data-tone="ok"`; withdrawn correction row is struck through (class); App: clicking Withdraw review posts
  `/api/reviews/withdraw`, keeps the same decision selected, re-fetches its detail, shows the recorded notice; i18n
  test covers the new keys in both locales.
- [ ] **Step 2:** Run `npx vitest run --root web <files> > $LOGS/t6-red.log 2>&1`, see red.
- [ ] **Step 3: Implement.** Withdraw requests go through the same `decisionRequests` record machinery as agree/correct
  (new verbs `"withdraw-review"`, `"withdraw-correction"`), then `readTodo()`, `loadHome()` and a detail re-fetch; no
  `pendingAdvance` for withdraws (spec §10.1). Agree keeps its advance.
- [ ] **Step 4:** Run web tests whole (`npm run --ws check` or the web vitest suite) → pass; `npm run build --workspace
  web` → exit 0.
- [ ] **Step 5: Mutations:** show "Withdraw review" regardless of open correction ⇒ red; Withdraw button on other's
  correction ⇒ red; withdraw path sets `pendingAdvance` ⇒ red.
- [ ] **Step 6: Commit** `feat(web): decision detail shows reviews and corrections, with withdraw`.

### Task 7: Amend the debug-task plan and register the new file

**Files:** Modify `docs/superpowers/plans/2026-10-18-correction-debug-task.md` (append a section only),
`docs/superpowers/specs/2026-10-18-correction-debug-task-design.md` (append a section only, if it lists out-of-repo
writes; otherwise skip and say so in the ledger).

- [ ] **Step 1:** Append `## Amendment (decisions review withdraw, session b304f167)` to the debug plan listing spec §6's
  six items verbatim in substance, each tied to the task it changes (by task number after reading the plan), and the
  predicate name `withdrawnIds`/`readWithdrawals` from Task 3.
- [ ] **Step 2:** Verify no earlier line changed: `git diff -U0 <file> | grep '^-[^-]'` redirected to a file must be
  empty (read the file).
- [ ] **Step 3: Commit** `docs(plan): amend the debug-task plan for withdrawn corrections`.

---

## Final gate (after all tasks, before merge)

Fresh `git clone --local` of the branch; `npm ci`; `npm run build --workspace web`;
`ORCA_CCLOOP_BIN=/private/tmp/ccb6-qswQ/ccloop/dist/cli.js`; `ORCA_AGENTS_TABLE` pointing at a fake table only
(omp `command` a one-element array); private `HOME`/`XDG_*`/`ORCA_CORRECTIONS_DIR`/`CCMEM_DATA_ROOT`, short
`TMPDIR`. Run `npm run verify > $LOGS/verify.log 2>&1; echo "exit=$?"` in the background; read the log whole. Pass =
`exit=0`, or every red classified against `docs/handoff/known-load-flakes.md` and re-run alone green. `~/.orca` hash
unchanged before/after. Then `git merge --ff-only` into main.
