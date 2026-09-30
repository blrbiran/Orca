# Task 5 report: the decisions area

Implementer subagent of session e604b1ba, 2026-10-01. BASE 8bbc437, local `main`, never pushed.

## Status

DONE

## Commits

- `1d036e2` feat(web): translate the decisions area. Message read back with `/usr/bin/git log -1 --format=%B > $SCRATCH/t5-commit-msg.txt`, and the two trailer lines are exact.

## Built

- `web/src/locales/en.ts`: the `decisions` area (27 keys, `kindHelp` nested) and the enum families `decisionKind`, `decisionScope`, `decisionVerdict`, `correctionKind`, typed with `satisfies Record<…>` over the `types.ts` unions. The `../types.js` import is merged. English values are byte-identical to the literals they replace.
- `web/src/locales/zh.ts`: the same keys, with the brief's Chinese values verbatim.
- `DecisionsView.tsx`, `DecisionList.tsx`, `DecisionDetail.tsx`, `kindRank.ts` and `App.tsx` changed as the brief says. `App.tsx` lines were re-measured at HEAD: `type Outcome` is at :138, `send` at :559, and the recorded strings at :588/:594/:603 (the brief measured 130/550/…). F10 holds: `NO_QUESTION`, `HIDDEN_BY_FILTER`, `NOT_IN_LIST`, `AGREE_HELP`, `CORRECT_NOTE` and `KIND_HELP` keep their exports and each equals `en.decisions.<key>`. `kindLabel` keeps its signature and still gives "🔴 reconcile" in English (kindRank.test.ts is green).
- `web/tests/decisionsI18n.test.tsx`: the brief's two tests verbatim, plus the additions listed under Deviations.

## Commands and results (all `> file 2>&1; echo rc=$?`, each file read whole)

| Run | File | rc | Result |
|---|---|---|---|
| red before (the criterion at base source) | `$SCRATCH/t5-red.txt` | 1 | all 3 tests red, with English text everywhere |
| Step 4 green (7 files) | `$SCRATCH/t5-green.txt` | 0 | 7 files, 32 tests passed |
| `npm run check --workspace web` | `$SCRATCH/t5-web-check.txt` | 0 | tsc clean, 46 files, 268 tests passed |
| `npm run typecheck` (root) | `$SCRATCH/t5-root-typecheck.txt` | 0 | clean |

`$SCRATCH` is `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

No existing criterion was rewritten, and none turned red.

## Mutations

- Clone: `$SCRATCH/mut-t5`. The clone log is `t5-clone.txt` (rc=0), and `t5-copy.txt` is empty. The clone is kept.
- Driver: `$SCRATCH/t5-mut.py`. For each mutation it makes one exact edit (after asserting the old text occurs once), runs `(cd $M/web && ../node_modules/.bin/vitest run tests/decisionsI18n.test.tsx)` into `$SCRATCH/t5-<id>.txt`, then restores with cat and `cmp` into `t5-<id>-restore.txt`.
- The summaries are `t5-mut-summary.txt`, `t5-mut-summary-rerun.txt` and `t5-mut-summary-ap5.txt`. AP2, AP3, AP4 and DV4 were re-run with `DEBUG_PRINT_LIMIT=0`, which only shortens testing-library's DOM dump. The first AP1 run was read whole with its dump.
- Results: every mutation gave rc=1 with its named test red and seen in the file, and every restore gave rc=0 with an empty file.

The mutations cover every new `t`, `enumText` and note site. Each one puts the raw English, the raw value or the English constant back. T1 is "shows the list, its filters, the pills and the detail's form in Chinese", T2 is "says in Chinese why an open decision is not in the list", and T3 is "says each recorded outcome in Chinese, and in English after a switch".

| id | Edit | Red |
|---|---|---|
| DV1 | `any` option to the literal `any` | T1 (`['any','🔴 协调']`) |
| DV2 (=MT5-5) | `t("decisions.notInList")` to `NOT_IN_LIST` | T2 |
| DV3 | `t("decisions.hiddenByFilter")` to `HIDDEN_BY_FILTER` | T2 |
| DV4 | h1 to the English literal | T1 and T3 |
| DV5 | count to `{shown.length} of {…}` | T1 (`1 / 1`) |
| DV6 | lede to the English literal | T1 (exact `.section-lede`) |
| DV7/8/10 | filter labels to `"Kind"`/`"Scope"`/`"Repository"` | T1 (`labelTexts(".filters")`) |
| DV9 | scope `optionText` removed | T1 (`['任意','cross-repo']`) |
| DV11/12 | the two empty texts to the English literals | T2 |
| DV13 | selectOne to the English literal | T2 (exact `.split-detail .empty`) |
| DL1/2/3 (=MT5-2, MT5-3) | kind, scope and verdict pills back to the raw value | T1 |
| DL4 (=MT5-6) | `t("decisions.noQuestion")` to `NO_QUESTION` | T1 |
| DD1/2/3 | the three h3 back to English | T1 |
| DD4 | Agree button to `Agree` | T1 |
| DD5 | `{AGREE_HELP}` | T1 (`.detail-help` list) |
| DD6/10/11 | form labels back to English | T1 (`labelTexts(".correction-form")`) |
| DD7 | kindOption to the English `—` template | T1 (`错了 — 选错了`) |
| DD8 (=MT5-4) | `enumText("correctionKind", kind)` to `kind` | T1 |
| DD9 | `t(kindHelp)` to `KIND_HELP[kind]` | T1 |
| DD12 | submit to `Correct` | T1 |
| DD13 | `{CORRECT_NOTE}` | T1 |
| KR1 (=MT5-1) | kindRank `enumText` to `kind` | T1 (`🔴 reconcile`) |
| AP1 | `"decisions.recordedReviewed"` to `"Recorded as reviewed."` | T3 at :141 |
| AP2 | first `"decisions.correctionRecorded"` (form submit) to English | T3 at :149 |
| AP3 | the "Record another" `"decisions.correctionRecorded"` to English | T3 at :156 |
| AP4 | `{t(outcome.text)}` to `{outcome.text}` | T3 (renders the raw key) |
| AP5 | `text: recorded` to `text: t(recorded)` (freezes the words at record time) | T3 at :161: after the switch to English, the status still reads `纠正已记录。` |

## Deviations and why

1. **The criterion was extended beyond the brief's two tests.** The brief's tests assert only through `toContain` on the whole text for about eight sites. Several sites had no assertion at all: the lede, the three filter labels, selectOne, the Because label, agreeHelp, correctNote and the three App outcome strings. Some brief words are also substrings of other strings: 类型 appears twice, and 仓库 is inside 跨仓库.
   - Per the dispatch's last bullet, I added exact per-node assertions for every site.
   - The form `value`s and `select[name=filter-scope]` option values are asserted to stay raw (spec §3.5).
   - A third test drives `App` with a stub `fetch`: Agree, then Correct, then a 409 with `retry_field: "again"`, then "Record another", then a switch to English. It checks each recorded outcome's exact Chinese text and, after the switch, the English text. That English check is the key-kept behaviour of spec §3.3.
   - The brief's two tests are kept verbatim, except that test 2 now holds the containers so it can make the exact checks.
2. `App.tsx` line numbers differ from the brief (re-measured above). The edits themselves are as given.
3. **Unobservable sites:** none. Every new site has a mutation that was seen red.

## Concerns

- None blocking. The `App` outcome test takes about 0.4–1.1 s under the full suite. It uses `waitFor` with the default timeout, and it was not flaky across the 6 runs above.
