# Task 11 report — everything visible goes through t; enum completeness; scan backstop; zh.ts ready for review

Implementer: session e604b1ba (Task 11 subagent), 2026-10-01. BASE ee57fc9, local `main`. `$S` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

## Status: DONE_WITH_CONCERNS

## Commit

- `c840da5` test(web): pin that everything the panel shows goes through its resources — `web/tests/i18nPseudo.test.tsx` (new), `tests/panel/scanPanelText.test.ts` (+32 lines, one `describe`). Message read back from `$S/t11-commitmsg.txt`; ends with the two trailer lines exactly.
- No source file changed: the pseudo-locale and the scan found no leftover in Tasks 2–10's conversion. zh.ts unchanged.

## What was built

1. `web/tests/i18nPseudo.test.tsx` — the brief's file, with:
   - **P2 renames**: repo keys `repo-one/two/three` → `acme-alpha/beta/gamma`; refusal code `correction-already-recorded` → `decision-not-found` (zhErrors has it: 「找不到这条决策。」); model `gpt-plan` → `gpt-5x`.
   - **F15 bundle swap, fixed (deviation)**: the brief's `addResourceBundle("zh", …, wrap(en), true, true)` deep-merges into the store's pack, which *is the imported `zh` object* (i18next keeps the bundle by reference). The pseudo run therefore overwrote `zh` itself and the restore restored wrapped values: the first run had all 8 "same fixture in Chinese" tests red (`$S/t11-pseudo1.txt`, e.g. `expected 'Orca⟦Decisions⟧1⟦Chains⟧…' to contain '决策'`). Now `setZhBundle` does `removeResourceBundle` + `addResourceBundle(fresh)`; Chinese gets `structuredClone(zh)`. MT11-11 (put the deep merge back) is red on 10 tests.
   - **Carried (a), Task 3 review**: `typed plan text is shown as typed` — a loop plan whose goal, done-when, target path, protected path and check hold `{{goal}} $t(nav.decisions) <b>&amp;`, plus a hand-written item with the same objective, rendered in en and zh; asserts the exact summary lines (by the summary region's exact aria-label), the `<code>` check text and the hand-written lines. Group ids (the Trans git line) are not user text: `idSchema` (`src/control/schema.ts:8`) is `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`.
   - **Carried (b), Tasks 7/9 reviews**: `every enum value has its words in both languages` — all 30 families, 146 values (pinned counts): under zh `enumText(family, value) === zh.enums[family][value]` and the Chinese differs from the English except `complexity.S/M/L/XL` (identical by design); under en `enumText === en.enums[family][value]`.
2. `tests/panel/scanPanelText.test.ts` — the brief's `nothing left to translate` describe and 12-row ALLOWED list, verbatim. Green on first run with no allow-list change.

## Commands and results (all `> file 2>&1; echo rc=$?`, files read whole)

Env: `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ECC_GATEGUARD=off DISABLE_OMC=1`.

| Run | File | rc | Result |
|---|---|---|---|
| web tsc probe | `$S/t11-tsc3.txt` | 0 | empty |
| pseudo (final) | `$S/t11-pseudo.txt` | 0 | 22/22 |
| scan (final) | `$S/t11-scan.txt` | 0 | 3/3 |
| `npm run check --workspace web` | `$S/t11-webcheck.txt` | 0 | 53 files / 316 tests (294 before + 22) |
| `npm run typecheck` | `$S/t11-typecheck.txt` | 0 | clean |
| uptime at the full run | `$S/t11-uptime.txt` | — | load 5.39 6.64 7.29 |

No known-flake reruns were needed; no existing criterion went red; no existing criterion was rewritten.

## P2 collision check (over every fixture string)

`$S/t11-collide.mts` (tsx) extracts every double-quoted string between `// ---- fixtures` and the first `describe(` and tests each against the CHECKED set; output `$S/t11-collide.txt`, rc=0: `checked=385 fixtureStrings=234 unique=157`, `hits=101`.
- Every hit is a wire value the panel renders through `enumText`/`t` (states, phases, buckets, kinds, selection sources, schema tags, profile work kinds) or a string never rendered (schema ids, `allowedWorkKinds`, the `it.each` area names). None of the three P2-renamed values hits.
- The measurement that decides it is the pseudo run itself: any rendered raw string containing a CHECKED value would appear in `leftovers`, and all 8 areas are green (`$S/t11-pseudo.txt`). Before the renames `acme-*` were `repo-*` (contains `repo`, enums.decisionScope.repo) and `gpt-plan` contains `plan`.

## Step 3 — enum completeness red at compile time

`$S/mut-t11` (clone of ee57fc9 + this task's two files; `$S/t11-copy.txt` empty). `| "archived"` added to `GroupSummaryV1["state"]` (`web/src/controlTypes.ts:46`), `npm run check --workspace web` → rc=2, `$S/t11-enum-red.txt`: `src/locales/en.ts(44,136): error TS1360 … Property 'archived' is missing in type …`. Restored: `cmp` rc=0, restore file 0 bytes. The unmutated check rc=0 is the main-tree run above (identical files).

## Mutations (all in `$S/mut-t11`, driver `$S/t11-mut.py`: exact one-occurrence replace, run, `cat` restore, `cmp` rc=0 with an empty `-restore.txt` for every one)

| ID | Edit | Criterion run | rc | Red seen (file) |
|---|---|---|---|---|
| MT11-1 | `DecisionsView.tsx` `t("decisions.notInList")` → `NOT_IN_LIST` | pseudo | 1 | `decisions: no English value is left…` lists `decisions.notInList: This decision is no longer in the list: it has been reviewed.` (`t11-MT11-1.txt`) |
| MT11-2 | `ControlGroupView.tsx` `<h3>{t("control.group.workItems")}</h3>` → `<h3>Work items</h3>` | pseudo + scan | 1 / 1 | pseudo `task control…: no English value…` (`control.group.workItems: Work items`) **and** `task control…: the same fixture in Chinese shows '工作项'`; scan `leaves nothing … but the allow-list` (`+ web/src/ControlGroupView.tsx	Work items`) (`t11-MT11-2.txt`) |
| MT11-3 | `{t("control.group.resumeNoContinuation")}` → `Resume (no continuation)` | pseudo + scan | 0 / 1 | pseudo 22/22 green as predicted (no handoff-stop fixture); scan red `+ web/src/ControlGroupView.tsx	Resume (no continuation)` (`t11-MT11-3.txt`) |
| MT11-4 | `footerLines` second element → raw `"dispatch blocked" / "dispatch live"` | pseudo | 1 | `nav and shell footer: no English value…` lists `common.dispatchBlocked: dispatch blocked` (`t11-MT11-4.txt`) |
| MT11-5 | delete `setZhBundle(wrap(en …))` in `usePseudo` | pseudo | 1 | all 8 `… no English value is left …` red on `to contain '⟦'` (`t11-MT11-5.txt`) |
| MT11-6 | `i18n.ts` interpolation `+ skipOnVariables: false` | pseudo | 1 | both `typed plan text …` red: goal re-interpolated recursively, `$t(nav.decisions)` nested to Decisions/决策 (`t11-MT11-6.txt`) |
| MT11-7 | `i18n.ts` `escapeValue: true` | pseudo | 1 | both `typed plan text …` red: `&lt;b&gt;&amp;amp;` (`t11-MT11-7.txt`) |
| MT11-8 | zh `selectionSource.descriptor` → `"descriptor"` (an unrendered value) | pseudo | 1 | `in Chinese shows zh.ts's words …`: `selectionSource.descriptor: zh "descriptor" vs en "descriptor"` (`t11-MT11-8.txt`) |
| MT11-9 | zh `complexity.S` → `"小"` | pseudo | 1 | same test: `complexity.S: zh "小" vs en "S"` (`t11-MT11-9.txt`) |
| MT11-10 | `enumText` bypasses the resource for `selectionSource` only | pseudo | 1 | same test lists all 12 selectionSource values (`shows "operator", zh.ts has "操作者"` …) (`t11-MT11-10.txt`) |
| MT11-11 | `setZhBundle` back to the deep merge `addResourceBundle(…, true, true)` | pseudo | 1 | 10 red: 8 "same fixture in Chinese", `typed … in zh`, enum zh (`⟦S⟧` …) (`t11-MT11-11.txt`) |

Clone `$S/mut-t11` is kept (P10).

## zh.ts ready for review (Step 5)

Brief's tsx command → `$S/zh-review.tsv`, rc=0, **677 lines = 505 keys + 172 zhErrors entries**; `awk -F'\t' 'NF!=3'` → empty (every row three fields); no Chinese column is `undefined`. Read whole.
Presented copy: `.superpowers/sdd/2026-10-01-panel-i18n/zh-review.tsv` (gitignored workspace), 694 lines: 3 `#` header lines with provenance, a `key	English	Chinese` header, the 677 rows, and a `# ---- Wording questions` section with Q1–Q12 (Tasks 5, 6, 7, 9, 10 reviews; keys named per question).

## Deviations

1. Bundle swap by remove + add of a fresh copy instead of the brief's deep merge (the brief's form mutates the imported `zh`; measured red in `$S/t11-pseudo1.txt`, re-measured by MT11-11).
2. Two added describes (carried items a, b) and a longer commit message body naming them.
3. MT11-2 turned one more test red than the brief predicted (the zh named-string test for that area, since 工作项 is the h3 itself). Not a problem; recorded.

## Sites judged unobservable

- `afterEach`'s restore of the zh bundle: every Chinese test calls `useChinese()` itself and vitest isolates files, so removing the restore changes no result in this file. Kept as the brief's F15 hygiene.

## Concerns

- The pseudo criterion only sees CHECKED values ≥ 4 characters with no `{{`: a leftover of a short or templated English value (e.g. `ok`, `run`, `epoch {{epoch}}`) is caught only by the scan backstop, and a raw data string rendered from an enum value's fallback would be seen only if it is ≥ 4 characters. This is how the brief defines it.
- The enum-completeness criterion compares `enumText` to `zh.ts`, so it pins resolution and "is translated", not the wording; the wording is the human's review (zh-review.tsv).

---

## Fix round 1/5 (review I1 + Minor 1) — commit 2bcd2b0

Same implementer session, 2026-10-01, on c840da5. Controller ruling: wrap only the fixed text so interpolated raw values are exposed; extend the check to the fixed parts of templated keys.

### Change (web/tests/i18nPseudo.test.tsx only)

- `parts(value)` splits a value on `{{…}}` and `<tag>` / `</tag>` (`/(\{\{[^}]*\}\}|<\/?[a-z0-9]+>)/`); `wrapValue` wraps each non-empty fixed part as `⟦…⟧` and leaves placeholders and tags outside. `<code>` (loopPlan.git, the one Trans tag) is split too, so no marker crosses a tag.
- `CHECKED = [...WHOLE, ...FRAGMENTS]`: WHOLE is the old rule (385 values); FRAGMENTS are the trimmed fixed parts (>= 4 chars) of templated values that their Chinese value does not contain, labelled `<key> (fixed part)`. Measured `$S/t11f-count.txt` (rc=0): whole=385, fragments=127 from 91 templated keys. Size guard: WHOLE > 300 and FRAGMENTS > 120.
- File header rewritten to say what the criterion cannot see (review Minor 1/2/4): values under 4 characters (n/a, any, By, run, ok, low, separators) — the per-area tests' job; branches no fixture renders (App's loading / not-loaded / unavailable lines, EvidenceLink's refusal) — only the scan, and only literals; attributes other than the four read.

### Evidence (`$S/mut-t11`, restores via `cat` + `cmp` rc=0, every `-restore.txt` 0 bytes)

| Run | File | rc | Result |
|---|---|---|---|
| baseline in clone | `$S/t11-F-base.txt` | 0 | 22/22 |
| R1 `ControlGroupView.tsx` group state raw | `$S/t11-F-R1.txt` | 1 | `task control… no English value…`: `enums.groupState.ready: ready` (+ workStatus/estimateState `ready`) |
| R2 `AgentSelectionEditor.tsx:59` selection source raw | `$S/t11-F-R2.txt` | 1 | `agents: no English value…`: `enums.selectionSource.operator: operator` |
| R3 `RecoveryView.tsx:48` blocker scope raw (`run`) | `$S/t11-F-R3.txt` | 0 | **green — blind by construction**: `run` is 3 characters, under the 4-char rule; a substring rule would hit fixture ids like `run/1`. Covered by controlI18n (reviewer: red twice). |
| R4 `BudgetEditor.tsx:318` proposal state raw | `$S/t11-F-R4.txt` | 1 | `enums.proposalState.editable: editable` |
| MT11-12 `RecoveryView.tsx:49` `t("recovery.run", …)` → `` ` · run ${…}` `` (fragment rule) | `$S/t11-F-MT11-12.txt` | 1 | `recovery.run (fixed part): · run`, `control.group.handoffLine (fixed part): · run` |
| MT11-13 R1 + wrap put back to whole-string | `$S/t11-F-R1-wholewrap.txt` | 0 | green: the segment wrap is what makes R1 visible (named mutation for the change) |
| MT11-13 alone (whole-string wrap, no bypass) | `$S/t11-F-MT11-13.txt` | 0 | green, as expected: it only matters when combined with a bypass |

Main tree: `npm run check --workspace web` rc=0, 53 files / 316 tests (`$S/t11f-webcheck.txt`); `npm run typecheck` rc=0 (`$S/t11f-typecheck.txt`); scan 3/3 (`$S/t11f-scan.txt`); load 7.79 6.73 6.98 (`$S/t11f-uptime.txt`). Commit message read back from `$S/t11f-commitmsg.txt`.

### Minor 1 — what the §6.5 criterion misses, stated plainly (corrects the Concerns above)

Before this fix the largest gap was the **interpolation class**: 19 sites pass `enumText(...)` into `t(...)` (reviewer's `$S/rev11-interp.txt`), and a raw value in any of them was invisible (R1, R2, R4 green at c840da5). The fix closes it for values >= 4 characters. The remaining gaps are: (1) short values (10 keys, e.g. `enums.blockerScope.run`, `enums.decisionVerdict.ok`, `enums.confidence.low`) — R3 shows it; (2) branches no fixture renders — scan only, literals only; a raw identifier (not a literal) in such a branch is seen by nothing here; (3) fixed fragments under 4 characters or contained in the Chinese value; (4) attributes other than aria-label/title/placeholder/label. The Concerns list earlier in this report was not complete; this list replaces it.

Status: DONE_WITH_CONCERNS (R3-class short values stay blind by construction).
