# Task B6 review — the editable plan card

Reviewer: subagent of session `1d7d9aa0` (Opus 5.5), 2026-09-30. Range 92ef663..d49c7af (one commit, d49c7af).
Read: brief, report, global.md, rulings.md, the review package diff, spec §4 and §11, and one focused read per named risk (below).
No criteria re-run; the implementer's evidence files under `scratchpad/b6/` were opened (mut-summary.txt, web-all.txt).

### Spec Compliance

- ✅ Spec compliant. Every file the brief lists has its hunk: `web/src/controlApi.ts` (import, union member, route case,
  diff l.285/309/331), `web/src/LoopPlanCard.tsx` (replaced, l.70–239), `web/src/TaskDetail.tsx` (l.259), `web/src/App.tsx`
  (import l.31, clear line l.54), two new test files. `ControlGroupView.tsx` untouched (P10).
- English strings match the R-F5 table and P1 exactly (form/button/field names, status line with `→`, units `tokens` /
  `ms active time` / `attempts`, `Group reserve too small: <dim> short by N`, `Budget unchanged`). P9 implemented as a
  separate `BAD_FILE_CAP` message (LoopPlanCard.tsx diff l.104–105, 141–146).
- Departures judged: (1) scoping the App criterion `within(region "Plan a")` is necessary — the page's import form also has
  a `Goal` textbox, so the brief's unscoped `queryByRole(... "Goal")` toBeNull could never pass; assertions are otherwise the
  brief's. Accepted. (2) four added criteria are what P3 requires. Accepted. (3)/(4) accepted.
- ⚠️ Cannot verify from diff: that `WEB_LOOP_PLANS` option `name`s equal the R-F5 plan names (B5's file, not in this diff).

### Named risks — what was checked

**(1) Stale draft is detected, not silently submitted over someone else's change (spec §4.2).**
Checked: diff l.186 stores `base: plan.loopVersion` once at "Change plan"; l.187 `set` spreads `...draft` so `base` survives
every edit; l.148 sends `baseLoopVersion: draft.base`; server `src/control/webService.ts:600`
(`payload.baseLoopVersion !== loopVersion` → `task-loop-version-conflict`) refuses it. The card shows
`role="status"` "The plan changed after you started this draft (v{a} → v{b})" (l.197). Criterion
`sends the plan … loopVersion the draft started from` rerenders with `loopVersion: 1` and asserts both the status text and
`baseLoopVersion: 0` in the sent command; MB6-1 (base from poll) and MB6-6 (status line deleted) both seen red
(`scratchpad/b6/MB6-1.txt`, `MB6-6.txt`). App level: the refusal keeps the draft and `posted[1].payload.baseLoopVersion` is
still 0. Verdict: holds. The submit stays enabled on a stale draft (the server refuses by name) — the same as the label
editor (`TaskDetail.tsx` Save labels), which spec §4.2 names as the pattern.

**(2) The consequence text matches what the server will do.**
Checked server `webService.ts:596–628`: `shortfall = next[d] - before[d] - proposal.explicitUnallocatedReserve[d]`, refused if
> 0, first dimension in `dimensions` order; `sessions` carried over (R10). Client `consequenceOf` (diff l.159–170):
`delta = work[d] - current[d]`, shortfall when `delta > reserve[d]`, amount `delta - reserve[d]`, first dimension only, over
tokens/activeMs/attempts — the same inequality, the same number, the same dimension names as the server's detail. The view's
`ledger.explicitUnallocatedReserve` is held equal to the proposal's by the conservation check (`webService.ts:116`), and
`current` is the view's work allocation = the server's `before`. "R left" = `reserve - delta`, which is what both server
branches produce (confirmed: `residual(limit, used, committedRemaining + delta)`; draft: `resetDraftReserve`). Disabled +
guarded submit: MB6-2 and MB6-9 seen red. Verdict: holds.

**(3) Two buttons named "Discard draft" while a plan draft is open.**
Checked `TaskDetail.tsx:152`: the label editor's `Discard draft` is `disabled={draft === null}`, so two *enabled* buttons of
that name exist only when a label draft and a plan draft are both open. The plan form's button sits inside a named form
landmark (`Change plan a`); the label one sits loose in region `Task a`. A screen-reader user pulling up a button list
hears "Discard draft" twice with no way to tell them apart, and either click destroys typed text with no undo; a sighted
user has the layout. Severity: **Minor** — requires both drafts open, the loss is a draft (re-typable, nothing reaches the
ledger), and the name is the controller-fixed P1 string. Suggested fix (needs a P1 amendment by the controller):
`Discard plan draft`, or keep the visible text and add `aria-label="Discard plan draft"`.

### Strengths

- `payloadOf` returns `{ payload } | { invalid }`, so the blocked reason and the button text come from one value; the submit
  can never be enabled while any number is unparseable (diff l.188–195).
- `readLoopDraft` validates every stored field before trusting sessionStorage-sourced JSON, with a criterion over five
  malformed shapes (MB6-16/17/18 red).
- `started` mirrors the server's step 2 exactly (status not draft/ready, or any run) and each half has its own mutation
  (MB6-14/15).
- Rule 9 discipline: 20 mutations, each with a named red test and a 0-byte restore file; whole web suite 186/186 in the clone.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

1. **Duplicate accessible name `Discard draft`** — see risk (3). `web/src/LoopPlanCard.tsx` diff l.214 vs
   `web/src/TaskDetail.tsx:152`.
2. **The form is offered where the server always refuses.** `LoopPlanEditor` gates only on task status/lineage (diff l.184);
   the server also refuses `group-state-invalid` for a group that is not draft/ready or is stopped
   (`webService.ts:582`). A ready task in a running group (exactly the App criterion's fixture, `loopPlanDraft.test.tsx`
   diff l.369/380) shows an editor whose every submit is refused. Spec §4.2 names only "once the task has started", so this
   is within the letter; consider also freezing on `view.summary.state` not draft/ready or `stopMode !== null`.
3. **Shortfall not tied to the disabled button.** The disabled submit's accessible name is the consequence text, which in
   the shortfall case reads "…; -1 left" (diff l.166, negative reserve); the `role="alert"` naming the shortfall is not
   referenced by `aria-describedby`. Add `aria-describedby` to the alert's id.
4. **Untested branches without a named mutation** (Rule 9 / P3): `shortfall === null` (first-dimension-only, diff l.167 —
   no criterion has two short dimensions); `lines()` blank-line filtering and `.trim()` on goal / success condition
   (l.134, 150). Each can be deleted with every criterion green. Low risk (server re-checks), but P3 asks for every new branch.
5. **Consequence text density:** parts are joined with `; ` and each part already contains `; ` (diff l.166, 169), so two
   changed dimensions read as four `;`-separated clauses. The implementer flagged it; cosmetic.
6. `config` in `loopPlanEdit.test.tsx` diff l.468 is unused (copied verbatim per P6; noted only).

### Assessment

**Task quality:** Approved

**Reasoning:** The three named risks hold on inspection against the server code: the draft sends its own base loopVersion
and shows the conflict, and the reserve arithmetic is the server's inequality with the same numbers and dimension names.
The duplicate `Discard draft` name is a real but minor accessibility wart fixed by a P1 string change.
