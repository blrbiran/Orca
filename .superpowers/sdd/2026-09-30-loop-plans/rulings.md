# Controller rulings for every task of docs/superpowers/plans/2026-09-30-loop-plans.md

Read this after your task brief. Where this file and the brief differ, this file wins. It extends the plan's own
"Controller rulings on the draft" (R-F5 English string table, R-F15 investigate-max-files).

P1. English strings missing from the R-F5 table:
    `检查命令（{n} 条）` → `Check commands ({n})`;
    `做法在你起草之后变了（v{a} → v{b}）` → `The plan changed after you started this draft (v{a} → v{b})`;
    `放弃草稿` → `Discard draft`;
    budget units in the consequence text: `token` → `tokens`, `ms 活跃时间` → `ms active time`, `次尝试` → `attempts`.
    So the button reads e.g. `Budget +500000 tokens, taken from the group reserve; 5500000 left`.
    Grammar: singular when the number is 1 — `Acceptance: 1 check command, all must pass`,
    `Acceptance: 2 check commands, all must pass`; `At most 1 file changed (reported by the agent)`,
    `At most 25 files changed (reported by the agent)`. Tests pin these exact forms.
P2. investigate-max-files: checked after `path-shape` and after `investigate-target` (order: unknown-plan, path-shape,
    investigate-target, investigate-max-files, design-target). Any shared fixture input that is used with the
    `investigate` plan must not carry `maxFilesTouched` other than 1 (drop the field for investigate cases) so no
    criterion goes red for the wrong reason. Criteria: one in A1 (expansion) and one in A3 (import refusal detail
    `loop-plan-invalid:<taskId>:investigate-max-files`). No separate command-level criterion.
P3. Rule 9 over the plan's mutation lists: every NEW branch your task adds needs a named deletion mutation seen red,
    including branches the plan's mutation list omits. List them all in your report with the red evidence file.
P4. B7: the criterion itself raises `work.tokens` (+500_000, as B3 does), so the full-rebuild mutation is seen red
    without editing the test.
P5. No duplicated production logic: B2's draft branch must reuse the existing code paths — call `prestart`, call the
    existing reserve/residual helpers, and if `editProposal`'s reserve-and-reopen sequence is needed, extract it into
    one helper used by both `editProposal` and `set-task-loop` (behavior-preserving; existing criteria must stay green).
    B1 reuses A5's recipe re-expansion check function instead of repeating it.
P6. Duplicated test scaffolding is accepted as the plan writes it (test code), but when you copy a fixture "verbatim"
    re-measure the source lines and copy them exactly.
P7. Assertions that cannot fail are dropped: A4's `planHash` self-equality and A2's self-equality assertion; keep the
    second assertion of each test.
P8. Commit trailer: exactly the plan's two lines (`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
    and the `Claude-Session:` line). Every implementer runs on Opus 5.5, so the trailer is true. After committing, run
    `/usr/bin/git log -1 --format=%B > "$SCRATCH/<task>-msg.txt"` and read it back to check both lines.
P9. Cosmetic: a bad file-cap input in the B6 form shows `Max files changed must be a positive integer`, not the budget
    message; everything else in preflight D8/D9/D12 is accepted as written.
P10. Plan text that contradicts itself: the Global Constraints lines saying panel strings are Chinese and the
    F5/F6/F15 rows are superseded by R-F5/R-F15/this file. `taskLoop.ts` (if created in B1) is used by B2/B3 only;
    ignore the l.2044 mention of B7. B6 does not touch `ControlGroupView.tsx` unless its steps require it. `run.ts:201`
    needs no edit beyond what the A3 steps say. Use the same placeholder indentation as the surrounding code.
