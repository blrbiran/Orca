# Final fix report: issue-fixes round, F3 step 2

Fixer: one subagent spawned by controller session 3156185d, 2026-10-09. Branch fix/issues-20261009, base 11027ab.
Scope: the ledger's "F3 final whole-branch review" ruling, which covers M1, M2, M4, M8, A5+A6-1, M7 and E8.
M3, M5 and M6 were not touched.
Scratchpad: `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/3156185d-8cf1-4260-9808-1f8a45883555/scratchpad/orca/F3fix/`
(abbreviated `F3fix/` below).

Status: DONE_WITH_CONCERNS. The concerns are in the last section; none of them blocks.

## Commits

| SHA | Subject | Finding |
|---|---|---|
| 44c37aa | fix(web): offer Archive group only where the server accepts archive-group | M1 |
| 4a4af5a | fix(web): name the real way out in the partial-handoff banner and the archive refusals | M2, M4, M8 |
| 75bb984 | fix(web): show the refusal a lost command's lookup finds in place of the unknown outcome | A5+A6-1 |
| cedae4d | fix(web): say a group card's age in hours past 120 minutes and in days past 48 hours | E8 |
| 8efd7ab | docs: correct the D10 and C4 errata, append-only | M7 |
| 75ec937 | refactor(web): drop archiveOpen's archived check, which its only caller already makes | M1 follow-up |

All of them are pathspec commits. None was amended or pushed. The controller's uncommitted `progress.md` and the
untracked `final-review.md` were not touched.

## What changed

- **M1: Archive is shown only where the server accepts it.**
  - `web/src/runFacts.ts` gains `archiveOpen(view)`. It mirrors `refuseArchive` (src/control/archiveGroup.ts) in the
    same order. It returns false when any of these holds:
    - an estimate is `running` or `start-unknown`;
    - a stop other than a pause is in a state other than `handoff-complete` or `handoff-partial`;
    - the integration is `resolving`;
    - any run is active.
  - "Active" means a displayed state outside {failed-before-provider, settled-recoverable, settled-restartable,
    settled-unrecoverable, settled-failed}. `controlViews.ts runViews` already refuses a view whose `active` flag
    disagrees with that set, so the set is exact.
  - The requirement-call guard has no counterpart because a clarifying group has no group view (App.tsx DR25).
  - `ControlGroupView.tsx` renders the button only when `archiveOpen(view)` is true.
- **M2: the handoff-partial banner names Archive.**
  - en: "A frozen run could not hand off, so the group cannot resume from this stop. Way out: press Archive group under
    Dispatch."
  - zh: "有冻结的运行没能完成交接，这个组无法从这次停止中恢复。出路：点「派发」下的「归档这个组」。"
  - The handoff-unresolved text is unchanged, as the review allowed.
- **M4: archive-run-active names what works under a pause.** The text now adds "If the group is paused, press Resume
  dispatch first: Handoff stop is not offered under a pause." The zh text adds "如果组已暂停，先点「恢复派发」：暂停时不提供「交接停止」。"
- **M8: the raw stop state is out of the sentence.** `{{detail}}` was removed from archive-stop-pending in en and zh.
  - I took the review's "or drop it" option instead of mapping the detail through enumText. The en stopMode and
    stopState enum texts are the raw words (`shutdown`, `handoff-pending`), so mapping would not have given plain
    words in English.
  - The stop banner above the refusal already states the mode and state.
- **A5+A6-1: a refused lost command now shows its refusal.**
  - In `App.tsx resolveUncertain`, a `found` lookup with `originalStatus >= 400` now dispatches
    `refusalFromAnswer({ status: originalStatus, body })` at the command's `place`.
  - That replaces the outcome-unknown notice. For an import, the refusal appears in the import form with the refused
    plan's problem list. A failed import still reads no group.
- **E8: group-card ages use larger units.**
  - Up to 119 minutes the card shows minutes. From 120 minutes it shows whole hours (`updated {{hours}} h ago` /
    `{{hours}} 小时前更新`). From 48 hours it shows whole days (`updated {{days}} days ago` / `{{days}} 天前更新`).
  - It uses two new locale keys, `control.groupCard.updatedHours` and `updatedDays`, in both en and zh.
- **M7: corrections appended to both errata.** Each correction is 13 lines, appended at the end of its file with 0
  deletions (`F3fix/m7-numstat.txt`). Each one says what is inaccurate and what is true.
  - `docs/superpowers/specs/2026-09-25-execution-driver-design.md`: the erratum's commit list omits 585fb72,
    `feat(control): archive and clean a settled-failed run's workspace in the driver loop`.
  - `docs/superpowers/plans/2026-09-25-handoff-delivery.md`: "X or Y" is wrong. Both buttons show when tasks are
    continuable, and only Resume (no continuation) shows when none is (6a88636, `fix(web): offer a plain resume beside
    the batch continuation at handoff-complete`).
  - I verified both subjects on main with `git log --oneline --fixed-strings --grep="<subject>" main` (rc 0, one hit
    each). I also checked the C4 claim against ControlGroupView.tsx: `continueSelected` needs
    `continuable.length > 0`, while `resumeNoContinuation` shows at every handoff-complete.
- **75ec937: removed a dead check.** `archiveOpen` no longer checks `summary.archived`. Its only call site is inside
  `!archived`, so no mutation could turn that check red.

## Tests (TDD)

| Finding | New test(s) | RED before the fix (`F3fix/…`) | GREEN after |
|---|---|---|---|
| M1 | web/tests/archiveGroup.test.tsx: describe "Archive group is offered only where the server accepts archive-group", 5 tests (runs, estimates, stop states, pause, integration) | red-m1m2.txt: 4 failed with "expected true to be false". The pause test passed already, because it pins the exemption. | green-m1m2.txt 22/22 |
| M2 | web/tests/stopBanner.test.tsx "names Archive group as the way out of handoff-partial…" (en and zh, and the button is present) | red-m1m2.txt: failed, the banner still read "press Retry recovery…" | green |
| M4, M8 | web/tests/failureReasons.test.ts: "keeps the server's mode:state detail out of the sentence" (refusalText in en and zh) and "tells a paused group to resume dispatch before Handoff stop" | red-m4m8.txt: 2 failed | green-m4m8.txt 5/5 |
| A5+A6-1 | web/tests/groupRefusal.test.tsx "replaces an unknown import's notice with the refusal its lookup finds, the plan's problems listed" | red-a5.txt: control-plan-rejected never appeared | green-a5.txt 10/10 (with controlCommandRecovery) |
| E8 | web/tests/groupList.test.tsx "says how long ago a group changed in minutes, then hours…, then days…" | red-e8.txt: "updated 120 min ago" | green-e8.txt 6/6 |

Full runs, each read in full:

| Run | Result | Log |
|---|---|---|
| `npm run --workspace web check`, first run | 1 failed / 708: the agentPreviewRefresh 15 s timeout at load 19.02 (the known load flake) | `F3fix/webcheck1.txt` |
| agentPreviewRefresh alone | 13/13 at load 15.2 | `F3fix/flake1.txt` |
| `npm run --workspace web check`, after A5 and E8 | rc 0: 88 files, 711 tests | `F3fix/webcheck2.txt` |
| `npm run typecheck` | rc 0 | `F3fix/typecheck.txt` |
| `npm run build --workspace web` | rc 0 | `F3fix/build.txt` |
| `vitest run tests/panel/refusalCoverage.test.ts tests/panel/webParity.test.ts`, after the build | rc 0: 2 files, 10 tests | `F3fix/panel.txt` |
| 75ec937 (the trim) | archiveGroup and stopBanner 22/22; web tsc rc 0 | `F3fix/m1-trim.txt` |

## Mutations

I made a `git clone --local` of the worktree at 75ec937, after every commit, and linked the worktree's real node_modules
into it. Each mutation was applied, its test file run, and the file restored with `git checkout`. The script is
`F3fix/scripts/mutate.py`, the summary is `F3fix/mutations.txt`, and each mutation's log is under `F3fix/mut/`.

All 17 mutations went RED:
- M1:
  - removing the estimate guard;
  - removing the stop guard;
  - dropping the pause exemption;
  - no longer accepting handoff-partial;
  - removing the integration guard;
  - runs check → `true`;
  - call site → `true`.
- M2: the en text reverted, and the zh text reverted.
- M4: the en sentence removed, and the zh sentence removed.
- M8: `{{detail}}` restored in en, and in zh.
- A5: the new dispatch removed.
- E8:
  - the hours threshold changed from 120 to 121;
  - the days branch disabled;
  - the zh hours key replaced.

I checked the reasons in the logs: each one went red on its own named test with an assertion failure, not a compile
error. The clone was then discarded.

The worktree was untouched by the mutations. `git diff | wc -c` was 3147 before and after; that is only the
controller's uncommitted progress.md, `git diff --stat` shows that file alone, and it was unchanged.
`git diff --cached | wc -c` was 0 before and after.

## Deviations

1. **I rewrote two existing pins that the brief did not name.** Both had to change because of the fixes the ledger
   ordered.
   - `web/tests/archiveGroup.test.tsx` "offers no editor or action anywhere on an archived group": its non-vacuity
     baseline went from `toBeGreaterThan(10)` to `toBeGreaterThanOrEqual(10)`. Its fixture has a terminally failed
     blocked run, which is active, so M1 correctly removes Archive group from the not-archived count. The count is now
     exactly 10. What the test pins is unchanged: an archived group leaves only Unarchive.
   - `web/tests/failureReasons.test.ts`, W1's archive-stop-pending pin: the two `toContain("{{detail}}")` lines were
     removed, because M8 removes that placeholder on purpose. The new M8 test pins the opposite. The W1 assertions on
     the recovery clause remain.
   - Cost if wrong: two pins to re-review.
2. **M8 drops the detail instead of mapping it,** for the reason given under "What changed".

## Concerns

- **The A5 fix covers the place-based notice only.** A requirement verb whose answer was lost keeps
  `setRequirementRefusal` from the uncertain answer. `UncertainCommand` does not record that it was a requirement verb,
  so `resolveUncertain` cannot route a found refusal there. It goes to the group place, as the existing `absent` path
  already does. This is outside the finding's import case.
- **Archive is hidden for a paused group with a blocked failed run.** Under a pause the panel then shows Resume dispatch,
  and the M4 text explains why. Resuming re-enables claims for the group's other tasks before Handoff stop is pressed.
  That is the panel's existing behaviour, not something new here.
