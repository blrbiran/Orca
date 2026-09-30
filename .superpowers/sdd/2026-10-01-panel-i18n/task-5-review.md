# Task 5 review: the decisions area

Task reviewer subagent of session e604b1ba, 2026-10-01. Range 8bbc437..1d036e2 (one commit, `1d036e2 feat(web): translate the decisions area`), read from `review-8bbc437..1d036e2.diff`. Read-only on the repository; own scratch files only under `$SCRATCH/rev-t5` (no clone was needed).

### Spec Compliance

- ✅ Spec compliant. Every file the brief lists has its hunk:
  - `DecisionsView.tsx`: diff lines 360-475.
  - `DecisionList.tsx`: 273-339.
  - `DecisionDetail.tsx`: 124-252.
  - `kindRank.ts`: 492, 515.
  - `App.tsx`: 34-35, 58, 81, 87, 91, 98.
  - `en.ts`: 535-623.
  - `zh.ts`: 640-695.
  - `decisionsI18n.test.tsx`: new file.
- Interfaces (F10) hold. `NO_QUESTION`, `HIDDEN_BY_FILTER`, `NOT_IN_LIST`, `AGREE_HELP`, `CORRECT_NOTE` and `KIND_HELP` each equal `en.decisions.<key>` (diff 158-160, 300, 377-378). `kindLabel` keeps its signature (diff 512-516).
- The render reads through `t`, not through the constants. The constants now exist only for other criteria to read.
- `data-*` attributes and control values stay raw (spec §3.5):
  - `data-level={kindLevel(String(row.kind))}` is unchanged (diff 332).
  - Option `value`s are unchanged (diff 232, 416). The test asserts both at test lines 762-763.
- The recorded outcome keeps its key, so a language switch re-renders it (spec §3.3). `RecordedKey`, `text: RecordedKey` and `t(outcome.text)` are at diff 34-35 and 91. Test 3 checks the switch.
- Additions beyond the brief are criteria only: extra per-node assertions, a third test and one extra "unopened" render in test 2. The dispatch and preflight P16 ask for exactly this. None of it is scope creep.
- **English byte-identity, measured.** The command is `tsx $SCRATCH/rev-t5/bytecheck.mts $SCRATCH/rev-t5/base-src.txt > $SCRATCH/rev-t5/bytecheck.txt 2>&1`, rc=0, and I read the output file whole.
  - `base-src.txt` holds `/usr/bin/git show 8bbc437:web/src/{DecisionsView,DecisionList,DecisionDetail,App}.tsx`.
  - Every `en.decisions` string value, and all three `kindHelp` values, appears verbatim in the base source: 28/28 OK, `bad 0`.
  - For the two templates, the literal parts appear in the base source. `count` → " of " matches the JSX `{shown.length} of {props.rows.length}`, which renders "1 of 1". `kindOption` → " — " is U+2014 (hex `20e2809420`), the same byte sequence as the old template literal.
  - Each enum family's English value is the raw value itself (diff 541-546), so the English render of pills and options does not change. `kindLabel` still gives "🔴 reconcile" (the implementer reports `kindRank.test.ts` green).
- **Leftover literals.** I scanned for leftover English with `grep -nE '>[A-Za-z][^<{]*<|(aria-label|title|placeholder)="[A-Za-z]'` over the three decision components at HEAD: rc=1, no match. This command was a filter, but it is a completeness probe, not a verification run.
- **Chinese vs the spec glossary (§5).** The glossary has one term in this area: Decisions → 决策. It is used consistently in the title, lede, empty texts and notes.
  - No other glossary term (Plan, Budget, Confirm…) occurs in the area.
  - All 27 `decisions` values and the 4 enum families match the brief's table verbatim (diff 640-695).
  - The lede's 「同意」「纠正」 name the button labels exactly (`agree` 同意, `correct` 纠正).
  - `kindOption` uses the Chinese dash ——, which matches `shell.brandTitle`.
- ⚠️ **Cannot verify from diff:** the brief's App.tsx line numbers (130/550/580…) are stale. The implementer re-measured them at :138/:559/:588/:594/:603. The hunks show every edit the brief names, so this affects only the brief's line numbers, not the code.

### Strengths

- The criterion is much stronger than the brief's. The brief's `toContain` checks could pass on a neighbour's text: 类型 occurs twice, and 仓库 is inside 跨仓库. The implementer added exact per-node assertions for every site (test lines 747-760), so every new `t`/`enumText` site now has its own assertion.
- Mutation coverage is complete. 40 named mutations cover every new site, each with rc=1 and the named test red. Every restore file is empty, and `t5-copy.txt` is 0 bytes.
  - I read `t5-KR1-kindLabel.txt` and `t5-AP5-outcomeFrozen.txt` whole. KR1 fails on `['任意','🔴 reconcile']` at test line 38. AP5 fails at test line 161 with `'纠正已记录。'`, not `'Correction recorded.'`.
- AP5 matters most. It freezes the words at record time, which is the realistic regression, and the English-after-switch assertion catches it. That makes spec §3.3's key-kept behaviour a real criterion, not a formality.
- `RecordedKey` narrows `send`'s parameter. A mistyped key is now a compile error, not a raw key rendered to the user.
- The test's `globalThis.fetch` stub follows the file-level convention of `appSelection`, `i18nSwitch` and 8 other web tests.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

These are wording points for the human's zh review, which spec §5 schedules. Each value is exactly as the brief mandates, so none of them is an implementer defect.

1. **仓库 means two things side by side** (`zh.ts`, diff 646 and 693).
   - The Scope filter's option for `repo` renders 仓库. The next filter's label, Repository, is also 仓库. So the filter row reads 「范围 [仓库]」「仓库 [github.com/…]」.
   - English has the same pairing (repo / Repository), so this is not a regression. If the human wants the two told apart, `decisionScope.repo` → 单仓库 would pair with 跨仓库.
2. **The option text says "wrong" twice** (diff 662, 695). `correctionKind.wrong` 错了 plus `kindHelp.wrong` 选错了 renders 「错了 —— 选错了」. It follows the English pattern "wrong — the choice was wrong", so this is a wording choice for the human.
3. **The 选择了 heading** (diff 654). As an `h3` heading, 选择了 reads as a sentence fragment. Headings like 所选 / 选择 would read more naturally beside 理由 / 被否决的备选. This is optional polish for the human's zh review.

### Assessment

**Task quality:** Approved

**Reasoning:** Every brief edit is present. The English values are mechanically byte-identical to the base render, and raw values stay in the attributes and form values. Every new render site has a deletion or reversion mutation seen red, including the key-kept outcome (AP5). The only findings are three wording points left to the human's zh review.
