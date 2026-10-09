APPROVED (FW-W, commit b6c943c). Critical 0, Important 0, Minor 3.

### Spec Compliance
- W1 ✅ en.ts archive-stop-pending and zh.ts: clause added, {{detail}} kept, en has no own code; test failureReasons.test.ts asserts en clause, detail, no own code. zh pin is weak (only "恢复" + {{detail}}), see minor 2.
- W2 ✅ codex-exit-error en+zh entries (plain words + look at evidence, retry task); listed in failureReasons REASONS and refusalCoverage VIEW_REASONS. All four places that list codex-* reasons covered (grep of codex-skills-source-invalid: en, zh, refusalCoverage, failureReasons only).
- W3 ✅ styles.test.ts pins `.dep-node text.dep-stall` to `fill: var(--stall)`; mutation reported RED.
- W4 ✅ TaskDetail.tsx RunActivity: separate runId-only effect resets entries/refusal; changeSeq polling does not flicker. Test asserts after the rerender, with a pending fetch, that run-b region has no listitems and no "no activity recorded yet" (string exists, en.ts:337, so the negative assertion is not vacuous).
- src/control/** untouched; scope respected. Mutations reported for each new branch (⚠️ not re-run by me, plausible from diff).

### Strengths
- Reset keyed on runId only, deliberately not changeSeq; documented in a comment.
- Negative "none recorded" assertion prevents the empty-state masquerading as a pass.

### Issues
Critical: none. Important: none.
Minor:
1. TaskDetail.tsx RunActivity: the reset is a useEffect, so the first render after the run switch still paints run-a rows under run-b's label for one frame. useLayoutEffect or `key={runId}` on the caller would close it fully. Test cannot see it.
2. web/tests/failureReasons.test.ts: zh pin `toContain("恢复")` is weak; pin the clause "请先重试恢复".
3. en.ts/zh.ts: codex-exit-error placed before codex-event-error, breaking the alphabetical order of that block (event-error, events-invalid, exit-error).

### Assessment
Task quality: Approved. All four items met with seen-red tests; only cosmetic/robustness minors.
