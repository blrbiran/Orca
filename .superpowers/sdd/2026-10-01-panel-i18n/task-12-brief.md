### Task 12 (controller): The round's gate

**Files:** none changed.

- [ ] **Step 1: The round's criteria in the main tree**

```bash
./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts tests/control/loopPlanViewFields.test.ts tests/control/loopPlanView.test.ts tests/panel/taskLoopApi.test.ts tests/metrics/noteCodes.test.ts tests/metrics/cli.test.ts tests/panel/refusalCoverage.test.ts > "$SCRATCH/t12-criteria.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t12-tsc.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t12-web-check.txt" 2>&1; echo rc=$?
```
All `rc=0`.

- [ ] **Step 2: Full suite in fresh clones** (Rule 15: nothing runs in the main tree). Record the real `~/.orca` before anything moves `HOME`:

```bash
G="$SCRATCH/gate-i18n"; mkdir -p "$G"
( ls -la /Users/biran/.orca; stat -f '%N %m %z %i' /Users/biran/.orca /Users/biran/.orca/* ) > "$G/orca-before.txt" 2>&1; echo rc=$?
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$G/ccloop" > "$SCRATCH/t12-ccloop-clone.txt" 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$G/ccloop/node_modules"
(cd "$G/ccloop" && npm run build) > "$SCRATCH/t12-ccloop-build.txt" 2>&1; echo rc=$?
/usr/bin/git clone --local "$REPO" "$G/orca" > "$SCRATCH/t12-orca-clone.txt" 2>&1; echo rc=$?
ln -s "$REPO/node_modules" "$G/orca/node_modules"; [ -d "$REPO/web/node_modules" ] && ln -s "$REPO/web/node_modules" "$G/orca/web/node_modules"
mkdir -m 0700 "$G/agents"
cat > "$G/agents/agents.json" <<JSON
{"schema":"ccloop-agents-table-v1","installations":{"codex":{"kind":"codex","command":["$(command -v node)","$G/ccloop/tests/fixtures/fake-codex.mjs","integration","$G/agents/marker.json"],"version":"9.9.9-fake","configDir":null,"timeoutMs":120000,"killGraceMs":5000,"sandbox":"workspace-write","budgetMode":"soft"}}}
JSON
chmod 0600 "$G/agents/agents.json"
export HOME="$G/home" XDG_CONFIG_HOME="$G/xdg/config" XDG_DATA_HOME="$G/xdg/data" XDG_STATE_HOME="$G/xdg/state" XDG_CACHE_HOME="$G/xdg/cache"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"
export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ORCA_CCLOOP_BIN="$G/ccloop/dist/cli.js" ORCA_AGENTS_TABLE="$G/agents/agents.json" ECC_GATEGUARD=off DISABLE_OMC=1
(cd "$G/orca" && npm run build --workspace web) > "$SCRATCH/t12-web-build.txt" 2>&1; echo rc=$?
(cd "$G/orca" && npm run typecheck) > "$SCRATCH/t12-clone-tsc.txt" 2>&1; echo rc=$?
(cd "$G/orca" && npm run check --workspace web) > "$SCRATCH/t12-clone-web.txt" 2>&1; echo rc=$?
(cd "$G/orca" && npm test) > "$SCRATCH/t12-full.txt" 2>&1; echo rc=$?
(cd "$G/orca" && npm run verify:panel) > "$SCRATCH/t12-verify-panel.txt" 2>&1; echo rc=$?
(cd "$G/orca" && node scripts/check-tmp-leak.mjs) > "$SCRATCH/t12-tmp-leak.txt" 2>&1; echo rc=$?
( ls -la /Users/biran/.orca; stat -f '%N %m %z %i' /Users/biran/.orca /Users/biran/.orca/* ) > "$G/orca-after.txt" 2>&1; echo rc=$?
cmp "$G/orca-before.txt" "$G/orca-after.txt" > "$SCRATCH/t12-orca-cmp.txt" 2>&1; echo rc=$?
```
Pass: every `rc=0` (the ccloop build first: without it the scheduler criteria go red for a missing binary); `npm test` failures only among the known load flakes (Global Constraints), each with a single-file rerun 3/3 green and `uptime` recorded; `verify:panel` all PASS; `check-tmp-leak` RC 0; the two `~/.orca` records byte-identical. Record the numbers the tools print (files, tests, passed, failed, pending) — never estimated (Rule 14). Any other red existing criterion ⇒ stop and report it by full name.

- [ ] **Step 3: Rerun the whole mutation table** (MT1-1 … MT11-5, and Task 11 Step 3) once on a `git clone --local` of the gate commit: one row each, `mutation | file | predicted red | actual red (full test name) | restore cmp rc`. A mismatch is recorded as measured, never "fixed" in the prediction.
- [ ] **Step 4: Present `zh-review.tsv` (Task 11 Step 5) to the human** with the round's report; list every `$SCRATCH/mut-*` and `$G` path for the human (deleting them needs the human).

---

## Self-Review

1. **Spec coverage.**
   - §0 (switchable, browser default, remembered, English byte-identical): Task 2 (instance, detection, switch), every area Task (English values copied from the code), Task 11 (nothing left). §0.1 (not built): the CLI is untouched except the additive JSON fields of F8; data, ids, codes stay as sent (Task 1's server-field table, F6, F18).
   - §1 rulings: L1–L3 Tasks 2–11; L4 react-i18next + the detector (Task 2); consequence for C7: Task 3 (the correction section already exists, F7).
   - §2 structure: dependencies, `initI18n`, options, key areas, typing (`Translation<typeof en>`, `_one` in Chinese), helpers keep signatures, module-level constants become key lookups (Shell `LABELS` Task 2, `WEB_LOOP_PLANS` Task 3, `BANNER_TEXT` Task 6, `FIELD_LABEL`/`BAD_BUDGET`/`BAD_FILE_CAP` Task 8), plurals (Task 3), English byte-identical (Global Constraints).
   - §3 text that is not a JSX literal: the scan (Task 1) with its inventory; §3.1 Task 3; §3.2 Task 10; §3.3 Tasks 2, 5–10 (F17 lists the additions); §3.4 Task 4 (metrics), Task 6 (chain `problem` as sent), Task 10 (unreachable detail interpolated as sent); §3.5 every area Task (30 families, F6), Task 11 Step 3 (compile-time completeness), Task 2 (`enumText` fallback).
   - §4 detection and switch: Task 2 (order, `caches: []`, `resolvedLanguage`, `<html lang>`, the select with `English`/`中文`), F2 (custom stored-choice detector), F3 (own instance).
   - §5 Chinese wording: every area Task's zh block (glossary terms: 决策 / 链 / 任务控制 / 指标, 主题 / 语言, 做法 and the five plan names, 目标 / 完成条件 / 只改 / 不许改, 预算 / 组余量 / 估算 / 建议, 确认 / 开跑 / 暂停 / 交接, 尝试 / 活跃时间 / token, 已修改); the loop plans spec's strings for `loopPlan.*` (Task 3, Task 8); human review Task 11 Step 5 → Task 12 Step 4.
   - §6 criteria: 1 → Task 2 setup + every Task's `npm run check --workspace web`; 2 → Task 2 `i18nKeys`; 3 → Task 3 `loopSummary`; 4 → Task 10 `refusalCoverage` + `refusalText`; 5 → Task 11 `i18nPseudo`; 6 → Task 2 `i18nDetect`; 7 → Task 2 `i18nSwitch` + Task 6's helper case; 8 → Task 3 `loopPlanViewFields`; 9 → Task 3 (rewritten `taskLoopApi` case); 10 → Task 4 `noteCodes` + `metricsNotes`. "Every new branch gets a named deletion mutation seen red": each Task's Mutations step; all rerun at the gate (Task 12 Step 3).
   - §6.1 rewrites (H18), each named with its exact change: `tests/control/loopPlanSummary.test.ts` (deleted, cases carried), `tests/control/loopPlanView.test.ts` (one case), `tests/panel/taskLoopApi.test.ts` (one case), web fixtures in `loopPlanCard`, `loopBudgetRows`, `loopPlanDraft`, `loopPlanEdit`, `loopSuggestionApply`, `loopSuggestionDraft` (+ one expected value and one fixture spread in `loopPlanCard`) — Task 3; `tests/fixtures/metrics/golden.json` and `tests/panel/webParity.test.ts` (`reportWebToServer`, `coverageWebToServer`) — Task 4. Not rewritten, named: `web/tests/chainPanel.test.tsx`, `web/tests/taskLabels.test.tsx` and the other readers of exported English constants (F10). Eleven files in all.
   - §7 order: this plan runs after W5 web, W3b and W7 (all on `main` at `ac969bb`: `6a0917b`, `c60559c`, `c89481c`, `ac969bb`); the capture of `describeLoopPlan` (v1 and v2) is taken at `ac969bb` and re-taken by Task 3 Step 1 before the removal.
   - §8 re-checks: the scan (Task 1) and its backstop (Task 11); `verify-panel.ts` / `tests/panel/*` (F19); library behaviour at the lock file's versions (F20, re-measured by Task 2's criteria).
2. **Placeholder scan.** Every code step carries the code or an exact today → becomes replacement per site; every test step carries the test code; every command has its expected `rc` and what must be red. The drafter left no "handle appropriately" step. Two steps depend on a measurement the executor makes and records rather than a decision: the resolved versions in the lock file (Task 2 Step 1) and the base-commit comparison of the scan output (Task 1 Step 4).
3. **Type consistency across Tasks.** `initI18n(options?)`, `enumText(family, value)`, `currentLanguage()`, `readLanguage`/`writeLanguage`, `LANGUAGE_NAMES`, `PANEL_LANGUAGES` (Task 2) are used with those shapes in Tasks 3–11; `refusalText(refusal)` (Task 10) in `ErrorPage`, `Refusal`, `ControlPanel`; `planText(planId, version, part)`, `loopPlanTitle(plan)`, `loopSummaryLines(plan)` (Task 3) in `LoopPlanCard`, `ControlGroupView` and the Task 3/11 criteria; `LoopPlanViewV1` = `{ planId, planVersion, chosenBy, chosenByLabel, amended, loopVersion, inputs, maxFiles, hasDiscipline }` matches between `webProtocol.ts`, `controlTypes.ts`, `controlViews.ts`, the six web fixtures and the new criteria; `WEB_LOOP_PLANS` `{ planId, version }` between `controlTypes.ts`, `LoopPlanCard.tsx` (picker, draft validation reads `planId` only) and the §6.9 case; `MetricsNoteCode` and the four fields between `src/metrics/types.ts`, `src/panel/coverage.ts`, `web/src/types.ts` (optional), `webParity` and both criteria; `footerLines` (Task 2) and `retryNotice` (Task 9, exported) in Task 11. Every key a Task's code calls is defined in that Task's (or an earlier Task's) en block, with the same key in zh (the parity criterion runs in every Task's web check).
4. **Review Focus → criterion.** 1 empty `navigator.languages` → Task 2 `i18nDetect`; 2 stored value neither en nor zh → Task 2 `i18nDetect`; 3 missing plan-version key → Task 3 `loopSummary`; 4 refusal code with no Chinese entry / `toString` → Task 10 `refusalText`; 5 long Chinese in narrow places → Task 8 `i18nWidth` (+ Task 9).
5. **"An assertion placed before the tested call that reads back what the test itself just wrote" (Rule 9)** — scanned: the detection cases seed storage before the spy and assert on the spy's calls and the instance's resolution after `initI18n`; the switch case reads storage after the change event; the width and parity criteria read the resources, not values they wrote; the `loopPlanViewFields` schema case asserts the valid view parses before asserting the two refusals, so a schema that refuses everything cannot pass it.
6. **Predictions not verified by the drafter** — each is "unmeasured; stop and report if wrong":
   - U1 i18next's typed `t` over the full `as const` resource (about 600 keys) compiles without "type instantiation is excessively deep" and in reasonable time (the probe compiled a small resource only).
   - U2 i18next 26 accepts the interpolation objects exactly as written (no extra-parameter or missing-parameter type error for keys whose value has placeholders); `i18n.t(key as never) as string` and template-literal keys over unions (`` `enums.${family}.${value}` ``, `` `control.task.labelSource.${…}` ``, `` `decisions.kindHelp.${kind}` ``, `` `loopPlan.unit.${dimension}` ``, `` `chains.banner.${category}` ``) type-check.
   - U3 Every existing web test passes unmodified under the English setup (spec §6.1): the English values were copied from the code with JSX whitespace collapsed by hand; a single text node where there were several changes no `textContent`, and `renderToStaticMarkup` puts no separator between adjacent text nodes (probe), but existing criteria were not run against the converted components.
   - U4 `vi.resetModules()` plus a dynamic import of `../src/i18n.js` gives a fresh instance and `initReactI18next` rebinds it, so the dynamically imported `Shell` renders in the detected language (the probe measured the instance in separate processes, not under vitest).
   - U5 The golden's four insertions (Task 4) match `JSON.stringify(…, null, 2)` of the new objects: the new fields follow the sentence fields in each object literal.
   - U6 `webFixture` imports three loop tasks with disjoint target paths in one plan (Task 3 `loopPlanViewFields`).
   - U7 The width proxy's widths were computed by hand; the pseudo-locale criterion's `CHECKED` size (> 300) and the absence of fixture-data collisions were not run.
   - U8 The Task 11 allow-list is complete: every other `ui` row of the inventory is converted by Tasks 2–10 (the per-row owner column in Task 1 was produced by a rule the drafter wrote, then checked for unassigned rows: none).
   - U9 `npm install --workspace web …` resolves within the caret ranges to the measured versions or a newer minor; Task 2's criteria re-measure the behaviour either way.
