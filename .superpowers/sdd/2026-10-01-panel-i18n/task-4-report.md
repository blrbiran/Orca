# Task 4 report: metrics sentence codes and the metrics area

Implementer: subagent of session e604b1ba, 2026-10-01. BASE bd6ccfc. HEAD was d812323 when committing: a controller
checkpoint commit (`.orca/checkpoints/orca-dev-e604b1ba.json` only) had landed on top of bd6ccfc during the task. It touches
none of this task's files.

Status: DONE_WITH_CONCERNS (one deviation from the brief's verbatim criterion, below).

## Commit

- `4977c10` feat(metrics): give each metrics sentence a stable code the panel can translate. The trailer was read back
  with `/usr/bin/git log -1 --format=%B > $SCRATCH/t4-commit-msg.txt` and ends with the two required lines.

## What was built

- `src/metrics/types.ts`: `MetricsNoteCode`; `CorrectionRate.caveatCodes`, `RepairRate.caveatCodes`,
  `RepairRate.stale_only.knownBiasCode`, `ReviewCoverage.reasonCode`.
- `src/metrics/compute.ts`: fills the codes index for index with the sentences. `unresolved-decisions` is added only when
  the unresolved caveat is added.
- `src/panel/coverage.ts`: `PanelCoverage.caveatCode: "reviewed-is-deliberate"`.
- `web/src/types.ts`: the mirror, with the fields optional and a comment on each.
- `web/src/locales/en.ts` and `zh.ts`: the `metrics` area (10 keys plus 4 `note` keys). The English notes use
  `satisfies Record<MetricsNoteCode | "reviewed-is-deliberate", string>`.
- `web/src/MetricsView.tsx`: headings, counts and the unknown rate go through `t`. `noteText` shows the note for a known
  code and otherwise shows the server's sentence. `UNKNOWN_RATE` stays exported and is `en.metrics.unknownRate`.
- H18 rewrites:
  - `tests/fixtures/metrics/golden.json` gets its 4 insertions, applied bottom-up (P18). `git diff` shows only those
    insertions plus the two trailing commas.
  - `tests/panel/webParity.test.ts` rewrites `reportWebToServer` and `coverageWebToServer` as named. Each carries a
    comment line starting "Rewritten under human ruling H18 (2026-10-01) for panel i18n".
- New criteria: `tests/metrics/noteCodes.test.ts` (verbatim from the brief) and `web/tests/metricsNotes.test.tsx`
  (strengthened, see Deviations).

## Runs (all in $SCRATCH = /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad)

| Step | Command | File | Result |
|---|---|---|---|
| Red, root | `./node_modules/.bin/vitest run tests/metrics/noteCodes.test.ts` | t4-red-root.txt | rc=1: suite fails to load, `en.metrics` undefined |
| Red, web | `(cd web && ../node_modules/.bin/vitest run tests/metricsNotes.test.tsx)` | t4-red-web.txt | rc=1: both tests fail, `Cannot read properties of undefined (reading 'note')` |
| Green, root | brief Step 4 vitest list | t4-green-root2.txt | rc=0, 13 files / 94 tests |
| Root typecheck | `npm run typecheck` | t4-tsc2.txt | rc=0 |
| Web check | `npm run check --workspace web` | t4-web-check2.txt | rc=0, 45 files / 265 tests. `metricsView.test.tsx` is unmodified and green |
| Extra | `./node_modules/.bin/vitest run tests/level/hookGolden.test.ts` (it references a golden) | t4-hookgolden.txt | rc=0, 6 tests |

The web red differs from the brief's prediction. The brief expected a load failure on the type import, but vitest erases
type imports, so the tests loaded and failed at runtime on `en.metrics`. It is still red for the right reason: the
resources are missing.

## Mutations

Clone: `$SCRATCH/mut-t4` (`git clone --local`). The copy of all 11 task files gave an empty `t4-copy.txt`. The driver
script is `$SCRATCH/t4-mut.py`. It makes each edit, runs the named criterion into `t4-<MT>.txt`, then restores with a
copy plus `cmp` into `t4-<MT>-restore.txt`. Every restore file is 0 bytes with rc=0. After all mutations, the clone's 11
files `cmp`-equal the repo (`t4-clone-final-cmp.txt`, 0 bytes).

| Id | Edit | rc | Red test (seen in file) |
|---|---|---|---|
| MT4-1 | delete `correctionCaveatCodes.push("unresolved-decisions");` | 1 | noteCodes > puts a code beside each sentence… |
| MT4-2 | `knownBiasCode: "stale-bias"` → `"no-review-coverage"` | 1 | same |
| MT4-3 | en `stale-bias` note loses its last char | 1 | same (`stale-bias:` message) |
| MT4-4 | delete coverage `caveatCode` (return and interface line) | 1 | noteCodes > gives the coverage caveat its code… |
| MT4-5 | `noteText` → `return sentence;` | 1 | metricsNotes > …in Chinese… (and English) |
| MT4-6 | `noteText` without `exists` guard | 1 | same (`metrics.note.a-code-…` rendered) |
| MT4-7 | `caveatCodes?.[index]` → `?.[0]` | 1 | same |
| MT4-8 | `t("metrics.correctionRate")` heading → literal "Correction rate" | 1 after the strengthening (was **0** with the brief's criterion) | metricsNotes > …in Chinese… (h2 list) |
| MT4-9 (extra) | unresolved guard → `if (true)` | 1 | noteCodes > gives no unresolved code when nothing is unresolved |
| MT4-10..14 (P16) | each other `h2` `t(...)` → its English literal | 1 each | metricsNotes > …in Chinese… (h2 list) |
| MT4-15..17 (P16) | each count `t(..., { n })` → the old English JSX | 1 each | same (testid text) |
| MT4-18 (P16) | `formatRate` null branch → `UNKNOWN_RATE` | 1 | same (`correction-rate` text is `unknown`, expected `未知`) |

All ten new `t` sites in MetricsView are covered by a deletion mutation that was seen red. None are left unlisted.

Evidence note: I read the full outputs of MT4-5/6/7 from the first round (before the test was strengthened). After
their re-run against the strengthened test, I read only the first 8 lines of each (the rc and the failing-test lines,
`t4-mut-all3.txt`). The full files `t4-MT4-5/6/7.txt` are kept.

## Deviations

1. **`web/tests/metricsNotes.test.tsx` was strengthened (Rule 9).** The brief's `expect(text).toContain("纠正率")` cannot
   go red. The Chinese `no-review-coverage` note itself contains "纠正率" ("…规定纠正率绝不能单独解读"). MT4-8 was
   measured green (rc=0, `t4-MT4-8.txt` in the first round). I replaced that line with exact checks:
   - the six `h2` texts, taken from `zh.metrics.*`;
   - `correction-rate` equals `zh.metrics.unknownRate`;
   - the three count testids equal the literal Chinese strings, which also pins the `{{n}}` interpolation.

   Everything else in the file is verbatim from the brief.
2. **`coverageWebToServer`** gets its own one-line H18 comment, as Global Constraints requires, since the brief gives the
   comment only above `reportWebToServer`.

## Concerns

- The brief's criterion shape (`toContain` on a word that also occurs inside a translated note) is the same trap as P3
  and P4. Later tasks that assert a Chinese heading via `textContent` should check for this.
- The mutation clone `$SCRATCH/mut-t4` is kept (deleting it needs the human).

## Fix round 1 (review task-4-review.md, Important 1)

Implementer subagent of session e604b1ba, 2026-10-01, on top of 4977c10. Only `web/tests/metricsNotes.test.tsx` changed; no production code changed.

- **Fixture:** the repair caveats are now `["the server's repair sentence beside the known code", "the server's repair sentence, no code"]` with `caveatCodes: ["no-review-coverage"]`. The first caveat has a known code. The second is past the end of the codes array, so it has no code, and the repair index is exercised.
- **Chinese test:** now asserts the exact text of `review-coverage-reason`, which must be `zh.metrics.note["no-review-coverage"]`. It also asserts the `li` list of `repair-rate-caveats`, which must be `[zh.metrics.note["no-review-coverage"], "the server's repair sentence, no code"]`.
- **Mutations** (run in `$SCRATCH/mut-t4`, criterion `(cd web && ../node_modules/.bin/vitest run tests/metricsNotes.test.tsx tests/metricsView.test.tsx)`):
  - Before the mutations, the updated test file was copied into the clone and `cmp`ed. `t4f1-recopy.txt` is 0 bytes.
  - MT4-F1A: the review-coverage reason `noteText(...)` becomes `{report.review_coverage.reason}`. rc=1, and the Chinese test fails with `expected 'the server's reason sentence' to be '评审覆盖率没有数据…'`. Output is in `t4-MT4-F1A.txt`, read whole. The restore file `t4-MT4-F1A-restore.txt` is 0 bytes (rc=0).
  - MT4-F1B: the repair caveat `noteText(...)` becomes `{caveat}`. rc=1, and the Chinese test fails on the `li` list (it received "the server's repair sentence beside the known code"). Output is in `t4-MT4-F1B.txt`, read whole. The restore file `t4-MT4-F1B-restore.txt` is 0 bytes (rc=0).
- **Green runs** (all in `$SCRATCH`):
  - `t4f1-web-two.txt`: the two metrics test files, rc=0, 7/7.
  - `t4f1-web-check.txt`: `npm run check --workspace web`, rc=0, 45 files and 265 tests.
  - `t4f1-tsc.txt`: `npm run typecheck`, rc=0.
  - `t4f1-root-notes.txt`: `tests/metrics/noteCodes.test.ts`, rc=0, 3/3.
- **Minor 1 (Rule 14 gap) is closed:** `t4-MT4-5.txt` and `t4-MT4-7.txt` from the re-run against the strengthened test are now read whole. Both have rc=1, and the Chinese and English tests are red for the stated reasons.
- **Minor 2 and 3:** no action. Both match the brief, or predate this task, and the reviewer asked for nothing.
