# Task 12 report — a single call's output overrun, at read time (spec §6.2; criterion 5)

Implementer: Orca session a852f96a (subagent), 2026-10-16. Worktree /Users/biran/code/skills/orca/Orca-wt/every-agent-chain,
branch codex/every-agent-chain, base 8b6b4fc9 -> commit **ce956d09** `feat(control): show a single call's output overrun beside its booked usage`.
LOGS = /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs

Status: DONE

## What was done
- `src/control/webProtocol.ts` `runViewSchema`: `outputBound`, `outputBoundExceededBy` (positiveSafeInteger, optional), before `createdOrdinal`.
- `src/panel/controlViews.ts`: `outputBoundView` (brief's code verbatim) above `runViews`, spread after `createdOrdinal`; imports `readEstimateContract`.
  Bound = estimate contract's `maxOutputTokens` (estimate runs) or the requirement's frozen `maxOutputTokens` (single-call runs); both are the bound actually
  sent (`singleCallOutputBound(...)` at estimator.ts:116 and requirementCommands.ts:98). Overrun only when sum(byModel[].output) > bound. No storage schema change.
- Web: `web/src/RunOutputBound.tsx` (brief's code), `RunViewV1` gains the two fields, en/zh `control.outputBound.exceeded` (brief's exact strings).
- **Ruling applied (render wherever single-call runs are listed):** the only places a run row for an estimate/requirement single-call run is rendered are in
  `web/src/ControlGroupView.tsx`: the problem-runs list (:404) and the runs table (:440, the `run-state` cell). Rendered in both. Other run listings
  (TaskDetail :224/:272, work-items table :361, GitScheme, SkillsGiven, TaskResults) filter to task runs (`taskId === item.taskId` / `taskId !== null`), so
  never show single-call runs; RequirementsPanel renders no runs (a clarifying group's single-call runs appear in the group view after accept).
- Wording rule: the sentence says the agent "cannot cap a call's output" and the call "went N tokens over its declared bound"; it never calls the call bounded or capped.

## Criteria
- `tests/control/singleCallOutputBound.test.ts`: brief's two tests (over 64_100 -> `outputBound 64000, outputBoundExceededBy 100, used 64_200`; at 64_000 and
  under 10 -> bound present, no overrun field) plus a third, "a requirement's single call carries the requirement's bound" (requirementHarness split call,
  accepted into a plan group, `readControlGroup` -> `[[64000, false]]`) which pins the `single-call` branch (plan issue 11). ESTIMATE_GRANT.tokens = 250_000 > 64_200, so no
  profile change was needed; the arithmetic is in the file's comment.
- `web/tests/runOutputBound.test.tsx`: whole English sentence, whole Chinese sentence after `changeLanguage("zh")`; nothing rendered without the overrun;
  **a COMPLETED (`settled-restartable`, no failure) over-bound estimate run shows the line in its runs-table row, not in a sibling within-bound row, and is not in the
  problem list**; a blocked over-bound run shows it in the problem list.

## RED / GREEN
- RED control: `t12-red-control.log` RC=1, all 3 failed on the missing fields (`outputBound` undefined; `used.tokens` 64200 already matched).
- RED web: `t12-red-web.log` RC=1, suite failed: `Failed to resolve import "../src/RunOutputBound.js"` (component absent). The per-render-site reds are shown by M12.5/M12.6 below.
- GREEN: `t12-green-control.log` RC=0 3/3; `t12-green-web.log` RC=0 4/4; verbose names listed passed in `t12-mut-base-ctl.log`, `t12-mut-base-web.log`.
- Typecheck: `t12-tsc-root.log` RC=0, `t12-tsc-web.log` RC=0. Web build `t12-webbuild.log` RC=0 (before the full run).
- Full root suite (with web built, `ORCA_CCLOOP_BIN=/private/tmp/ccb2-TBiQ/repo/dist/cli.js`, run concurrently with the mutation clone): `t12-full.log`/`t12-full.json`
  RC=1, 3838 passed, 7 failed, 36 skipped. 5 failures were 5000ms timeouts (driverRequirementSplit, retryTask x2, settleUnknownUsage x2); re-run alone
  (`t12-rerun.log`) all three files green (59 passed). The other 2 are `taskResultPaired.test.ts` at `expect([fixed, feature]).toContain(realBinary)` — the known
  environment red (Task 10/11 reports; it hard-codes two other ccloop build paths), independent of this change. This includes tests/metrics and
  tests/panel/scanPanelText.test.ts (green).
- Full web suite: `t12-web-full.log` RC=0, 1129 passed.

## Mutations (clone /private/tmp/mut-HdqR/repo, node_modules symlinks removed; uncommitted files copied in)
| # | Mutation | sha256 before -> after | Red in named test |
|---|---|---|---|
| M12.1 | `output > bound` -> `output >= bound` | 60d381c2… -> ea6a9381… | yes, "at the bound and under it" (the view is refused: `outputBoundExceededBy` 0 fails positiveSafeInteger) — `t12-mut-M12.1.log` |
| M12.2 | return -> `return { outputBound: bound };` | 60d381c2… -> 46f898ee… | yes, "over the bound" — `t12-mut-M12.2.log` |
| M12.3 | `.find(... "work" ...)` -> `.find(() => false)` | 60d381c2… -> c8e5e507… | yes, "over the bound" — `t12-mut-M12.3.log` |
| M12.4 | zh entry -> the English sentence | 66c7c914… -> 2b4c5fa7… | yes, "in English and in Chinese" (zh assertion) — `t12-mut-M12.4.log` |
| M12.5 (added, ruling) | drop the runs-table `<RunOutputBound>` | 355def28… -> 4c8b1cf6… | yes, "completed call's row in the runs table" — `t12-mut-M12.5.log` |
| M12.6 (added, ruling) | drop the problem-list `<RunOutputBound>` | 355def28… -> 489cf7d3… | yes, "problem-runs list too" — `t12-mut-M12.6.log` |
| M12.7 (added, issue 11) | `phase !== "estimate" && phase !== "single-call"` -> `phase !== "estimate"` | 60d381c2… -> 6a5e70c9… | yes, "a requirement's single call" — `t12-mut-M12.7.log` |

Full sha lines: `t12-mut-sha.txt` (no MISMATCH line after any restore). Final green after all restores: `t12-mut-final-ctl.log`, `t12-mut-final-web.log` RC=0.
Restore proof: clone `git diff`+`git diff --cached` = 11738 bytes, worktree's own uncommitted diff at the time = 11738 bytes, `cmp` RC=0 (`t12-mut-bytes.txt`).
pgrep for fake-omp/fake-codex/worker.js before and after: nothing (`pgrep-t12-before.txt`, `pgrep-t12-after.txt`).

## Files changed
src/control/webProtocol.ts, src/panel/controlViews.ts, tests/control/fixtures/estimateHarness.ts (fixture), tests/control/singleCallOutputBound.test.ts (new),
web/src/RunOutputBound.tsx (new), web/src/controlTypes.ts, web/src/ControlGroupView.tsx, web/src/locales/en.ts, web/src/locales/zh.ts, web/tests/runOutputBound.test.tsx (new).

## Fixture change for the human (handoff §6.9)
- `tests/control/fixtures/estimateHarness.ts`: `SingleCallOptions.byModel?` and the usage event spreads it when given. Absent -> the event is byte-for-byte as before.
  `requirementHarness.ts` was NOT changed (the requirement criterion uses an event without byModel).

## Rewritten criteria
None. No existing criterion went red because of this change.

## Self-review
- Diff read in full before commit. Brief code used verbatim; only additions are the second render site (ruling), the requirement criterion and mutations M12.5-M12.7.
- `outputBoundView`'s `catch { return {}; }` (brief's code) is silent: an estimate run whose contract cannot be read loses the two optional fields rather than failing the view. Kept as specified; noted below.
- Cost: one extra `usage_events` SELECT per estimate/single-call run per group read (task runs untouched).

## Concerns
1. The brief's `catch { return {}; }` swallows any error reading the bound (Rule 12 "fail loud"). Such a run is checked elsewhere in `runViews` (estimate identity, requirement identity), so in practice the read already fails before this; flagged for the reviewer, not changed.
2. `<small role="note">` picks up the neutral role=note box style (styles.css:155), no data-tone — consistent with DESIGN.md ("note" neutral; the result is used as normal). Visual not checked in a browser.
3. Clone /private/tmp/mut-HdqR/repo left in place for the human to remove.

---

## Fix report, round 1 (Orca session a852f96a subagent, 2026-10-16), commit **36e00586** on ce956d09
`fix(control): refuse an unreadable estimate contract; newest usage event decides the overrun`

Changes:
1. `src/panel/controlViews.ts` `outputBoundView`: the silent `catch { return {}; }` is gone. On the estimate branch a failed `readEstimateContract`
   (missing outbox row, canonical read failure, zod parse) now becomes `blocked(\`run-estimate-contract:${runId}\`)`, i.e. `recovery-blocked`, as the sibling
   identity checks do. A catch is still needed to turn the error into that code, but it now refuses instead of omitting the field. The requirement branch has no catch.
2. Same function: `.find(candidate.bucket === "work")` takes the newest work event. If that event's `byModel` is null or absent, output = 0, so there is no overrun. An older event is never used.
3. `web/src/RunOutputBound.tsx`: `tokens: formatTokens(n, currentLanguage())`. The web criterion now uses 12_345 and expects "12,345" in both the en and zh sentences.
4. `RunOutputBound` renders `<p role="note">` with no data-tone. In the problem-runs list it moved out of the run's `<p>` line into the row's `<div>`. The runs-table site is unchanged and sits inside the `<td>`.

New criteria:
- control "the newest work event decides: a later event without byModel shows no overrun". The test inserts a seq-2 work event with `byModel: null`
  directly into usage_events, the table the view reads, and expects `[64000, false]`.
- control "an estimate run whose contract is missing refuses the group read". The test deletes the outbox row `estimate-contract:g:<estimateId>` and expects
  `[code, detail]` = `["recovery-blocked", "run-estimate-contract:<runId>"]`.
- web problem-list test: the note is a `P`, its parent is the problem row `<div>` (not nested in a `<p>`), and it has no data-tone.

Tests (covering files only, per the coordinator). Run in the worktree: `t12f1-ctl.log` RC=0 5/5, `t12f1-web.log` RC=0 4/4 (before the block-note
assertion was added). Clone baseline with every assertion: `t12f1-mut-base-ctl.log` 5/5, `t12f1-mut-base-web.log` 4/4. Typecheck: `t12f1-tsc-root.log` and `t12f1-tsc-web.log` both RC=0.

Mutations (clone /private/tmp/mut-f9qy/repo, node_modules symlinks removed). Each one is red in its named test, and green again after restore (`t12f1-mut-final-*.log`):
| # | Mutation | sha256 | Red |
|---|---|---|---|
| F1 | blocked catch -> `catch { return {}; }` (restore the old catch) | 4bba18c6… -> d927184f… | "contract is missing" (received null) |
| F2 | find -> `bucket === "work" && Array.isArray(candidate.byModel)` (old fallback) | 4bba18c6… -> dc9836e2… | "newest work event decides" ([64000, true]) |
| F3 | drop formatTokens (raw n) | 32fd4790… -> 9f4aab59… | sentence test ("12345" vs "12,345"), plus both row tests |
| F4a | `<p role="note">` -> `<small role="note">` | 32fd4790… -> 9439b0cc… -> 8b5e1bbd… | problem-list test (['SMALL', …]) |
| F4b | note back inside the problem line's `<p>` | 1f59d37e… -> 355def28… | problem-list test (parent ≠ row; React also warns about `<p>` in `<p>`) |

Restore proof: clone diff = 11681 bytes, worktree diff = 11681 bytes, `cmp` RC=0 (`t12f1-mut-bytes.txt`). No MISMATCH line in `t12f1-mut-sha.txt`.
Not separately killable: `currentLanguage()` -> `"en"`. `Intl` formats 12,345 the same way for en-US and zh-CN, so no criterion can tell the two apart.
Full suites were not re-run, per the instruction.
