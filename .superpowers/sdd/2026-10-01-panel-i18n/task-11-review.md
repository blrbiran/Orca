# Task 11 review — pseudo-locale, enum completeness, scan backstop, zh-review.tsv

Reviewer: session e604b1ba (Task 11 reviewer subagent), 2026-10-01, reviewing ee57fc9..c840da5 (HEAD c840da5, local `main`, clean).
Mutations only in `$S/rev-t11` (`git clone --local` of c840da5; `$S` = the session scratchpad). Every edit restored with `cat`; `cmp` rc=0 and every `rev11-*-restore.txt` 0 bytes; `git status --short` in the clone shows only the two node_modules symlinks (`$S/rev11-clone-status.txt`). Clone kept (P10).

## Spec Compliance

✅ Spec compliant (with the plan-mandated gap below).

- `web/tests/i18nPseudo.test.tsx` has the brief's file, AREAS (8), CHECKED rule (>= 4 chars, no `{{`, differs from zh), strip, leftovers over text + `aria-label`/`title`/`placeholder`/`label`, the `> 300` size guard, and the per-area Chinese named string. `tests/panel/scanPanelText.test.ts:85-116` is the brief's `describe` and 12-row ALLOWED verbatim.
- P2 renames applied: `acme-alpha/beta/gamma` (i18nPseudo.test.tsx fixtures `stopped`/`running`/chains area), `decision-not-found` (error area), `gpt-5x` (`preview.planLayers`). The implementer's collision measurement (`checked=385 … hits=101`, all rendered through `enumText`/`t` or never rendered) is plausible and is decided by the pseudo run itself being green; my prototype below (which exposes interpolated data) also stays green on the baseline, so no fixture string collides.
- Step 3 (enum completeness red at compile time), Step 4 (MT11-1..5) and Step 5 (tsv) are reported with files; the tsv checks I re-ran agree: `zh-review.tsv` 694 lines, 505 key rows + 172 `errors.*` rows, 0 rows with an empty/`undefined` Chinese column, 0 non-comment rows with NF != 3; Q1–Q12 wording section present with keys named.
- Carried (a): `typed plan text is shown as typed` (i18nPseudo.test.tsx, `TYPED`/`TYPED_LINES` describe) asserts exact card lines by the summary region's aria-label, the `<code>` check text and the hand-written lines in en and zh; MT11-6 (`skipOnVariables:false`) and MT11-7 (`escapeValue:true`) reported red. The en case relies on `tests/setup.ts` resetting to `en` after every test — checked, it does (`afterEach(() => i18n.changeLanguage("en"))`).
- Carried (b): `every enum value has its words in both languages` reads all 30 families / 146 values through `enumText` in zh and en; MT11-8/9/10 reported red. Pins resolution + "differs from English", not wording (the report says so; wording is the human's via the tsv) — correct scoping.

### F15 ruling (swap mechanism changed) — accepted

The brief's `addResourceBundle("zh", …, wrap(en), true, true)` deep-merges into the pack i18next holds, which is the imported `zh` object itself (`initI18n` passes `resources: { zh: { translation: zh } }`, `web/src/i18n.ts`), so the pseudo run would corrupt `zh` for every later test in the file and the restore would restore wrapped values. The implementer measured this red (`t11-pseudo1.txt`: all 8 Chinese tests) and re-measured it as MT11-11 (10 red). `setZhBundle` = `removeResourceBundle` + `addResourceBundle(fresh)`, with `structuredClone(zh)` for Chinese, removes the aliasing: after the first swap the store never holds the imported object again. The deviation is necessary and correctly scoped; no rule is weakened.

## Strengths

- The F15 bug was found by running, not by reading, and pinned by a named mutation (MT11-11) — the fix cannot silently regress.
- Mutation set goes beyond the brief (MT11-6..11) and each names its red test and file; MT11-3 honestly records the predicted pseudo-green / scan-red split.
- Carried (a) asserts by exact region selectors, not substrings; carried (b) enumerates families from `en.enums` and pins the counts, so a new family forces this test to be revisited.

## Issues

### Critical

None.

### Important

**I1 (plan-mandated) — the pseudo criterion cannot see an untranslated value passed as an interpolation parameter, nor a value under 4 characters; it passes while an area renders English UI words.** `web/tests/i18nPseudo.test.tsx`, `wrap` + `strip` (`⟦${value}⟧` around the whole resolved string, then `/⟦[^⟦⟧]*⟧/g` removed): `t("key", { state: X })` renders `⟦… X …⟧`, so whatever `X` is — including raw English — is stripped together with the marker. There are 19 such sites passing `enumText(...)` into `t` (measured: `grep 't("[^"]*", *{[^}]*enumText'` over `web/src` → `$S/rev11-interp.txt`, e.g. `ControlGroupView.tsx:88`, `ControlGroupView.tsx:205`, `BudgetEditor.tsx:318/320/328/351/372/382/397`, `AgentSelectionEditor.tsx:59-61/173-175`, `DecisionDetail.tsx:120`, `LoopPlanCard.tsx:130`). The scan backstop does not cover these either: the bypass is an identifier, not a literal.
Seen green (rc=1 only from the other file in each run; `i18nPseudo 22/22 ✓` in every output, `$S/rev11-all.txt`):
  - R1 `ControlGroupView.tsx:88` `state: enumText("groupState", view.summary.state)` → `state: view.summary.state` — pseudo green; `controlI18n` red (`g · running · 版本 6`).
  - R2 `AgentSelectionEditor.tsx:59` `source: enumText("selectionSource", provenance.agent)` → `provenance.agent` — pseudo green; `agentsI18n` red (`来自operator`).
  - R3 `RecoveryView.tsx:48` `enumText("blockerScope", blocker.scope)` → `blocker.scope` (value `run`, 3 chars, not interpolated) — pseudo green; `controlI18n` red twice.
  - R4 `BudgetEditor.tsx:318` `state: enumText("proposalState", …)` → raw — pseudo green; `budgetI18n` red twice.
Today these four sites are caught only because Tasks 5–10's per-area Chinese tests happen to assert those lines; the §6.5 criterion that claims "everything visible goes through t" does not. This is exactly the shape spec §6.5 warns against (passing while an area shows English).
**Fix, prototyped and measured:** wrap only the static fragments, leaving placeholders and Trans tags outside the markers so interpolated values survive `strip`:
```ts
const wrapValue = (value: string): string => value.split(/(\{\{[^}]*\}\}|<\/?\d+>)/).map((part, i) => i % 2 === 1 || part === "" ? part : `⟦${part}⟧`).join("");
```
(`wrap` then calls `wrapValue`.) In `$S/rev-t11` (`$S/rev11-F.txt`): baseline 22/22 green (F0); R1 red (`enums.groupState.ready: ready`, `enums.workStatus.ready`, `enums.estimateState.ready`), R4 red (`enums.proposalState.editable: editable`), R2 red (`enums.selectionSource.operator: operator`) — each in the pseudo `… no English value is left …` test of its area. With this wrap the templated keys' static fragments can also join CHECKED (95 of the 99 templated keys that differ from zh have a >= 4-char fragment, `$S/rev11-short.txt`), closing the "templated strings are never checked" part of the report's own concern. Add R1 as the named mutation for the change.
Residual after the fix: the 10 short values (`common.na` n/a, `decisions.any`, `chains.by`, `control.group.th.run`, `control.group.runsTh.run`, two separators, `enums.decisionVerdict.ok`, `enums.blockerScope.run`, `enums.confidence.low` — `$S/rev11-short.txt`) stay blind to the pseudo run (R3). A substring rule for them would false-hit fixture ids (`run/1`); say in the file header that these are the per-area tests' job rather than implying full coverage.

### Minor

1. The report's Concerns list short and templated values but not the interpolation hole (I1), which is the larger one (19 sites vs 10 short keys). The report should not be read as a complete list of what §6.5 misses.
2. Areas no fixture reaches: `App.tsx`'s own body (`shell.loading` :576, `chains.notLoaded` :646, `control.unavailable` :670) and `EvidenceLink.tsx:28` (`control.evidence.refused`) are covered only by the scan, i.e. only against literal regressions. Acceptable per the brief's F18 split; worth one line in the header comment.
3. `expect(container.textContent).toContain("⟦")` proves at least one wrapped string, not that the area is mostly wrapped; the named Chinese string per area compensates. No change needed, noted.
4. `leftovers` reads four attributes; no `alt`/`value`/`aria-description` is set through `t` in `web/src` today (`$S/rev11-attrs.txt`, grep rc=1 = none), so nothing is missed now; a future such attribute would be invisible.

## Checks run (all `> file 2>&1; echo rc=$?`, files read whole)

| Check | File | rc |
|---|---|---|
| key exclusions (short / templated / same as zh) | `$S/rev11-short.txt` | 0 (505 keys; short 10; templated 99; same 11) |
| interpolated `enumText` sites | `$S/rev11-interp.txt` | 0 (19 lines) |
| R1–R4 bypass mutations vs pseudo + area test | `$S/rev11-R{1..4}.txt`, collected `$S/rev11-all.txt` | 1 each; pseudo green in all four |
| segment-wrap prototype, baseline + 3 bypasses | `$S/rev11-F0.txt`, `rev11-F-*.txt`, collected `$S/rev11-F.txt` | 0 / 1 / 1 / 1 |
| attributes set through `t` beyond the four read | `$S/rev11-attrs.txt` | 1 (none) |
| zh-review.tsv shape | awk counts in this session | 505 + 172, 0 empty |

## Assessment

**Spec:** ✅ — the brief is implemented as written; F15 deviation accepted with evidence; carried (a) and (b) done.
**Task quality:** Changes needed — I1 (plan-mandated): the §6.5 criterion is not vacuous (MT11-1/2/4/5 red) but is blind to raw values passed through interpolation and to values under 4 chars, measured green on four real bypasses; a one-line change to `wrap` (prototyped: baseline green, three bypasses red) closes the interpolation part.

## Re-review (fix round 1)

Reviewer: session e604b1ba (Task 11 scoped re-reviewer), 2026-10-01, reviewing c840da5..2bcd2b0 (`review-c840da5..2bcd2b0.diff`, one file: `web/tests/i18nPseudo.test.tsx`, +26/-9).
Mutations only in `$S/rev-t11`: the test file was synced to 2bcd2b0 by `cat` (`cmp` against `git show 2bcd2b0:web/tests/i18nPseudo.test.tsx` rc=0); `web/src` there is unchanged between c840da5 and 2bcd2b0 (diff stat names only the test file, `$S/rr1-stat.txt`). Driver `$S/rr1-mut.py`: exact one-occurrence replace, restore from a backup, `filecmp` True for all three; `git diff --stat -- web/src` in the clone 0 bytes (`$S/rr1-restore.txt`).

### Finding verdicts

- **I1 — pseudo criterion stripped raw values interpolated into t** — ADDRESSED. `wrapValue`/`parts` (i18nPseudo.test.tsx, the `parts` / `wrapValue` / `wrap` lines) wrap only the fixed text and leave `{{…}}` and `<tag>` outside the markers, so an interpolated value survives `strip`. My bypasses re-run against 2bcd2b0's test (`npx vitest run tests/i18nPseudo.test.tsx`, each to its own file, rc from the driver):
  - baseline `$S/rr1-base.txt` rc=0, 22/22.
  - R1 `ControlGroupView.tsx:88` groupState raw → `$S/rr1-R1.txt` rc=1: `task control, recovery, budget table: no English value…` lists `enums.groupState.ready: ready` (+ workStatus/estimateState `ready`). Was green at c840da5.
  - R2 `AgentSelectionEditor.tsx:59` selectionSource raw → `$S/rr1-R2.txt` rc=1: `agents: …` lists `enums.selectionSource.operator: operator`. Was green.
  - R4 `BudgetEditor.tsx:318` proposalState raw → `$S/rr1-R4.txt` rc=1: lists `enums.proposalState.editable: editable`. Was green.
  The FRAGMENTS extension (fixed parts of templated keys, >= 4 chars, not contained in the Chinese value) and its `> 120` guard are consistent with the report's MT11-12 and MT11-13 evidence. R3 (short value `run`) is not re-run here; the report states it stays green by construction and the header now says so, which matches the residual this review stated.
- **Minor 1 — the report left out the interpolation gap class** — ADDRESSED. The report's "Fix round 1/5 → Minor 1" section names the interpolation class (19 sites) as the largest pre-fix gap and says outright that it replaces the earlier Concerns list, with the four remaining gap classes. The file header now lists what the criterion cannot see (short values, branches no fixture renders, the four attributes), which also covers Minor 2 and Minor 4.

### New breakage in the fix diff

None. Checked: the tag alternation `<\/?[a-z0-9]+>` matches only `<code>`/`</code>` in the English bundle (`grep -n '"[^"]*<[^"]*"' web/src/locales/en.ts` → `$S/rr1-lt.txt`, rc=0; the only string value with `<` is `loopPlan.git`, line 347; all other hits are TypeScript generics); the carried (a) typed-plan test that renders that key is still green in the 22/22 baseline.

### Out-of-scope observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
