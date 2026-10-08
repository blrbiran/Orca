# Final review fix wave: report

Fixer: session eaee0f2c (single fixer), 2026-10-08. Branch `feat/integration-schemes`, base 079f1e2, tip 50e9c52.
Every run's output is under `$S/ffw/` (`$S` = the session scratchpad). RED files were taken before the fix, on the
worktree. Mutations ran in `$S/mut-ffw2` (`git clone --local` at 50e9c52, node_modules symlinked) via
`$S/ffw-tools/mutate.py $S/ffw-tools/spec.json`. Each mutation's log is in `$S/ffw/mut/<id>.txt`, and the full table is in `$S/ffw/mut-table.txt`.
After every mutation the clone was restored, and `git diff | wc -c` / `git diff --cached | wc -c` were 0/0 each time.

## Commits (079f1e2..50e9c52)

| commit | subject |
|---|---|
| 708528f | fix(integration): never reuse a conflict attempt's key (C1, Minor 7) |
| 539e58f | fix(integration): start a new destination from scratch on a scheme change (I1) |
| f792726 | fix(integration): check the person's worktree without rewriting its index (M-T3) |
| 316c807 | test(integration): pin re-entry for every delivery, the paused case and owner case (M-T5) |
| 536dfb0 | fix(integration): ask the remote for the target without a fetch at confirm (Minor 2) |
| 2105dd1 | fix(integration): refuse a target in Orca's own orca/ namespace (Minor 5) |
| d1a7036 | test(integration): spell the orca/ target criteria's schemes out for tsc (fixes a type error 2105dd1 committed) |
| b0d817c | fix(integration): leave the person's own ssh command alone (Minor 6) |
| f1f9947 | fix(integration): store and link only the repository's own pull request URLs (Minor 3, Minor 4) |
| bad2c9e | fix(web): title the Decisions pane by its status and show it loading (M-T8) |
| eee980b | fix(web): keep the token magnitude hint out of the field's label (M-T10) |
| 4595317 | docs(spec): record the integration design's corrections made at execution (Minor 9) |
| 50e9c52 | test(integration): pin each source of the attempt count on its own (C1 extra criteria) |

This report and progress.md are not committed. progress.md was not touched.

## Per item

### C1: a later conflict reused attempt 1 and published the first resolution's tree
- **Change.** `GroupIntegration.attempts` (`safeInteger.default(0)`; `newGroupIntegration` writes 0) is never reset.
  A new function `nextAttempt(store, g, record)` (integrationResolve.ts) returns `max(attempts, conflict?.attempt ?? 0, every booked
  outbox integration-usage:integrate-<g>-<n>) + 1`. Every attempt number now comes from it: integrateGroup, settle's conflict (the
  outcome carries its `attempt`), and failResolution. Both writers store `attempts = max(attempts, attempt)`. (b) In
  `advanceIntegrationResolution`, an approval nothing was spawned for yet (`spawnSeq` 0) removes its runs directory
  before it reads any loop state.
- **Additions beyond the brief, and why.**
  - The booked-outbox term. Setting a scheme to `keep` deletes the record and its counter (R5). Without this term, keep→non-keep numbers
    from 1 again, and that resolution's spend is skipped by the existing outbox key. Cost if wrong: one indexed
    outbox query per conflict.
  - The conflict term. It covers records stored with a conflict before the counter existed.
  - Where (b) runs. It runs at the first advance, not inside the approval transaction. An fs removal inside a SQLite transaction
    would not survive a crash between commit and removal; the `spawnSeq === 0` test survives it.
- **Criteria.** All are in tests/control/integrationResolve.test.ts and use the fake-runTask world:
  - "final review C1: a conflict after a resolved one is a new attempt -- a new spawn, a new usage row, never the first
    resolution's tree": conflict → approve → resolved → integrated. Then a new landing and a person's commit conflict
    again → approve → one pass ⇒ runTask calls `[integrate-g-1, integrate-g-2]` and main is still the person's commit. After that, collect ⇒
    parents (main2, tip2), the second resolution's tree, and usage rows `[1000, 2000]`.
  - "... a scheme set to keep and back does not number attempts from 1 again (the booked spend counts)".
  - "... a scheme change clears the conflict but not the count -- the next conflict is attempt 2".
  - "... an attempt a failed resolution opened is counted too -- after a scheme change the next is attempt 3".
  - "... a resolution never collects a finished run left in its runs directory before it was approved". Before
    approval it plants a finished `succeeded` loop state and an attempt clone under `reconcile-integrate-g-1/integrate-g-1`.
- **RED** (`$S/ffw/red-c1.txt`, base code):
  - test 1 at :457 shows `conflict.attempt` 1 / key `integrate-g-1`, where attempt 2 was expected.
  - test 2 shows the same at :486.
  - test 3 at :507 shows runTask calls `[]` where `['integrate-g-1']` was expected: the stale state was collected and nothing was spawned.
- **Mutations** (every one red, restore 0/0):

| id | mutation | red at |
|---|---|---|
| MC1-a | nextAttempt = `(conflict?.attempt ?? 0) + 1` (the pre-fix numbering) | integrationResolve.test.ts:504 conflict attempt 1 ≠ 2 |
| MC1-b | drop the booked-outbox term | :533 (keep and back) attempt 1 ≠ 2 |
| MC1-c | drop the `attempts` term | :546 (scheme change) attempt 1 ≠ 2 |
| MC1-d | settle's conflict no longer writes `attempts` | :546 |
| MC1-e | failResolution no longer writes `attempts` | :561 attempt 2 ≠ 3 |
| MC1-f | delete the runs-dir removal (b) | :579 runTask calls `[]` ≠ `['integrate-g-1']` |
| MC1-g | schema reads `attempts` as always 0 | :546 |

### I1: a delivery, target or remote change kept lastIntegrated / integratedCommit
- **Change.** integrationCommands.ts uses the same condition that forgets the PR (renamed `sameDestination`). When it is false,
  the command also sets `lastIntegrated: null, integratedCommit: null`. `pending` was already reset.
- **Criteria** (integrationResolve.test.ts, confirmed world):
  - "final review I1: a new target starts from scratch -- the next squash into it carries the earlier landings too":
    local squash into main, land a.txt, integrate, switch the target to `rel`, land b.txt, one pass ⇒ `rel` holds a.txt and b.txt.
  - "final review I1: a finished group switched to a new target is due at once" (trigger group, complete, no new landing) ⇒
    `rel` holds a.txt.
- **RED** (`$S/ffw/red-i1.txt`): `git show rel:a.txt` failed (:446), and the second test's pass answered false (:462).
- **Mutation** MI1: keep `lastIntegrated`/`integratedCommit`. Both tests go red.

### M-T3: `git status` rewrote the person's index
- **Change.** `git --no-optional-locks status --porcelain --untracked-files=all` (integrationPass.ts, H5).
- **Criterion.** integrationGit.test.ts "H5's cleanliness check does not rewrite the checked-out worktree's index, even
  with its stat cache out of date". It sets the mtime of tracked f.txt back to 2001 and adds an untracked file (so the check blocks and no merge runs).
  The sha256 of `.git/index` must be unchanged.
- **RED** (`$S/ffw/red-t3.txt`): the index sha changed (:230).
- **Mutation** MT3: drop the flag. Red at :270, index sha changed.

### M-T5: criteria only (all green on first run, no code change)
- integrationCrash.test.ts: the "someone commits on the target" `it.each` gains `push-branch` and `github-pr` rows (the re-entry
  "contains" branch). It also gains "%s, crash after-pending, then someone commits on the target: one pass integrates on top of it"
  (local merge, push-target merge), a write-ahead record whose target holds neither `pending.new` nor the tip. Last, "a person-paused group with a
  write-ahead record waits".
- integrationGh.test.ts "final review M-T5: a remote that spells the owner in capitals finds the PR gh answers in lower
  case": the remote is `https://github.com/O/r.git`; gh's login and URL are lower case. The URL was made lower case in 50e9c52, so the URL check's
  case handling is pinned too.
- The comment in integrateGroup that called a write-ahead record "always finished" now reads "always gets its re-entry --
  settled when the target holds its `new`, recomputed on what the target holds otherwise".
- **Mutations:**

| id | mutation | red |
|---|---|---|
| MT5-contains | `remoteHas` answers false unless equal | push-target squash, push-branch, github-pr rows (:192) |
| MT5-neither-local | local re-entry trusts `pending` without looking | :214 parents |
| MT5-neither-pt | push-target re-entry trusts `pending` | :214 |
| MT5-paused | delete the `groupStopped` skip | :228 pass answered true |
| MT5-owner | owner side not lower-cased | integrationGh.test.ts:462 extra `pr create` |

### Minor 2: preflight wrote FETCH_HEAD and the remote-tracking ref
- **Change.** `git ls-remote --quiet --exit-code <remote> refs/heads/<target>`. Exit 2 means `target`; any other non-zero means `remote`.
  `runGit` now also returns `code`.
- **Criterion.** integrationScheme.test.ts "final review Minor 2: asks the remote for the target without writing the
  person's FETCH_HEAD or remote-tracking refs". Another clone has moved the remote's main. The criterion checks that FETCH_HEAD is absent and that `refs/remotes/origin/main` is unchanged.
- **RED** (`$S/ffw/red-m2.txt`): FETCH_HEAD existed (:453).
- **Mutation** MM2: go back to fetch. Red at :468.

### Minor 3: PR URL validated (server and web)
- **Server change** (integrationPr.ts). `prNumberOf(repo, url)` accepts only `https://<host>/<owner>/<name>/pull/<n>`, where
  `host/owner/name` equals the remote's repository case-insensitively.
  - A listed open PR is accepted only when its URL's number equals the PR's own number.
  - A created PR's URL must pass the same check.
  - Anything else is blocked as `integration-pr-refused:gh answered a pull request URL outside <repo>: <url>`.
  - This changes one behaviour: a `pr create` answer with no PR URL used to throw (transient, re-found by `pr list` next time). It is now blocked, as the
    brief says.
  - fakeGh.mjs gains a `createUrl` knob, a fixture addition.
- **Web change** (GitScheme.tsx). It renders a link only for
  `^https://[A-Za-z0-9.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]*$`. Any other URL is plain text.
- **Criteria.**
  - integrationGh.test.ts "final review Minor 3: a listed PR whose URL names %s" covers another host, another repository, a
    script, and a wrong number.
  - integrationGh.test.ts "a created PR whose URL names %s" covers another repository and no pull request.
  - web/tests/integrationScheme.test.tsx "a recorded PR URL that is not a pull request URL is shown as text" covers
    `javascript:`, `/../`, `http:` and `/issues/`.
- **RED:** `$S/ffw/red-m3.txt` (all 6 server rows: record not blocked, or the pass was transient) and
  `$S/ffw/red-web-m34.txt` (4 web rows: an `<a>` was rendered).
- **Mutations:**
  - MM3-list: drop the list check. 4 rows red.
  - MM3-create: number taken from any URL. Red.
  - MM3-case: case-sensitive compare. The owner-case criterion goes red at :464.
  - MM3-web: always link. 4 rows red.

### Minor 4: Resolve hidden for integration-conflict-unreproducible
- **Change.** GitScheme.tsx no longer offers Resolve when `reason` is `integration-conflict-unreproducible`. Retry stays.
- **Criterion.** web/tests/integrationScheme.test.tsx "final review Minor 4: ... offers Retry, not Resolve".
- **RED:** `$S/ffw/red-web-m34.txt` :331, the button existed.
- **Mutation** MM4-web: red at :331.

### Minor 5: `orca/` targets refused
- **Change.** `schemeCheck` returns `target-name` for any target starting with `orca/`, for every delivery. Setters and preflight refuse it as
  `integration-invalid:target-name`.
- **Criteria** (integrationScheme.test.ts):
  - "final review Minor 5: refuses a target in Orca's own orca/ namespace, for every delivery" (`orcax` is still accepted).
  - "... an orca/ target is refused integration-invalid naming the target" (through the service; nothing written).
- **RED** (`$S/ffw/red-m5.txt`): both red.
- **Mutation** MM5: both red.

### Minor 6: GIT_SSH_COMMAND only when the person set none
- **Change** (integrationGit.ts).
  - `childEnv()` no longer sets `GIT_SSH_COMMAND`.
  - `ChildOptions.env` holds variables set over `childEnv()`.
  - `runChild` computes `sshEnv` and passes it as `opts.env`, so the seam sees it. Only a git child whose subcommand is fetch, push or ls-remote gets it:
    - the person's own `process.env.GIT_SSH_COMMAND` is passed through, since `unsetInheritedGitEnv` drops it otherwise;
    - a `core.sshCommand` set in git config means nothing is set;
    - otherwise the child gets `ssh -o BatchMode=yes`.
  - The config is read with `spawnRunChild` directly, so the seam's child counts are unchanged.
- **Criteria** (integrationGit.test.ts):
  - "a remote's git child never prompts over ssh unless the person set their own ssh command, which is then left alone".
    With no setting the child gets BatchMode. With the repository's `core.sshCommand` it gets no `GIT_SSH_COMMAND`. With the env var, the person's value reaches the child.
  - "the runner sets exactly the variables it is handed over its own environment, and no GIT_SSH_COMMAND of its own" uses a
    real `sh` child.
- **RED** (`$S/ffw/red-m6.txt`): the first test at :234 had no env at the seam. The second at :253 shows `ssh -o BatchMode=yes` where `unset` was expected: the runner
  overrode everything.
- **Mutations:**
  - MM6-config: always BatchMode. Red at :240.
  - MM6-env: no pass-through. Red at :246.
  - MM6-runner: `childEnv` sets it again. Red at :253.
  - MM6-opts: the runner ignores `opts.env`. Red at :254.
- **Cost:** one extra short-lived `git config --get core.sshCommand` process per network child, run sequentially before that child. That is +1 process and its 3 pipe fds per network child, for the life of that child only.

### Minor 7: older conflict copies removed when a new attempt materialises
- **Change.** `materialiseIntegrationConflict` removes every `integration-conflict-<g>-<n>` of this group (`copyOwner`;
  `removeOwnPath`, so only own paths) before it clones the new copy.
- **Criterion.** integrationResolve.test.ts "final review Minor 7: a new attempt's conflict removes the group's older
  copies (and only its own)". The stranger copy `integration-conflict-g-x-1` survives.
- **RED** (`$S/ffw/red-m7.txt`): copy 1 still existed (:446).
- **Mutation** MM7: remove only the current attempt's path. Red at :478.

### M-T8: Decisions title/lede by status; loading state
- **Change.**
  - en/zh `decisions.titleReviewed`, `ledeReviewed`, `titleAll`, `ledeAll`, `loading`. Unreviewed keeps today's text.
  - `DecisionsView` takes `loading`.
  - App passes `status !== "unreviewed" && allRows === null`.
- **Criteria** (web/tests/decisionsStatusFilter.test.tsx):
  - "final review M-T8: the title and lede say which decisions are listed, in each status and language" (en and zh).
  - "... until the Reviewed rows arrive the list says it is reading them, not that there are none". The fetch is held open, the criterion checks "Reading decisions…",
    no "No decisions in this status.", then the rows.
- **RED** (`$S/ffw/red-t8.txt`): the heading stayed "Unreviewed high-tier decisions" (:130), and there was no loading text (:151).
- **Mutations:**
  - MT8-title: red at :130.
  - MT8-lede: red at :131.
  - MT8-loading (view): red at :151.
  - MT8-app (`statusLoading` false): red at :151.

### M-T10: magnitude hint out of the label
- **Change.**
  - `TokenInput` takes `label`. It renders `<div class="token-field"><label>{label}<input/></label>{hint or error}</div>`.
    The label wraps the input, so no generated ids are needed; a `useId` version broke budgetSuggestions' render-equality check.
  - The labelled call sites use it: group limit tokens and hand-off threshold (BudgetEditor), both requirement limits
    (RequirementsPanel), and the new spend cap (UsagePanel).
  - The allocation table cells keep their sr-only label. Their inputs are named by `aria-label`, and the reviewer did not name them.
  - styles.css gains `.token-field`.
- **Criteria** (web/tests/tokenInput.test.tsx):
  - "final review M-T10: with a label, the label holds only its text; the hint and the field error sit beside the field".
  - "final review M-T10: the group limit's magnitude hint sits beside its input, outside the label's text".
- **RED** (`$S/ffw/red-t10.txt`): the label was `tokens≈ 9M` (:286), and the `label` prop did not exist (:117).
  budgetI18n was red as well (the rewrite below).
- **Mutations:**
  - MT10: hint back inside the label. Both red.
  - MT10-budget: group limit without the label prop. Red at :286.

### Minor 9: spec §13
`## 13. Corrections recorded at execution (2026-10-08, session eaee0f2c)` is appended at the end of the spec.
It has one bullet for each correction the brief listed (the PR-URL rule and the copies cleanup included). Nothing above §13 was edited. `git show 4595317` shows 40 insertions and no deletions.

## Rewrite inventory (existing assertions changed)

| file / test | before | after | why |
|---|---|---|---|
| tests/control/integrationGh.test.ts "R1: a group integrated under push-branch and switched to github-pr opens its PR at the next pass, with nothing new landed" | after the switch, `lastIntegrated: tip` | `lastIntegrated: null, integratedCommit: null` | I1: a delivery change is a new destination. The rest of the test is unchanged and green: same gh calls, final `lastIntegrated: tip`. As strict (it pins both fields). |
| same file, "R1: a switched group whose integrated work the target already holds is not due -- no push, no gh" | final `lastIntegrated: tip` | `lastIntegrated: null` | I1. The test's point (no push, no gh) is unchanged; what keeps the group from being due is now the target holding the tip. |
| web/tests/budgetI18n.test.tsx "shows the budget editor in Chinese" | `texts("fieldset label")` = `["token约 900 万", …]` | `["token", …]` plus `texts("fieldset small")` = `["约 900 万"]` | M-T10. The old assertion pinned the defect. The new pair is stricter: label and hint are each pinned. |

Fixture addition (no assertion changed): tests/control/fixtures/fakeGh.mjs `createUrl`.

## Test summary (tip 50e9c52 unless noted; outputs in `$S/ffw/`)

- `npm run typecheck`: rc 0 (`v-typecheck.txt`).
- `npm run --ws check`: rc 0 (`v-wscheck.txt`).
- `npm run build --workspace web`: rc 0 (`v-build.txt`). Runs at 4595317; web/ is unchanged since.
- `vitest run tests/control tests/panel tests/entry` (`f-suite.txt`): 2001 passed, 54 skipped, 2 failed:
  - driverRequirementSplit: 5 s timeout.
  - controlShutdown: exit 143.
  - Both are on the known load-flake list. Load at the time (uptime): 5.55 8.57 7.91. Re-run alone (`f-flake.txt`): 14/14 passed.
  - The 54 skipped are the real-ccloop criteria (`ORCA_CCLOOP_BIN` unset).
- With `ORCA_CCLOOP_BIN=$S/ccloop-new/dist/cli.js`, the four files integrationResolve, driverReconcile, executionDriverE2E and usageByModelE2E: 72 passed, 0 skipped (`f-ccloop.txt`).
- Web, all files (`web-all-2.txt`; web/ identical to the tip): 79 files, 618 passed.
- Mutations: 32 of 32 red, restore 0/0 each (`mut-table.txt`).
