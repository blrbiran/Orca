# Task 7 report — the task control and recovery areas

Implementer: subagent of session `e604b1ba` (controller), 2026-10-01. BASE `4ff8d23`. Working tree: local `main`, **uncommitted** (see Status).

## Status: BLOCKED (implementation complete, not committed)

The contract says "any other existing criterion red ⇒ stop and report it by full name". One is red in the full web suite:

`tests/agentPreviewRefresh.test.tsx > App re-reads a group's agent preview when the one on screen can no longer be confirmed (wave 3 I-3) > re-reads a preview whose slot was unavailable five times on the backoff, then waits for the operator's Re-read` — `Test timed out in 5000ms` (5004–5006 ms).

It is a timing margin, not a behaviour change:

| Run | Where | uptime load (1m) | This test | File result |
|---|---|---|---|---|
| full `npm run check --workspace web` | BASE clone (`$SCRATCH/t7-base-check.txt`) | 20.17 | **4968 ms** (pass, 32 ms under limit) | 272/272 |
| full check, Task 7 tree (`t7-web-check.txt`) | main | n/a | 5005 ms timeout | 273/274 |
| full check, Task 7 tree (`t7-web-check2.txt`) | main | 9.46 | 5006 ms timeout | 273/274 |
| full check, Task 7 tree, final criterion (`t7-web-check3.txt`) | main | 11.62 | 5004 ms timeout | 279/280 |
| single file ×3, Task 7 (`t7-apr-{1,2,3}.txt`) | main | 14.29 / 12.48 / 11.02 | 2598 / 2684 / 2636 ms | 13/13 each |
| single file ×3, BASE (`t7-apr-base-{1,2,3}.txt`) | BASE clone | 23.55 / 22.06 / 19.72 | 2377 / 2373 / 2359 ms | 13/13 each |

Diagnosis: the test advances fake timers by 10+20+40+80+160 s and 2×600 s with the App's polls live, so the whole control panel re-renders many times; every new `t()` / `enumText` call costs a little per render (+~11 % measured single-file: ~2370 → ~2640 ms). BASE already sat 32 ms under the 5000 ms default in the full suite, so Task 7 tips it over. Tasks 8–10 add more `t()` calls to the same render path, so this will not go away by itself.

Options for the controller (not taken — no H18 authority for this file): (a) rule it a load flake and commit as is; (b) authorise an H18 rewrite giving that one `it` an explicit timeout (e.g. `, 15_000`) with the H18 comment line; (c) something else. The working tree holds the full Task 7 change ready for `git add` + the brief's Step 6 commit.

## Built

- `web/src/locales/en.ts`: type import from `../controlTypes.js`; the 11 enum families (`groupState`, `stopMode`, `stopState`, `workStatus`, `runPhase`, `runState`, `requestState`, `estimateState`, `budgetMode`, `blockerScope`, `progressStep`) as `satisfies Record<…>`; `control` and `recovery` after `chains`; families added to `enums`. Values verbatim from the brief (pasted by line range from the brief file).
- `web/src/locales/zh.ts`: `control`, `recovery`, the 11 families, verbatim from the brief.
- `ControlPanel.tsx`, `ControlGroupView.tsx`, `TaskDetail.tsx`, `RecoveryView.tsx`, `EvidenceLink.tsx`, `WorkspaceModeSelector.tsx`, `App.tsx` (the line was `:669` at HEAD, not `:654`): every replacement in the brief. The refusal line in ControlPanel (Task 10) and BudgetEditor / LoopPlanCard (Task 8) untouched; the `planText` chip (Task 3) untouched. Two cosmetic deviations: the two `<tr><th>…` rows are split over three lines each, and the handoff line's `failureCode` / `handoffEvidence` expressions sit on separate lines; both render identically (JSX drops newline-only whitespace between expressions) — proven by the byte-identity check below.
- `web/tests/controlI18n.test.tsx`: the brief's two tests verbatim, plus a third `describe` with six tests (see Deviations).

## Commands and results (all `> file 2>&1`, read back whole)

`SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`

- Red before (brief's 2 tests, BASE sources, main tree): `t7-red.txt` rc=1, 2/2 red (`纪元 epoch-a …`, `任务 a`).
- Red before (final 8-test criterion against BASE sources, in the clone): `t7-red-final.txt` rc=1, 8/8 red; clone restored by cat + cmp → `t7-final-restore.txt` empty, rc=0.
- Green: `t7-green.txt` (2 tests) rc=0; `t7-green4.txt` (final 8 tests) rc=0.
- `tsc --noEmit -p web/tsconfig.json`: `t7-tsc.txt` rc=0, empty.
- `npm run check --workspace web`: rc=1 only for the test above (`t7-web-check3.txt`: 279 passed, 1 failed). Every named control criterion (`controlPanel`, `controlKeys`, `taskLabels*`, `evidenceLink`, `workspaceMode`, `handoffResume`, `driverRetry`, `controlPortBanner`, `controlRefetch`, `controlCommandRecovery`) green and unmodified.
- English byte-identity: in the clone, a scratch-only test (`web/tests/zzEnglishDump.test.tsx`, clone only, never in the repo) dumped `innerHTML` of three English renders — the brief's ControlPanel fixture, the TaskDetail fixture, and a ControlPanel with import defaults / clone workspace / no groups / "Reading zz…" — at BASE (`t7-en-base.html`, 6553 bytes) and with Task 7 (`t7-en-new.html`); `cmp` rc=0, empty `t7-en-cmp.txt`.

## Mutations (clone `$SCRATCH/mut-t7`, criterion `tests/controlI18n.test.tsx`)

Summary files: `t7-mut-summary.txt` (first pass), `t7-mut-summary2.txt` (final pass, after tightening the criterion); per-mutant output `t7-mut2-<name>.txt`. Every mutant restored by writing the original back and comparing it to the repo file (`restored=True` on every line).

- Brief's named MT7-1 … MT7-7: all rc=1, each with the brief's named test red (MT7-1/4/5/6/7 also redden a test of the added describe; MT7-2 reddens both brief tests as expected).
- Per-site (contract's last bullet): every `t(` / `i18n.t(` site replaced by `__i18n.getFixedT("en")(` (exactly that site's English back), every `enumText(fam, v)` by raw `v` — 142 sites across the seven files. Final pass: 140 red. Two survive, both unobservable by construction:
  - `ControlPanel` `t("control.import.notConfigured")`: unreachable — the summary branch renders only when `config.defaults !== null`, so the `=== null` arm never runs (kept because the brief specifies it).
  - `TaskDetail` `i18n.t("control.progress.line", …)`: the template is `{{step}} · {{attempt}} · {{tokens}}` in both languages, so English-back is a no-op.
- First-pass survivors fixed by tightening the criterion (substring collisions, the contract's lesson): `control.group.runs` and `control.group.dispatch` headings ("派发" is inside "派发已阻断"), `control.group.resume` ("恢复派发" appeared as the recovery heading "恢复" + alert "派发已阻断…"), `control.task.region` aria-label, `recovery.title` aria-label in the populated branch. All five red in the final pass.

## Deviations

- Added six tests (a `describe` "the rest of the control area's branches in Chinese") to meet the contract's last bullet; the brief's two tests are verbatim. They cover the import form and empty list, table headers/cells and all dispatch buttons, a bare task and `progressText` wordings, recovery with evidence and clone mode, evidence list/download/refusal (stubs `globalThis.fetch`, restored in `finally`), and App's "unavailable" line (stubs fetch, restored in `finally`).
- App.tsx site was at line 669, not 654 (re-measured at HEAD).

## Concerns / leftovers

- The `agentPreviewRefresh` timeout above (blocking).
- Scratch clone `$SCRATCH/mut-t7` is kept (no `rm -rf`, per the user's rule). It also contains an empty, untracked directory tree named `web/src/ControlPanel.tsx web/…` from a zsh word-splitting slip in my first copy loop (that loop's copy failed and its result was discarded; the copy was redone with an array, `t7-copy.txt` empty). Plus the scratch-only `web/tests/zzEnglishDump.test.tsx`. Nothing in the main tree.

## Addendum after the controller ruling (same implementer, 2026-10-01)

Ruling: do not edit agentPreviewRefresh.test.tsx; set `testTimeout: 15000` in `web/vite.config.ts` with a one-line comment. Done.

- Full `npm run check --workspace web` ×3 on the Task 7 tree + config (`$SCRATCH/t7-cfg-check-{1,2,3}.txt`, rc=0 each, read whole): 280/280 each (48 files). The backoff criterion (`… re-reads a preview whose slot was unavailable five times on the backoff, then waits for the operator's Re-read`): 5357 ms (load 7.93), 5163 ms (14.84), 5358 ms (20.66).
- Commits on local `main` (message bodies read back to `$SCRATCH/t7-commits.txt`, trailers exact):
  - `c1b77d0` test(web): give web criteria a 15 s default timeout
  - `c9d30ab` feat(web): translate the task control and recovery areas
- Status now: DONE.
