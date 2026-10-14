# Orca panel taste refinement, round 2 — design

> Session 1f3cceb2 (2026-10-14), branch `ui/panel-taste`, fast-forwarded to main at the subject
> `Merge branch 'ui/panel-taste'` (batch 3 merged and pushed by the human).
> Builds on `docs/superpowers/specs/2026-10-14-panel-taste-refinement-design.md` (batch 3; its §7 still governs)
> and `web/DESIGN.md`. Triage source: `.superpowers/sdd/2026-10-14-panel-taste-refinement/final-review.md`.

## 1. Origin and human rulings (session 1f3cceb2)

After batch 3 the human answered its awaitingHuman list:

- **H1** Authorised rewriting `web/tests/shell.test.tsx` so "no execution port" stops lighting Task control's red nav dot.
- **H2** Authorised changing the server's English metric sentences and `tests/metrics/noteCodes.test.ts` so English notes
  drop spec citations.
- **H3** Authorised rewriting `web/tests/metricsNotes.test.tsx` to remove the duplicated label in the data-health row.
- **H4** No client-side "undo Agree" for now.
- **H5** Of the 20 deferred minors, do all nine of "group A" (table in §3); "group B" (11 items) stays recorded only.
- **H6** During the merge the human chose zh `所有者不计量放行` over whitelisting `owner` in `zhTerms`
  (already landed in the merge commit, with two literals of `web/tests/settleUnknownUsage.test.tsx` rewritten).
- **H7** Problems found during execution: proceed on the agent's recommendation, report at the end.

## 2. Direction

Same as batch 3: refine, do not redesign. Nothing here changes layout structure, the palette's contrast pins, or the
"every section pane stays mounted" rule.

## 3. What changes

| # | Problem (who sees it) | Change | Criterion |
|---|---|---|---|
| H1 | With no execution port configured, the nav shows a red "needs attention" dot while the pane itself shows only an amber note — two severities for one fact | `controlAlert` drops the `executionPort` condition; the five real alert conditions (reset, refetch, dispatch blocked, blockers, refusal) still light it | `shell.test.tsx` rewritten line expects `false` |
| H2 | English Metrics notes read "(E2 spec §3.5)", "A' §4.4", "(E2 spec §3.2.1, A' ERRATUM 3)" — citations a panel reader cannot follow | Reword `NO_REVIEW_COVERAGE` and `STALE_BIAS` in `src/metrics/compute.ts`; `web/src/locales/en.ts` mirrors them byte for byte; zh unchanged | new `noteCodes` case: no `§`, `spec`, `ERRATUM`, `A' ` in any metric/coverage sentence; existing byte-equality case keeps en == server |
| H3 | "Unresolved decisions" heading over "Unresolved decisions: 0" (same in zh) | The line under each data-health heading is the bare number; the three `*Count` locale keys are deleted | `metricsNotes` lines rewritten to the number; new `metricsLayout` case with non-zero counts |
| M4 | "View all 115 decisions" can land on a filtered or Reviewed list whose length is not 115 | `Overview` gets `onViewDecisions?: () => void`, called on the link's click; App resets status to unreviewed and the filter to `NO_FILTER`; the link stays a bare `#decisions` hash | App-level jsdom case |
| M7 | Category tints (`--cat-idle`, light `--cat-done`) still use pre-refinement bases | Tints take their RGB from the block's own `--muted` (idle) and `--accent` (done); alpha unchanged | new `lightTheme` case over the dark and both light blocks; `contrast.test.ts` must stay green |
| A3 | Double-clicking "Dismiss all" can post an ack twice; a refusal from an earlier single dismiss stays after a later success | In-flight guard + disabled button; `dismissAll` sets the refusal to the failure or to `null` | two `authGate` cases |
| A4 | Touch rule `button, select, input, .nav-item { min-height: 44px }` stretches checkboxes and radios | A second `@media (pointer: coarse)` block resets `min-height` for checkbox/radio (the pinned first block stays byte-identical) | new `shellReflow` case |
| A5 | The j/k/a/c hint shows on touch devices where it cannot be used | Same second coarse block hides `.kbd-hint`; `web/DESIGN.md`'s touch line says both A4 and A5 | same case |
| A6 | `.table-scroll table { min-width: 520px }` makes the two-column usage-groups table scroll on phones | Groups table gets `className="table-narrow"`; `.table-scroll .table-narrow { min-width: 0 }` | new `metricsLayout` case; the existing "three wrappers" count is untouched |
| A7 | The requirement answer round has no primary action | "Send answers" gets `.btn-primary`; "Accept all recommended" stays secondary | `template.test.ts` count for `RequirementsPanel.tsx` 1 → 2 (rewrite; see §5) |
| A8 | Per-component `data-tone` choices are unpinned; deleting one would go unnoticed | Tests only: render where cheap (RefusalNotice, Overview, UsageSettlement), read source where the component needs the whole control plane (ControlPanel, App) | new `toneSites.test.tsx`; mutations prove each case can go red |
| A9 | No test that an unavailable memory code other than `ccmem-missing` still shows the full Refusal | Test only | new `memoryView` case |
| Docs | Batch 3 conclusions live only in `handoff_ui.md` | Fold them into `docs/handoff/handoff.md` on this branch (merged with round 2, so the main worktree is not touched) | — |

New English wording (H2):

- no-review-coverage: `review coverage has no data: only the panel produces it, and the correction rate must never be read on its own`
- stale-bias: `systematically low: closing a stale correction requires the chose_instead field (CLI flag --chose-instead), which a stale correction may not have`

## 4. Out of scope

- Group B minors (recorded in `final-review.md`; not reopened).
- Undo Agree (H4).
- Any layout, palette or copy change beyond the rows above; zh metric notes (already reworded in batch 3).

## 5. Constraints and the agent's own rulings (H7)

- Server change is limited to the two sentence constants; `orca metrics --json` output changes wording for those two
  caveats. Before changing them, grep proves nothing parses the text (only `compute.ts`, `en.ts`, the golden fixture).
- **R-a** `tests/fixtures/metrics/golden.json` holds four copies of the old sentences; it is updated with the new ones.
  It is fixture data that follows from H2, but it lives under `tests/`, so it is reported to the human at the end.
- **R-b** A7 needs `template.test.ts:33` rewritten (1 → 2). Not in H1–H3; done on the agent's recommendation under H7
  and reported at the end. Alternative was dropping A7.
- **R-c** A4 avoids rewriting `shellReflow.test.ts`'s pinned regex by adding a second coarse block instead of editing
  the first.
- **R-d** A8 reads ControlPanel and App source rather than rendering them: both need the full control-plane fixtures;
  `template.test.ts` already makes the same trade. Their mutations must still turn the cases red.
- Every rewritten test line carries `REWRITTEN (human authorisation, session 1f3cceb2)` or, for R-b,
  `REWRITTEN (agent ruling under H7, session 1f3cceb2; reported for review)`.
- Root suite guards web copy: `tests/metrics/noteCodes.test.ts` and `scanPanelText` — run them, not only `--ws check`.
- Work only in worktree `/Users/biran/code/skills/orca/Orca-wt/ui-taste`; merge/push/branch deletion are the human's.

## 6. Revisions after the independent review (same session, before the plan; overrides the text above)

Read-only reviewer (session 1f3cceb2, at the branch tip `Merge branch 'ui/panel-taste'`): no Critical, four Important,
seven Minor. Dispositions:

- **I1 → A7 dropped.** `NewRequirement`'s submit is already `.btn-primary` and is always rendered beside the detail that
  holds the answer round (`RequirementsPanel.tsx:121,382,385`), so a primary "Send answers" would put two filled
  primaries on one screen — against `web/DESIGN.md` ("one primary per view") and batch-3 §7. R-b is withdrawn;
  `template.test.ts` is not touched. Reported to the human (they had approved A7 without this fact).
- **I2 → H1 removes the field.** `executionPort` leaves `ControlAlertInput` (`Shell.tsx`) and the App call. Within H1's
  file authorisation, `shell.test.tsx` rewrites line 21 (drop the field from `quiet`), line 24 (describe title "six" →
  "five") and line 31 (expects `false`, passing the extra field through a type assertion to show it is ignored).
- **I3 → H3 shape.** The bare number stays the direct text child of the `data-testid` element (no wrapper), so
  `metricsView.test.tsx:87-98`'s patterns keep matching visible text. The new `metricsLayout` case pins each heading
  with its number (`<h2>Unresolved decisions</h2><p data-testid="unresolved-count">2</p>` etc.).
- **I4 → A3 widened.** `dismissAll` runs inside `try/finally` (guard always released) and catches a rejected request
  with `failureFrom`, as `read()` does; the per-notice "Dismiss" buttons are disabled while it runs. Third `authGate`
  case: a rejected ack shows a refusal and re-enables "Dismiss all".
- **M-a** The second coarse block comes after the first; its test finds it with `lastIndexOf`.
- **M-b** `web/DESIGN.md` gains a touch line (there is none today).
- **M-c** Both the plain-text (`src/metrics/report.ts:45,55`) and JSON outputs change. `compute.test.ts` requires the
  words "review coverage" and "chose_instead" — kept. Stale wording uses "must not have" (matches zh 按规定不能带).
  The new no-citation criterion also rejects `schema\.ts`, so stale-bias drops the file reference:
  `systematically low: closing a stale correction requires the chose_instead field (CLI flag --chose-instead), which a stale correction must not have`
- **M-d** A8 also pins `MemoryView.tsx:124` (`role="note" data-tone="warn"` for ccmem-missing).
- **M-e (recorded, not done)** `refetchRequired` renders `data-tone="info"` yet still lights the red nav dot — the same
  two-severities shape as H1, but not authorised; reported to the human.
- **M-f** `handoff.md` gets conclusions only (it is already 65.8K; Rule 13). `handoff_ui.md` is kept (it is the live UI
  handoff); only its §七 status lines are replaced.
- **M-g** M4's reset also clears the selection (`setSelected(null)`), so a Reviewed row does not stay open over the
  unreviewed list.
