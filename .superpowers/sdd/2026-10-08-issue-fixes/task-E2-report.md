# Task E2 report (implementer E2, session e34dc963, 2026-10-09)

Status: DONE. Commit f6db4fd `feat(control): summarise goal, branch, counts, updatedAt and archived, and send each work item's category` (pathspec commit; parent 9f137ff).

## Implemented
- `src/control/archivedMark.ts` (new leaf): `archivedMarkSchema`, `archivedMarkOf(body)` (invalid mark -> ControlError recovery-blocked `group-archived-invalid`), `isGroupArchived(store, groupId)` — as briefed.
- `src/control/webProtocol.ts`: groupSummarySchema gains optional `goal`, `branch`, `counts` (strict five categories), `updatedAt` (nullable), `archived`; workItemViewSchema gains optional `category: z.enum(WORK_ITEM_CATEGORIES)`.
- `src/panel/controlViews.ts`: one `categoryOf(store, groupId, work)` serves both the summary counts (inside `taskCompletion`, which now returns `{ completion, counts }`) and the view (`category:` in `workViews`). `currentRunBlocked` is true ONLY when the current run's stored state is `blocked`. `readGroupSummary` adds goal (plan goal, or clarifying idea), branch (`workBranchRef` minus `refs/heads/`), `updatedAt = latestGroupActivityAt` (Part B name), `archived = archivedMarkOf(body) !== null`.
- `web/src/controlTypes.ts`: `GroupSummaryV1` + `WorkItemViewV1` optional fields; `WEB_WORK_ITEM_CATEGORIES`, `WorkItemCategoryV1`.
- Tests: `tests/panel/groupSummaryFields.test.ts` (new, 5 tests); `tests/panel/webParity.test.ts` + parity case for the category list.

## Coordinator note (E1 review) — addressed
Added test "counts a retried task, whose current run is settled-failed, as idle and not blocked": stores the run as retryTask.ts does (state `settled-failed`, active=0; work item `ready`, currentRunId unchanged) and asserts counts `{ idle: 2, running: 1, waiting: 1, blocked: 0, done: 1 }` and view categories a idle / b waiting (depends on a, not done). The code needed no change (it already compared `state === "blocked"`).

## TDD
- RED: `vitest run tests/panel/groupSummaryFields.test.ts tests/panel/webParity.test.ts > E2/e2-red.txt` rc=1 — counts undefined, categories undefined, archived undefined, clarifying fields missing, `WEB_WORK_ITEM_CATEGORIES is not iterable`.
- GREEN: same command rc=0 (9/9); with the retried-task test, groupSummaryFields 5/5 rc=0.

## Verification (outputs under scratchpad/orca/E2/)
- `npm run build --workspace web` rc=0.
- `vitest run tests/panel tests/control/webProtocol.test.ts tests/control/requirementAccept.test.ts tests/control/workItemCategory.test.ts`: first run rc=0 (e2-wide.txt); after the typecheck fix rc=1 (e2-wide2.txt), 531/532, the 1 red being controlShutdown "a real SIGTERM… exit cleanly" (exit 143 instead of 0) at load 21.65; re-run alone 3x rc=0 (e2-shutdown-{1,2,3}.txt, load 17.4) -> load flake (SIGTERM timing, no summary code involved).
- `npm run typecheck` rc=0 (e2-tc2.txt).
- `npm run --workspace web check`: tsc ok, 648/649; the red was agentPreviewRefresh "re-reads a preview… five times" 15 s timeout at load 21 (registered load flake); alone rc=0 13/13 (e2-apr.txt).

## Mutations (git clone --local after the commit; clone removed; worktree `diff --cached` 0 bytes before and after; the worktree's unstaged diff (12015 bytes) is D7's executionDriver.ts/retryTask.test.ts, unchanged before and after)
- (a) `currentRunBlocked: false` -> "counts each task…" and "sends each work item's category…" red.
- (a2) `currentRunBlocked = runRow !== undefined` -> those two + the retried-task test red.
- (a3) treat `settled-failed` as blocked too -> ONLY the retried-task test red (pins the coordinator note).
- (b1) delete goal line -> "counts each task…" + clarifying test red. (b2) goal = `archived!.plan.goal` -> clarifying test red.
- (c) delete updatedAt -> "counts each task…" + clarifying red.
- (d) `archived: false` -> "reports archived…" red.
- (e) delete `category:` -> view test + retried-task red.
- (f) invalid mark returns null instead of throwing -> "reports archived…" red.

## Deviations
1. `latestGroupActivityAt` is added to the existing `import { readGroupActivity, readRunActivity } from "../control/activity.js"` line rather than a second import of the same module.
2. The brief's `JSON.parse(...) as typeof work` failed typecheck (TS2339: `work` narrowed to `null`, so `typeof work` is `null`); replaced with a local `type StoredWork` alias. Same behaviour.
3. Extra test from the coordinator's binding note (retried task).

## Self-review / concerns
- `categoryOf` runs one runs query + one query per dependency per task (N+1 on summary lists); acceptable at current plan sizes, same pattern as taskCompletion.
- In the view, `categoryOf` can throw `recovery-blocked work-item-category:<status>` for an unknown stored status; workViews' schema parse already refuses unknown statuses earlier, so this is unreachable there; in the summary it is swallowed (item in no count), per the brief.
- Did not touch D7's files (executionDriver.ts, retryTask.test.ts).
