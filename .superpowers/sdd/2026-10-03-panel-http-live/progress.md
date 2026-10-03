# Panel HTTP path under a real agent — progress ledger

Owner: Claude Code interactive session `16ab00f2`, 2026-10-03. Base commit for every run below: Orca main at the
commit with subject `docs(handoff): §4.0 for the next session -- push check without counts, and the skills to use`,
plus the uncommitted `scripts/live-panel-http-acceptance.ts` (byte-identical copy into the clone, checked with `cmp`).
ccloop: a `git clone --local` checked out at `ae2caa3` (the SHA Orca pins), built with `npm run build`.

Why: goal.md §4 near-term item 4 ("Web dispatch to a real ccloop opens a run"); §11 recorded that the real codex
and real claude main chains had both bypassed HTTP. Human approval for the paid run, the criterion and the cap:
2026-10-03 in this session ("A 批准").

## Criterion

`tsx scripts/live-panel-http-acceptance.ts ...` exits 0. It starts a real `orca panel` process and does every step
over its HTTP API with the one-time token (`x-orca-token`): agent preferences, import-plan, proposal-edit, confirm
(fields as `web/src/BudgetEditor.tsx` submitConfirm), start; then polls only `GET /api/control/groups/g`. Checks are
listed in `summary.checks` (18 in fake mode, 21 live).

## Runs (all in the clone; fake runs with HOME and the four XDG roots relocated; TMPDIR `mktemp -d /private/tmp/ph-XXXX`)

| run | command delta | rc | result |
|---|---|---|---|
| fake1 | first draft (loop waited for view state `landed`) | 1 | `notTimedOut`, `runLanded` red; other 16 green. A driver-settled run shows as `settled-recoverable` in the view (`src/panel/controlViews.ts:638`); `landed` is transient. Timeout path observed: panel exit code 0 after SIGTERM, no surviving process groups. |
| fake2 | fixed: loop ends on task `completed`; `runLanded` = `settled-recoverable` + `git.landedCommit` non-null | 0 | 18/18 |
| m1 (mutation) | `x-orca-token` header removed | 1 | first POST answered 401 `token-required`; 12 checks red |
| m2 (mutation) | fake claude writes `41` | 1 | run `blocked`; `taskCompleted`, `runLanded`, `landedCommitHolds42`, `workBranchHolds42`, `onlyTargetChanged`, `providerCalls`, `fakeCallsExact` red |
| live1 (paid) | `--claude <nvm claude> --model claude-opus-5-5 --call-usd 0.6 --cap-usd 2 --deadline-ms 900000`; HOME not relocated | 0 | 21/21 |

Mutations restored with `cat original > clone file`; `cmp` reported identical. `pgrep -fl "fake-claude-cli|claude-phase-runner"`
after the fake runs: no match (exit 1).

## live1 numbers (copied from summary.json, sha256 `a650c15b91d454e806f1afab4dc26e17f6173568ee44cec209738e4b2860a2e3`)

- claude 2.1.288 (`/Users/biran/.nvm/versions/node/v22.13.1/bin/claude`). Install dir mtime: 12:03:16 at the first
  look, 12:33:16 just before the run (reinstalled in between), 12:33:16 after the run (unchanged during the run).
- Window: 2026-10-03T04:34:58.918Z → 04:35:48.298Z.
- POSTs: import-plan 201, agent-preferences 200, proposal/edit 200, confirm 200, start 202. Every GET 2xx.
- Selection frozen on the task: `{agent: claude, model: claude-opus-5-5, contextWindow: agent-default}`; every claude
  argv carried `--model claude-opus-5-5`.
- ccloop-reported tokens: plan 19436, execute 83036, verify 63138, total 165610; the view's ledger `used.tokens` 165610,
  `usageUnknown` false.
- claude-reported cost (tee'd result envelopes): 0.15788 + 0.196679 + 0.190578 = **$0.545137**; no call without a cost.
- Landed commit `5e3f197585634d9dab1d1e38681a0cec330ee154` (in the throwaway target repo) holds `answer.txt` = `42\n`.
- Panel exit after SIGTERM: code 0; surviving process groups: none. `~/.orca` and `~/.claude/projects` unchanged.

## Honest statement

The panel's HTTP path (token-guarded commands from import to start, then the page's group view) drove one task to a
landing under real claude once (n=1, one soft group, one trivial task, no dependencies, no estimator call — the
profile's null context window makes the estimate blocked-capability). Not covered: a real browser, real codex, the
estimate over HTTP, more than one task, handoff/stop over HTTP.
