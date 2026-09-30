# Preflight: panel i18n plan

Read-only preflight sub-agent of session `e604b1ba` (Claude Opus 5.5), 2026-10-01, at Orca `52fd55b`. Plan:
`docs/superpowers/plans/2026-10-01-panel-i18n.md` (controller rulings applied). Probes ran in `…/scratchpad/pf/`. No repository file
other than this one was written.

Measured and consistent (not findings): the Task 1 scan reproduces 1089/387 rows, and the ui rows match the inventory byte for byte.
The Task 1 criterion passes against the Task 1 script. The en/zh blocks of Tasks 2–10, assembled, have 505 keys each: exact parity,
equal placeholders and tags. CHECKED = 385 (> 300). The width proxy passes 85 keys (Task 8) and 97 (Task 9). The English metrics notes
equal the server sentences. The English plan name and discipline equal the registry for all 10 versions. All 124 catalog codes are in
`zhErrors`. Under vitest jsdom, `window === globalThis`, and a `navigator.languages` override reaches bare `navigator`. In i18next 26.4.2,
`zh-TW` gives `language` "zh-TW" and `resolvedLanguage` "zh", so MT2-6 is valid. i18next prints no console notice. The root
`scopeTmpdir.ts` removes Task 1's `mkdtemp` directories.

## 1. Shared files and interfaces

| Tasks | Producer → consumer | Finding |
|---|---|---|
| 1↔11 | scan CLI `<class>\t<file>:<line>\t<ctx>\t<text>`, `--ui` → T11 parses `[, where, , text]`, ALLOWED 12 rows | consistent (12 = 8 HTTP + Orca + 2 classNames + main.tsx) |
| 2→3..10 | `i18n` default, `enumText`, `currentLanguage`, `initI18n`; `en`/`zh`/`Translation` | consistent; parity holds at every Task |
| 2↔6 | `i18nSwitch.test.tsx` `chainRepos`, `languageSelect` | consistent |
| 2↔10 | `zhErrors = {}` (T2) → filled (T10); `refusalText` uses `currentLanguage` | consistent |
| 2↔11 | `footerLines(summary)`, `Shell` `language` prop | consistent |
| 3↔7 | `ControlGroupView` chip :132 (T3) / rest (T7); T3 import shifts T7's lines | consistent (T7 re-measures) |
| 3↔8 | `LoopPlanCard`: `useTranslation();` → `const { t }`; `i18n` → `i18n, { enumText }`; `loopPlan.*` extended after `summary` | consistent |
| 3↔11 | `planText`, `loopSummaryLines`, `loopDraftKey` | consistent |
| 4↔11 | optional web codes; `MetricsView` `noteText` | consistent |
| 7↔8 | `enums.budgetMode` defined in T7, used in T8 and ImportForm | consistent |
| 7↔10 | `ControlPanel` `t` (T7) used by the refusal line (T10); `control.evidence.refused` | consistent |
| 8↔9 | `i18nWidth.test.ts` NARROW/BUTTONS; guard 85→97 | consistent (measured) |
| 2,5,6,7,9 ↔ App.tsx | `t` (T2), `RecordedKey` (T5), `chains.notLoaded` (T6), `control.unavailable` (T7), exported `retryNotice` (T9) | consistent; no hook placed after an early return |
| 3↔root tsc | `taskLoopApi` imports `web/src/locales/*`, which pull `theme.ts`, `types.ts`, `controlTypes.ts` | consistent (root has no `lib`, so DOM is included) |

## 2. Each task against itself

| Task | Tests vs code / files / keys / commands |
|---|---|
| 1 | Test passes against the script (measured); red without the script; MT1-1..6 valid. |
| 2 | Consistent. MT2-1..12 valid (MT2-6 measured). The `_one` case is vacuous until T3 (P6). |
| 3 | **Step 1 fails** (P1). With `.mts`, the capture equals ROWS byte for byte. The Step 5 grep's rc claim is wrong (P12). |
| 4 | Consistent. Golden line numbers are pre-insertion (P18). |
| 5 | Consistent; MT5-1..6 valid. |
| 6 | Consistent; MT6-1..4 valid. |
| 7 | Consistent; the zh expected strings match the zh block; MT7-1..7 valid. |
| 8 | Consistent, except that **MT8-1 cannot go red** (P3). |
| 9 | Consistent, except that **MT9-3 cannot go red** (P4) and the global `JSX` (P11). |
| 10 | Consistent; all 124 catalog codes and every hand-listed code have entries; MT10-1..8 valid. |
| 11 | **i18nPseudo is red on first run** (P2). The scan backstop and MT11-1..5 are consistent. |
| 12 | Consistent, except the clone deletion (P10). |

## 3. Defects a reviewer would flag

- **P2 (should-rule)**: plan:4602-4606 matches CHECKED values as raw substrings, and the fixtures collide with it, although
  plan:4551-4552 and 4620 say they do not. Measured collisions:
  - The repo keys `repo-one/two/three` (plan:4676-4677, shown at `ChainPanel.tsx:88` and `:42`) contain `enums.decisionScope.repo` "repo".
  - The refusal code `correction-already-recorded` (plan:4727, shown at `Refusal.tsx:27`) contains "ready" (the `groupState`,
    `workStatus` and `estimateState` families).
  - The planned model `gpt-plan` (plan:4671) is rendered as the model input's `placeholder` (`AgentFields.tsx:163`), which is scanned,
    and contains "plan".

  So the chains, agents and error-page areas are red, while Step 2 expects rc=0. Ruling: match whole tokens (letters not adjacent),
  skip `<code>` and `data-testid` code elements, and rename the repo keys.
- **P3 (should-rule)**: MT8-1 (plan:3724) reverts only the table header. The limit labels (plan:3673, `BudgetEditor.tsx:402-404`) still
  render "活跃毫秒", so the expected string (plan:3362) stays and the mutation stays green. Ruling: assert the `thead th` texts.
- **P4 (should-rule)**: MT9-3 (plan:4022) reverts only the legend. "设置组 执行 的 agent" (plan:3993, and expected at 3837) still contains
  "组 执行", so the mutation stays green. Ruling: assert the `legend` or the fieldset `aria-label`.
- P5 (minor): `not.toContain("REJECT:")` (plan:1477) cannot go red, because the view has no `rejectOn`.
- P6 (minor): the i18nKeys `_one` case (plan:865) is vacuous in Task 2. The plan acknowledges it and MT3-10 later turns it red.
- P7 (minor): in i18nWidth, `toBeDefined` (plan:3433) is tautological for the prefix-derived keys.
- P16 (minor): many new `enumText`/`t` sites have no named mutation (for example the scope `optionText` at plan:2412 and the coverage
  `noteText`). Spec §6 asks for a mutation for "every new branch". Ruling: define "branch" as a new function or conditional, not a call site.
- Duplication (minor, part of P7): `flatten` appears 3×, and the fixture consts (capability, config, view) appear in 5 test files.

## 4. Against the Global Constraints and the spec

- **P8 (should-rule)**: the spec names an `errors` namespace in Chinese and requires "`errors.<code>`" (§2, §3.2, §6.4). The plan uses a
  plain `zhErrors` table instead (plan:36, 4258) and substitutes `{{message}}` itself. It is not listed among the drafter findings.
  Ruling: record it as a spec deviation, or accept it explicitly.
- P9 (minor): the constraint "Chinese only in `zh.ts`" (plan:32) conflicts with `LANGUAGE_NAMES` "中文" in `i18n.ts` (plan:1138), which
  spec §4 requires. Amend the constraint.
- **P10 (should-rule)**: the ruling "the agent deletes clones with `/bin/rm -rf`" (plan:27) conflicts with plan:47 "Clones are kept" and
  with Task 12 Step 4 (plan:4886, "deleting them needs the human"). It also conflicts with the user's global CLAUDE.md, where recursive
  `rm -rf` needs the user's explicit approval. Ruling: pick one; if deletion stays, restrict it to `$SCRATCH/mut-*` with a path-prefix check.

## 5. Likely run-time or compile-time failures

- **P1 (blocking)**: the Task 3 Step 1 capture (plan:1358-1385) writes `$SCRATCH/t3-capture.ts` with top-level `await import`. The
  scratchpad has no `"type":"module"`, so tsx compiles it as CJS and fails: "Top-level await is currently not supported with the "cjs"
  output format", rc=1 (measured). The plan then says stop. Ruling: use `t3-capture.mts` (measured: rc=0, `cmp` equal to plan:1424-1463).
- P11 (minor): `JSX.Element` (plan:3812) has no global namespace under @types/react 19, so tsc fails with TS2503. Make the import
  mandatory instead of conditional (plan:3854).
- P12 (minor): the Step 5 grep (plan:1814) uses `\.summary\b`, which matches every `view.summary.` in `web/src`, so rc=0, not 1.
- P15 (minor): the typing risk U1 concerns 505 keys (not "about 600"). Ruling: before Task 2, run tsc once in scratch over the assembled
  full en/zh with the `CustomTypeOptions` declaration and the template-literal keys, so that TS2589 or slowness shows up early.
- P17 (minor): the inventory tags `LoopPlanCard.tsx:171` `Plan summary` as T3, but Task 8 converts it (plan:3713).
- P18 (minor): the golden insertions (plan:2137-2153) cite pre-insertion lines. Apply them bottom-up.

## Count

blocking 1 (P1) · should-rule 5 (P2, P3, P4, P8, P10) · minor 10 (P5, P6, P7, P9, P11, P12, P15, P16, P17, P18)
