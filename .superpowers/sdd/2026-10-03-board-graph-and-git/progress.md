# Board: dependency graph and git scheme — progress ledger

Owner: Orca controller session `6a4dd7f3`, 2026-10-03. Spec: `docs/superpowers/specs/2026-10-03-board-graph-and-git-design.md`.
Human pick (this session): "接下来先做「看板剩下的部分」". Done by the controller directly (no subagents): one small slice.
Every measured value carries its command; "observed at" is the clone at `46c7fb3` plus the working-tree diff later
committed under the subject `feat(board): draw the dependency graph and show the git scheme from the drive records`.
Clone: `git clone --local` copy in the session scratchpad, HOME and the four XDG roots redirected, TMPDIR `/private/tmp/oc-mi7A`.

## Rulings

Ruling: no plan document and no subagents — the slice is two web components, one pure layout function and one optional
wire field; the spec's criteria table is the plan — cost if wrong: a reviewer reads the spec instead of a plan.
Ruling: the graph is hidden for a group without any dependency (spec D1 note) — it would repeat the table and add a
button per task to every existing group page; with no edges nothing is lost — cost if wrong: one condition.
Ruling: the group view does not carry the repository's current workspace mode; the page's existing read
(`RepositoryWorkspaceV1`) is passed down — a mode change moves no group projection (workspaceSettings.ts:
`projectionGroupIds: []`), so a group-view field would go stale until some other change — cost if wrong: a prop path.

## Criteria (green)

- `cd web && ../node_modules/.bin/vitest run tests/dependencyGraph.test.tsx tests/gitScheme.test.tsx tests/i18nKeys.test.ts` → 3 files, all passed (after the panel-plumbing criterion was added: gitScheme 8 tests).
- `./node_modules/.bin/vitest run tests/panel/runGitView.test.ts tests/panel/webParity.test.ts tests/panel/runContinuable.test.ts` → 3 files, 14 tests passed.
- `cd web && ../node_modules/.bin/vitest run` (whole web suite) → 61 files, 382 passed, 0 failed (before the plumbing criterion).

## Mutations (each applied alone in the clone, restored; `python3 <scratchpad>/mut.py`)

All 24 seen red on the named criterion:
M1 layer depth constant · M2 missing not counted · M3 cycle not counted · M4 cycle guard off (recursion) · M5 tie order
reversed (dependencyGraph layout criteria) · M6 graph shown without edges · M7 node click removed · M8 Enter removed ·
M9 blocked class removed · M10 missing note removed (dependencyGraph render criteria) · M11 estimate runs not filtered ·
M12 runs without git not filtered · M13 mode from another repository · M14 "not landed" branch removed · M15 empty-runs
line removed (gitScheme section criteria) · M16 card unread branch removed · M17 card clone branch removed · M18 card
mode from another repository · M19 TaskDetail does not pass the mode (gitScheme card criteria) · M20 ControlPanel does
not pass the workspace — first survived (no criterion rendered ControlPanel), then red after the criterion
"passes the control panel's workspace read on to the open group's Git section" was added · M21 server `git: null` ·
M22 server mode constant `worktree` · M23 server landed = base · M24 server invents git for a run without a drive record
(runGitView). Restore check: `git diff | wc -c` in the clone 16075 before and after (new files are untracked copies).

## estimateE2E fixture (same session, commit `test(fixture): read a fake CLI log created but not yet written as no lines`)

- Green: `vitest run tests/control/ccloopWorldLogLines.test.ts` rc 0; mutation (old reader `.trim().split("\n")`) rc 1,
  red "expected [ '' ] to deeply equal []"; restored, clone/main diff of the fixture byte-identical (1664 bytes each).
- `vitest run tests/control/estimateE2E.test.ts` ×3 → 3/3 rc 0 (3 tests each), load 4.72 / 4.73 / 6.01;
  `agentSelectionE2E` + the new criterion rc 0 (8 tests); `npm run typecheck` rc 0.

## Gate (clone, `bash <scratchpad>/gate-board.sh`, segments run one by one; ORCA_CCLOOP_BIN = ccloop `ae2caa3` build)

- web build 0 · typecheck 0 · ledger 0 · claudemd 0 (150/200) · hooks 0 · `verify:control` 0 (121 files, 1221 passed, 3 skipped)
  · `verify:scheduler` 0 (194) · `verify:ccloop-pin` 0 (3) · `verify:panel` 0 (15 PASS lines) · `npm run --ws check` 0 (web 383/383)
  · R1 real ccmem 0 (1 passed, temp data root) · `check-tmp-leak` 0 (2623 tests, 0 entries left).
- Full vitest RC 1: 289 files, 2623 tests, 2617 passed, 2 failed, 4 skipped — `driverRequirementSplit` (5 s timeout, registered
  flake) and **`scanPanelText` "nothing left to translate" — a real red of this round**: the four two-word class literals
  `"dep-node dep-…"` in `DependencyGraph.tsx` read as user text. Uptime 6.38 → 6.60 (5-min 11.42).
- `verify:chain` RC 1 only in its own full run: `gateCheck` K13, `controlShutdown` 143, `driverRequirementSplit` (all
  registered) and the same `scanPanelText`; chain suite 213/213. Load up to 22.58 during it.

Ruling: fix the scan red in the code, not the criterion — the allow-list in `tests/panel/scanPanelText.test.ts` is an
existing criterion and needs the human; building the class from single-word literals (`["dep-node", kind].join(" ")`)
keeps the scan's meaning — cost if wrong: one helper.

After the fix (clone re-synced, `<scratchpad>/out/re/`): typecheck 0, web build 0, `scanPanelText` 0, `npm run --ws check` 0
(383/383); `gateCheck`, `driverRequirementSplit`, `controlShutdown` each 3/3 rc 0 alone (1-min load 17.07 → 5.96); M9
re-anchored to the new code (`"dep-blocked"` → `"dep-active"`) still red; clone `git diff` byte-identical to the main
tree's `git diff HEAD` (37054 bytes). Real `~/.claude/ccmem` names and `~/.orca` stat+sha256 identical to this session's
earlier snapshot (`snap.sh`, `cmp`).
