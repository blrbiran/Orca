# Final whole-branch review — ui/panel-taste (cfb7728..1157149)

Reviewer: read-only subagent of session 62660548, 2026-10-14, at HEAD 1157149 (worktree clean except untracked `.impeccable/`).
Scope checks run: `git diff --stat cfb7728..1157149 -- src tests` = empty (no server/root-test change);
`git ls-tree -r 1157149 --name-only | grep -c node_modules` = 0; `git diff cfb7728..1157149 -- web/tests | grep -c '^-[^-]'` = 0
(existing test files append-only; only authGate/memoryView modified). No test suite re-run (per brief).

## Critical
None.

## Important
None. The Review Focus items hold in code: hooks sit before `if (error !== null) return` (App.tsx:1164-1203 vs :1205);
`a` is guarded against `repeat`, in-flight and already-recorded Agree (reviewKeys.ts:7, App.tsx:1189-1195), and only
fires once `decision` (the fetched body for `selected`, App.tsx:850-853) is on screen; `[role="alert"]:not([data-tone])`
stays danger (styles.css:155); the narrow/short block unlocks height without hiding `.project-control .caveat`.
Cascade checked: tone rules (0,1,0) come after the shared neutral rule incl. `.chain-banner`; `.uncertain-operations
p[role="alert"]` (0,2,1) still strips its inner alert; `.section-pane .overview-layout > section[aria-label]` (0,3,1)
beats both card rules (0,2,1)/(0,1,2); `.btn-primary:hover` (0,2,0) beats `button:hover` (0,1,1); `.callout` in
DecisionOperations was and still is overridden by the pane card rule. j/k order matches the rendered list (both use
`filterRows` on the same rows/filter). The skip link is absolutely positioned, so it takes no grid cell in `.shell`.

## Minor
| # | file:line | effect on a person | fix |
|---|---|---|---|
| M1 | styles.css:168 | Hovering a disabled primary (New requirement before an idea is typed; loop-plan submit while blocked) recolours it as if clickable. Common: the requirement form starts disabled. | `.btn-primary:hover:not(:disabled)` (no test slices this selector). Same as deferred T7-b. **Fix before merge.** |
| M2 | zh.ts:376, 427, 428, 523, 694, 784 | The account badge now says 所有者 while six sentences still say "owner" — the exact 同物两名 P2-7 set out to remove. No test pins these strings (grep of web/tests, tests: none). | Replace "owner" with 所有者 in those zh sentences. Same as deferred T8-a. **Fix before merge.** |
| M3 | web/DESIGN.md:43 | Says on ≤760px "footer and long sidebar captions hide" — contradicts spec §7 (project caption must stay on phones) and shellReflow.test; a later dev following DESIGN.md would hide the only explanation for the hidden Add/Rename. Also omits the `max-height: 560px` trigger. | "≤760px or ≤560px tall: … only the footer hides; the project caption stays." **Fix before merge** (doc, one line). |
| M4 | Overview.tsx:37 | "View all 115 decisions" is a bare `#decisions` link: if the person last left Decisions on Reviewed/All or with a kind filter, it lands on a different list than the count promised. | Give Overview an `onViewDecisions` prop that does `setStatus("unreviewed"); setFilter(NO_FILTER)` before navigating. Fine to leave this round (no data effect). |
| M5 | App.tsx:1183-1187 | `k` on the first row (and `j`/`k` when the row object was replaced by a poll) re-opens the same row: `setSelected` with a new object re-runs the fetch effect (App.tsx:1099-1123), blanking the detail to loading for a moment. | Skip when `to` has the same `rowKey` as `selected`. Fine to leave. |
| M6 | App.tsx:1176-1202 | Single-key shortcuts are live whenever the Decisions pane is shown, with no off switch (WCAG 2.1.4); an irreversible Agree can come from a stray `a` with focus on e.g. a notices/account-bar button. Low risk for a one-person panel. | Only act when `document.activeElement` is `body` or inside `.section-pane[data-section="decisions"]`; consider a settings toggle later. Fine to leave. |
| M7 | styles.css:31 | Dark `--cat-idle` still uses the old cool muted rgb(168,168,179); light `--cat-idle/--cat-done` use pre-refinement bases (T1-b). Imperceptible at 0.12–0.18 alpha; contrast pinned. | Follow-up only. |

## Deferred-minor triage (every "minor (deferred)" line in progress.md)
| Ledger line | Verdict | Reason |
|---|---|---|
| T1 warm-paper check measures only --bg | fine to leave | Other light surfaces are pinned by contrast checks; bg carries the visible warmth. |
| T1 --cat-idle/--cat-done light tints use old bases | fine to leave | Alpha ≤0.16 tints; hue drift invisible; contrast pinned (see M7). |
| T1 DESIGN.md states later rules as present fact | fine to leave | True at branch end — but its Layout line is wrong in substance, see M3 (must fix). |
| T2 data-tone on RefusalNotice/ControlPanel/App/Overview/UsageSettlement not component-pinned | fine to leave | Rule 9 gap with low blast radius (colour only); add in a follow-up. |
| T2 tone.test status regex only sees rules starting with [role="status"] | fine to leave | Shared-rule loop carries the real check. |
| T3 dismissAll: stale refusal not cleared on success, no in-flight guard | fine to leave | Worst case a spurious refusal line after a double click; acks are server-validated. |
| T3 coarse 44px also hits notice buttons and checkbox/radio | fine to leave pending Task 9 screenshots | If a checkbox renders stretched on a touch device, change to `input:not([type=checkbox]):not([type=radio])`. |
| T3 skip link first in Shell, not first on page; absolute vs fixed | fine to leave | AccountBar is 1–3 stops; link still reaches main. |
| T3 wide-short screens keep split-list max-height/sticky detail; duplicate RTL import | fine to leave | Page now scrolls; a nested list scroll remains usable. Import dup is cosmetic. |
| T4 competing poll can cancel auto-advance | fine to leave | Fails safe (selection stays). |
| T4 advance effect deps array misleading | fine to leave | Comment states it runs every render; behaviour correct. |
| T4 .kbd-hint shows on touch devices | fine to leave | One muted line; optional `@media (pointer: coarse) { .kbd-hint { display: none } }`. |
| T4 second-'a' test's afterReview still lists the reviewed row | fine to leave | Test still discriminates the recorded-guard (it fails without it per fix round). |
| T5 card-removal assertion checks only border/box-shadow | fine to leave | Task 9 screenshot covers the visual; CSS rule also strips background/padding. |
| T6 `.table-scroll table { min-width: 520px }` forces 2-col usage-groups table to scroll | fine to leave | Usable on phones (scrolls); could scope min-width to the wide tables later. |
| T6 data-health row position not pinned; UsagePanel wrappers unindented | fine to leave | Cosmetic / low-value pin. |
| T7 requirement answer round has no primary | fine to leave | Outside spec's four named views; flag for human visual review. |
| T7 `.btn-primary:hover` shifts a disabled primary; heading test matches literal CSS | **must fix before merge** (hover part) | User-visible false affordance on a commonly disabled button; one-line fix (M1). Literal-CSS test is fine to leave. |
| T8 English "owner" in several zh sentences | **must fix before merge** | Same object, two names next to the new 所有者 badge — P2-7's own defect; no test pins them (M2). |
| T8 no test that a non-ccmem-missing unavailable code still renders the full Refusal | fine to leave | Code is correct (MemoryView.tsx:387-393); worth a one-case test in follow-up (Rule 9). |

## Still awaiting the human (from the ledger, unchanged by this review)
- Nav red dot for "no execution port" vs the new amber note (shell.test.tsx pins controlAlert).
- English metric notes still carry spec citations (server sentences + tests/metrics/noteCodes.test.ts).
- Mutation clones left in scratchpad (mut-t3, mut-t4f, mut-t5, mut-t7) — scratch only.
- Context-budget breach (Rule 6) recorded in the ledger.

## Verdict
**Ready after fixes** — M1 (one selector), M2 (six zh strings), M3 (one DESIGN.md line). All are small, web/-only, and
touch no pinned criterion; re-run `npm run --ws check` after them. M4–M7 and the remaining deferred lines are fine to leave.
