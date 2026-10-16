# Final whole-branch review: fix report

Who: fix implementer, session 4de777f4 (Claude Opus 5.5). When: 2026-10-17. Base: 13d5792b. Fix commit: 756d3d28.

## What changed

**I1. Model text could make the settlement throw.**
- `src/control/estimateRepair.ts`: new `modelText(value, max = 200)`. It turns each lone surrogate into U+FFFD and cuts only at a code-point boundary (`Array.from`), keeping **at most `max` UTF-16 units**.
  - Why UTF-16 units and not a code-point count: `queries.ts:248` stores the record's `origin.problems` as `z.string().max(200)`, and zod's `.max` counts `.length`, which is UTF-16 units. If the cap were 200 *code points*, a problem made of astral characters would be longer than 200 units, the record would fail to decode, and `estimateExecutionContractSchema.parse` would throw inside `writeEstimateRetry`. Cutting at code points while bounding units meets both needs: no surrogate pair is split, and nothing goes over 200 units. Rule 1 ladder, step 2: this is reversible, so I decided it myself.
- `modelText` is applied to every model-derived piece of text:
  - unknown task ids in `unknown-task-dropped:<id>` (deduplicated after cleaning, since two ids can clean to the same string);
  - every zod path segment through `pathText` (used by `issuePaths` for `field-invalid:` / `task-invalid:`, and by `problemsFromRefusal`);
  - the zod message in `problemsFromRefusal`.
- `capProblems` now uses `modelText`, so it never splits a surrogate pair.

**M2.** `src/control/webProtocol.ts`: the contract's `retryProblems` entries are now `nonemptyString.max(200)`.
- The second `origin.problems` schema in `webProtocol.ts` (~:1339) has no `.max(200)`. I left it alone because the brief named only ~:422.

**M4.** `src/control/estimateRetry.ts`: `retryPromptFits` now wraps `estimateTaskIds(request)` in try/catch. If the plan snapshot is unreadable, the function returns false, and the decision skips with `input-too-large`.

## Criteria added

- `tests/control/estimateRepair.test.ts`:
  - `capProblems never splits a surrogate pair…`
  - the four tests under `model-controlled text in repair and problem codes stays canonical`. They cover: a lone-surrogate unknown id becomes `unknown-task-dropped:�`; a long id is cut at a code point; shape (b), a key of 185 × `x` plus an emoji, gives `field-invalid:` + 185 × `x`; lone-surrogate keys at the top level and inside a task entry.
- `tests/control/estimateRetry.test.ts`:
  - Shape (a), settled directly: the answer settles `ready` with `repairs: ["unknown-task-dropped:�"]`, and the run is `settled-restartable`. I used `settleDirect` because the harness's fake ccloop encodes its answer with `canonicalBytes`, which a lone surrogate cannot pass. The fixture is the limit here, not production.
  - Shape (b), through the driver: the estimate settles `failed`, the retry is queued, and both `origin.problems` and the contract's `retryProblems` equal `[field-invalid:xxx…]`.
  - M4: the snapshots `{`, `{}` and `null` each make `retryPromptFits` return false and the decision skip with `input-too-large`.
  - M2: the contract accepts a 200-character entry and rejects a 201-character one. This was added to the existing "caps the problems" test.

## TDD evidence

RED, before the fix: `vitest run tests/control/estimateRepair.test.ts tests/control/estimateRetry.test.ts` exited 1 with 8 failed / 43 passed.
- The repair tests received a lone `\ud800` / `\ud83d` in the codes.
- Both settlement tests failed with `the driver did not get there: run "blocked" "control-non-canonical-json", estimate running`. This reproduces the reported bug.
- M4 threw `SyntaxError … at estimateTaskIds`.

Shape (a) was then moved to `settleDirect`. MUT-helper below shows it red against the unfixed behavior.

GREEN, after the fix: the same command exited 0 with 51/51 passing.

## Mutations

Each mutation ran in a `git clone --local` of 756d3d28 at `/private/tmp/orca-mut-final-34490`, with `node_modules` symlinked. Restore was `git checkout -- <file>`. Restore proof after every mutation: `git diff` 0 bytes and `git diff --cached` 0 bytes.

| Mutation | Change | Result |
|---|---|---|
| MUT-helper | `modelText` returns its input unchanged | RED, 8 tests: 6 repair tests (including the existing 300-char cap test) and both settlement tests |
| MUT-contract-max | drop `.max(200)` on `retryProblems` | RED: "caps the problems a retry carries…" |
| MUT-taskids-guard | remove the try/catch around `estimateTaskIds` | RED: the M4 test |
| MUT-step5-code | delete the `unknown-task-dropped` push | RED: `unknown-task-dropped`, both id tests, settlement shape (a) |
| MUT-step5-filter | `known = normalized` (the unknown-id filter removed) | **GREEN: equivalent mutant** |
| MUT-step7 | delete the `tasks-reordered` push | RED: `tasks-reordered` |
| MUT-toplevel | delete the top-level shell check | RED: "a bad top-level field and an extra key are field-invalid", shape (b) unit, lone-surrogate key unit, settlement shape (b) |

**Why MUT-step5-filter is equivalent.** Step 6 only looks up entries by the plan's own ids (`known.filter(e => e.taskId === id)` for each `id` of `ctx.taskIds`). Step 7's `arrivalOrder` keeps only entries that are in `kept`. So an unknown entry left inside `known` can never reach the output or change any code. The filter is redundant code, and no criterion can turn it red. The behavior of step 5 is that the entry is dropped and reported: the report is pinned by MUT-step5-code, and the drop by the `unknown-task-dropped` test's `output: answer(["a"])`. I left the code as it is (Rule 3).

## Verification

Command, run with `ORCA_CCLOOP_BIN=/private/tmp/ccb6-qswQ/ccloop/dist/cli.js` and `CCLOOP_CACHE_DIR=$(mktemp -d /private/tmp/cc-t-XXXX)`:

`ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run` on estimateRepair, estimateRepairSettle, estimateRetry, estimatePromptV2, estimatePrompt, driverEstimate, estimateOutcome, estimateE2E and estimateRecordFields.

- At 756d3d28: exit 0, 9 files, **94/94 passed**.
- `npm run typecheck`: exit 0.
- The run printed one stderr line: `orca-driver: run-…: control-store-closed; recording it failed: database is not open`. It also appears at base 13d5792b, which passed 86/86 in the clone. It is not from this change.

## Concerns

- `estimate.repairs` has no length or count cap in either schema. Each code is now bounded to about 220 units, but the number of codes is not bounded. That was outside this fix.
- The `origin.problems` schema in `webProtocol.ts` (~:1339) has no `.max(200)`. This is harmless, because writes go through the `queries.ts` cap.
