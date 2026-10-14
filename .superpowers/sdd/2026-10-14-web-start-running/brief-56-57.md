# Brief: feedback #56 + #57 (with #39's remainder) — retry / settle / saved-result verify are hard to find

Repository: Orca, worktree /Users/biran/code/skills/orca/Orca-wt/web-start-running, branch fix/web-start-group-running (HEAD has #53's fix: `executionPending` on group summaries). Read /Users/biran/code/skills/orca/Orca-wt/omp-single-call/.superpowers/sdd/2026-10-14-omp-single-call/hard-rules.md (worktree path differs: use THIS worktree) and this repo's CLAUDE.md and web/DESIGN.md first.

## Triage (controller, read-only check; line numbers approximate — re-read, Rule 8)
- Retry, settlement and saved-result verification (`execution-format-failure-v1`) all exist, but are offered only in the Runs table (web/src/ControlGroupView.tsx ~391-397) and at the bottom of TaskDetail (~274).
- Overview jumps to the `problem` region, which offers only "open run".
- A group with a blocked task shows `review` (any checkpoint sets review, src/control/checkpoints.ts ~103) — note only; do not change group state.

## What to do
1. Read the current gating of the existing Retry / Settle / Verify-saved-result buttons (`retryRunOpen` and siblings — find the exact predicates and the command verbs they send).
2. Offer the SAME button(s), behind the SAME gating predicate(s) (import/reuse; never re-derive), in (a) the problem-region row for that run/work item in the group view and (b) the work-item row. No new server command, no new verb, no protocol change.
3. Keep the raw error code visible next to the friendly explanation (`RunReason` / `diagnosis` already provide the friendly text) — where the row shows a reason, both must appear.
4. Out of scope (deferred): keyboard shortcut r, batch retry.
5. Strings: reuse existing i18n keys where the button text is the same; any new user-visible string goes through `t()` in both en and zh, and run root `tests/panel/scanPanelText.test.ts` and `tests/metrics` (web strings are checked there). Colors only via data-tone; one primary button per view (.btn-primary) — new buttons are secondary.
6. TDD (Rule 9): DOM tests (`// @vitest-environment jsdom` first line) that render the problem region and the work-item row for a run whose existing gate is open and assert the button is there and sends the same command as the Runs-table button; and one where the gate is closed and assert it is absent. See each red before the implementation. Then mutation evidence in a `git clone --local` copy under /private/tmp/osc/mut/w5657 (gate forced true / forced false, button removed from each new site) — each seen red on its named assertion; restore with `cat`, sha256 + `git diff`/`--cached` 0 bytes.
7. Gates: root `npm run typecheck`; `npm run build --workspace web`; web tests (`cd web && npx vitest run`); root tests/panel/scanPanelText.test.ts and tests/metrics. Redirect each to /private/tmp/osc/logs/w5657-*.log, read whole, record RC. No existing test rewritten — if one goes red and needs a change, STOP and report.
8. Commit (`/usr/bin/git commit -F`): fix(web): ... ; same two trailer lines as hard-rules.md.

## Report
You cannot write report files (harness refuses). Put the full report in your final message: the gate predicates you reused (file:line), sites added, RED/GREEN commands and outputs, mutation table (sha256, red line), gates with RC, commits. Then the short status contract (Status, commits, one-line test summary, concerns).
