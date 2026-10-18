# Decisions page: see what was reviewed, and withdraw a review or a correction

Orca session `b304f167`, 2026-10-18, on main `42219edb`. Diagnosis that started it:
`.superpowers/sdd/2026-10-18-decisions-review-withdraw/diagnosis.md` (session `1710772d`).

## 1. Intent

The human reviews agent decisions on the panel's Decisions page. Today a review cannot be taken back, and once a
decision is reviewed it drops out of the default list and its detail says nothing about the review.

The human, in their words (2026-10-18): mostly they clicked 同意 (agree) and then did not want to agree; less often they
recorded a 纠正 (correction) and saw right away that it was wrong. They asked: if the mistake is noticed right away, can
the debug group/task be skipped; and if it is noticed long afterwards, when the related debug group is already done, can
a new debug group be started.

Agreed in conversation (human: 「同意，继续」 to the playback):

1. **Withdraw an agree** is the main case. The decision goes back to unreviewed; the human can then judge again
   (agree, or correct).
2. **Withdraw a correction** soon after recording it. The correction stops counting. When the debug-task plan lands,
   withdrawing it also archives its debug group if that group has not started (§6). A started group is not stopped
   for the human; the panel tells them to stop it themselves.
3. **Long afterwards** (the correction is closed: its fix landed) there is no withdraw. The human records a new
   correction, which opens a new debug group. A closed correction cannot be withdrawn (controller's call, stated to the
   human, not objected to).
4. **Append-only.** Nothing already written is deleted or rewritten. A withdrawal is a new row.

## 2. Goals, non-goals, anti-goals

Goals:
- A reviewed decision is findable and its detail shows who reviewed it, when, and every correction on it with its state.
- From the detail, one click withdraws the viewer's own agree; one click withdraws one of the viewer's own open
  corrections.
- Every number built on reviews or corrections (panel review coverage, the to-do list, list `reviewed` flags, metrics
  correction and fix rates, the "already recorded" refusal) reads the withdrawal.

Non-goals (this round):
- Withdrawing a correction that targets a pending decision (`{runId, pendingId}`, written by
  `reject-pending-decision`). Undoing a reject also has to undo the pending item's state in the control store; that is a
  different design. Such a correction shows no Withdraw button, and the route refuses it.
- A CLI or control-verb path for withdraw. Reviewing and correcting are human acts; today agree and correct exist only
  as panel routes (`POST /api/reviews`, `POST /api/corrections`), and withdraw joins them there. goal.md §1.2's "every
  action in the Web UI" holds; an agent cannot review today and does not gain withdraw.
- Withdrawing an `opened` row. It is a noise signal and counts for nothing.
- Changing the list's default filter. It stays Unreviewed (the work the human owes, ruling K5).

Anti-goals (a failure even if it works):
- Any existing line of `reviews.jsonl` or `corrections.jsonl` deleted or rewritten, by the panel or by
  `orca compact-reviews`.
- `orca compact-reviews` turning a reviewed decision unreviewed or the reverse (see §4.3: the current dedupe would).
- An older Orca, or `orca correct` from this one, failing to read `corrections.jsonl` because of a new row shape.
- A withdrawn correction still counted in a rate, or still blocking a fresh correction with
  `correction-already-recorded`.

## 3. Facts the design rests on (measured on main `42219edb` by reading code; re-check before citing)

- Review rows: `{decisionId, projectKey, action: "opened"|"reviewed", by, at}` in `<correctionsDir>/reviews.jsonl`
  (`src/panel/reviewsStore.ts`, `src/panel/paths.ts`). `ReviewsWriter` dedupes in memory on
  `(projectKey, decisionId, by, action)`; a second `reviewed` by the same person is answered `duplicate` and not written.
- "Reviewed" is computed in two places, both as "has any `reviewed` row, by anyone": `reviewedKeys` and
  `computePanelCoverage` (`src/panel/coverage.ts`).
- `orca compact-reviews` (`src/panel/compactClassify.ts` `classifyLine`) drops every later row with the same
  `(projectKey, decisionId, by, action)` as an earlier one.
- Corrections: `<correctionsDir>/corrections.jsonl`, `correctionSchema` is `.strict()` and `readCorrections` parses
  every line with it and throws on failure (`src/corrections/store.ts`). A new row shape in this file would break every
  reader, including older Orca builds.
- `recordCorrection` refuses a second correction by the same person on the same target unless `again` is set
  (`correction-already-recorded`); the panel offers "record another" for that.
- `POST /api/corrections` appends a `reviewed` row after storing the correction.
- A correction is closed when the scanned ledger has an `overturned` row naming its id, or its fix-run file is in the
  archive (`src/metrics/resolve.ts`, `compute.ts` `closedIds`).
- `GET /api/decision` returns only the ledger row; nothing about reviews or corrections.

## 4. Reviews: agree and withdraw

### 4.1 Row

New action `"withdrawn"`: `{decisionId, projectKey, action: "withdrawn", by, at}`. Same file, same writer, same lock,
same modes. `parseRow` already accepts any string action, so older readers keep parsing; an older Orca ignores the row
and still counts the earlier `reviewed` (accepted: the file moves one way with the code, like the control store).
The same acceptance covers an older `orca compact-reviews`: it would still drop the second `reviewed` of a
reviewed → withdrawn → reviewed cycle. Run compaction only from a build that has this change.

### 4.2 State

Per `(projectKey, decisionId, by)`, the person's review state is the action of their **latest** `reviewed`/`withdrawn`
row in file order (`opened` rows do not take part). A decision is reviewed when at least one person's state is
`reviewed`. `reviewedKeys` and `computePanelCoverage` both use this one definition (one function, not two copies).

File order, not `at`: `at` is a wall clock across machines; append order under the lock is the order acts happened.

### 4.3 Dedupe (writer and compaction, one rule)

For `reviewed`/`withdrawn`: a row is a duplicate when it equals the person's current state for that decision. So
reviewed → reviewed is a duplicate (as today), reviewed → withdrawn → reviewed writes three rows. A `withdrawn` with no
current `reviewed` is refused by the route (§4.4), never written.

`opened` keeps today's rule (first per key).

`classifyLine` applies the same rule while walking the file, so compaction drops only rows that changed nothing. Today's
rule would drop the second `reviewed` of a reviewed → withdrawn → reviewed cycle and leave the decision unreviewed;
that is the case §2's anti-goal names, and it gets its own criterion.

### 4.4 Route

`POST /api/reviews/withdraw {projectKey, decisionId}`. Same membership check as `POST /api/reviews`. Withdraws the
**caller's** (`deps.opts.by`) review only. If the caller's state is not `reviewed`, answer 409 `review-not-active`
with the panel's own sentence. If the caller has an open correction on this decision, answer 409
`review-has-open-correction` ("withdraw the correction first"): a decision with an open correction of yours stays
reviewed (controller's call; otherwise it would sit on the to-do list while your correction is pending). Otherwise
append and answer `{result: "written"}`.

A `reviewed` row does not record whether it came from Agree or from a correction (both routes write the same row,
`src/panel/api.ts`). The design does not add a source field: the UI calls the act "review", not "agree" (§7), and the
open-correction rule above covers the one case where the difference matters.

Another person's agree stays; the detail shows it (§7), so the human sees why the decision is still reviewed.

## 5. Corrections: withdraw

### 5.1 Where the withdrawal lives

A separate file, `<correctionsDir>/correction-withdrawals.jsonl`, rows
`{correctionId, projectKey, by, at}` (strict schema). Not a new row shape in `corrections.jsonl`: that file's readers
are strict and some run inside older builds (§3). Written under the corrections store lock (`withStoreLock`), file
created `0600` in a directory that already exists (the corrections dir). Registered as a new out-of-repo write
(Rule 17): path above, written by the panel route below, failure leaves at most the correction unchanged and a 4xx/5xx
to the person; `ORCA_CORRECTIONS_DIR` redirects it with the rest.

A correction is **withdrawn** when the withdrawals file has a row naming its id.

### 5.2 Who may withdraw what

Inside the store lock, refuse with a named code, in this order:
- `correction-not-found`: no such id.
- `correction-target-not-a-decision`: a `{runId, pendingId}` correction (§2 non-goal).
- `correction-not-yours`: `by` differs from the caller.
- `correction-already-withdrawn`.
- `correction-closed`: closed by §3's predicate. The message says to record a new correction instead.

Closed-ness needs the ledger scan, which the route already runs (`currentMetrics`) before taking the lock. The window
between that scan and the append is accepted: closing writes the ledger, not the corrections store, so a close landing
in that window leaves a closed correction marked withdrawn. Readers then treat it as withdrawn (§5.3). This is
recorded, not fixed.

### 5.3 Readers

- `recordCorrection`'s `correction-already-recorded` check skips withdrawn corrections, so a fresh correction after a
  withdrawal needs no "record another".
- Metrics (`collect.ts`, `compute.ts`, `resolve.ts`): withdrawn corrections are filtered out where `collect.ts`
  builds `obs.corrections`, so they leave **every** reader of it: the correction rate, `repair_rate`, the backlog
  (`open_corrections`, oldest age/id — otherwise a withdrawn one would stay open forever, since `--close` refuses it),
  the per-kind breakdown and `unresolved_decisions`. The report gains one count, `withdrawn_corrections`. Metrics read
  the withdrawals file leniently, as they read corrections (`lenientRead.ts`). `--as-of`: a withdrawal whose `at` is
  after `asOf` is ignored (the correction counts as it stood then), and withdrawal rows join the
  `future-rows-without-as-of` check like every other row (controller's call: one time rule for every row).
- `orca correct --close <id>` on a withdrawn correction refuses `correction-withdrawn`.
- `GET /api/decision` lists corrections with state `open` | `withdrawn` | `closed` (§7).

### 5.4 The reviewed mark that came with the correction

Recording a correction also wrote a `reviewed` row (§3). Withdrawing the correction also withdraws the caller's review
of that decision, when their state is still `reviewed` **and no other open correction of theirs remains on it**, so
the decision returns to unreviewed and the human judges it again. This holds even when the caller had agreed before
correcting (that second `reviewed` was a duplicate and never written): correcting replaced the agree, so withdrawing
the correction leaves no judgement standing (controller's call). The correction withdrawal is written first; if the review append then fails, answer 409 naming both, like
today's "correction recorded but reviewed mark not written".

### 5.5 Route

`POST /api/corrections/withdraw {correctionId}`. The correction's `projectKey`/`decisionId` must be a listed decision
(same membership rule as the other routes).

## 6. Interface left for the debug-task plan

The debug-task plan (`docs/superpowers/plans/2026-10-18-correction-debug-task.md`) is not implemented. This design
exports one predicate, `isCorrectionWithdrawn(dir, id)` (or the read it is built on), and the debug plan must then:
- refuse `correction-debug-open` for a withdrawn correction;
- on withdraw, archive the correction's debug group if it exists and has not started (archive deletes nothing,
  `archive-group`); leave a started one alone and have the withdraw answer say so;
- list withdrawn corrections out of "corrections without a debug group".

- make `correction-close` / `closeExistingCorrection` refuse `correction-withdrawn` (it reuses the path §5.3 guards;
  the criterion must go through the verb too);
- show the withdrawn state in its Corrections view;
- have `correction-record` keep writing the `reviewed` row, or move §5.4 with it;
- decide whether withdraw moves to a human-only control verb when recording does (it should, for one pattern).

**Order:** this design lands first (human, 2026-10-18). The last task of this design's plan appends these items to
the debug-task plan as a named amendment section (the plan's existing text is not edited). Nothing here implements
them.

## 7. Web UI (read `web/DESIGN.md`)

Detail pane (`DecisionDetail.tsx`), above the actions:
- A review block: each person whose state is `reviewed`, with time (`ok` tone, it is recorded/done). When the viewer's
  own state is `reviewed` and they have no open correction here, a secondary **Withdraw review** button (named
  "review", not "agree", because a correction also reviews, §4.4).
- A corrections block: each correction on this decision with kind, because, by, at and state (open = no tone,
  withdrawn = no tone and struck through, closed = `ok`). The viewer's own open decision-target correction gets a
  secondary **Withdraw** button.
- Agree stays the one primary button. When the viewer's state is already `reviewed`, Agree is disabled with the text
  "reviewed" rather than silently answering `duplicate`.

After agree or withdraw, the selected decision stays open and its detail refreshes, so the result is visible even when
the row leaves the current filter. The list keeps its Unreviewed default; the existing Reviewed and All filters are
how the human finds reviewed decisions.

Strings go through i18n in both locales, like every other panel string.

## 8. Success criteria (each a command that exits 0 / non-0)

Written by the plan as tests; the shapes the plan must cover:
- reviewed → withdrawn → reviewed: three rows written; decision reviewed after; coverage counts it once.
- withdraw with no active review: 409 `review-not-active`, no row.
- Two people agree, one withdraws: still reviewed.
- `compact-reviews` on a reviewed → withdrawn → reviewed file keeps all three rows and the decision stays reviewed;
  on reviewed → reviewed it still drops the second.
- Correction withdraw: each refusal code in §5.2; a withdrawn correction does not block a new one without `again`;
  metrics drop it from rates and count it in `withdrawn_corrections`; `--close` refuses it.
- `corrections.jsonl` is byte-identical before and after a withdrawal.
- Detail renders review state and the Withdraw buttons only for the viewer's own active items.
- Each new branch has its own mutation seen red (CLAUDE.md Rule 9).

## 9. Left to the builder

Names of functions, components and i18n keys; how the detail fetch carries review/correction state (extend
`GET /api/decision`'s answer or a sibling route); task order in the plan.

## 10. Corrections found while planning (session `b304f167`, 2026-10-18; text above kept verbatim)

1. §7 "After agree or withdraw, the selected decision stays open": wrong for **agree**. Agree already advances to the
   next row once the list is re-read (`web/src/App.tsx` `pendingAdvance`, taste refinement P1-3, pinned by existing
   tests). That stays. Only a **withdraw** keeps the selected decision open and refreshes its detail.
2. §5.3's metrics count is a top-level report field `withdrawn_corrections: number`, added to `MetricsReport` and to
   `METRICS_FIELDS` (`src/metrics/types.ts`), so the byte-exact report goldens change on purpose.
3. "Mine" in the panel is `deps.opts.by` (the panel's recording identity), the same `by` the agree and correct routes
   already write.
