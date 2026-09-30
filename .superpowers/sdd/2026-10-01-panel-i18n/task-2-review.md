# Task 2 review — fdc7343..5d70ca5

Reviewer: Claude Opus 5.5 task-reviewer subagent of session `e604b1ba`, 2026-10-01, read-only on `/Users/biran/code/skills/loop/Orca`
(HEAD `5d70ca5`, clean before and after: `git status --porcelain` → 0 lines). Mutations only in my clone
`$SCRATCH/rev-t2` (`git clone --local` at `5d70ca5`, rc=0; node_modules symlinked; kept per P10).
`SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.
Inputs: `task-2-brief.md`, `task-2-report.md`, `review-fdc7343..5d70ca5.diff` (read whole), `global.md`.

## Spec Compliance

- ✅ Spec compliant. Every item of the brief's Step 4 is in the diff, matching the brief's blocks: `web/src/i18n.ts` (diff 549-641),
  `locales/en.ts` (647-673), `locales/zh.ts` (679-703, `zhErrors` empty), `tests/setup.ts` (958-969), `vite.config.ts:14` `setupFiles`
  (986), `main.tsx` `initI18n()` before `applyTheme` (712, 724), `Shell.tsx` (NAV_KEY 459, Badge titles 485-486, aria-label 507,
  brand title 508, theme label + `enumText` options 524-527, Language select 530-535, two optional props 496-498, header line 447),
  `App.tsx` (imports 310/333/338, `footerLines` 360-364, `const { t }` 375, loading 398, footer 421, `language`/`onLanguage` 423-427).
  The three criteria files are the brief's blocks. `web/package.json` adds exactly the three caret ranges (279-284); the lock pins
  i18next 26.4.2, i18next-browser-languagedetector 8.2.1, react-i18next 17.0.15 (89-173), matching the report. Global Constraints
  checked: `initAsync:false`, `fallbackLng:"en"`, `supportedLngs` en/zh, `load:"languageOnly"`, `escapeValue:false`, `caches: []`
  (626-631); `currentLanguage` reads `resolvedLanguage` (608); no plural key; no key takes `count`; English values byte-identical to the
  removed literals (458↔661, 483-484↔664-665, 505-506↔661/663, 397↔668, 420↔669/671). Lock side-effects (`@babel/runtime` loses
  `dev`, `typescript` → `devOptional`) are correct consequences of the new runtime/peer deps.
- ⚠️ Cannot verify from diff: the P15 probe (`$SCRATCH/t2-p15/`) and the MT2-1..14 outputs live in scratch, not in the diff; I did not
  re-run them (the report cites file names and messages). The pinning of the seven t/enumText sites is Task 11's (see Minor 1);
  the controller should confirm Task 11's MT list actually exercises the `nav and shell footer` area as written.

## Strengths

- The implementation is the brief's text with no drift; deviations (MT2-10 edit text, MT2-5 anchor) are named with reasons.
- 14 mutations seen red, including two the brief did not ask for (MT2-13 theme label, MT2-14 `footerLines` null guard).
- P15 probe has its own red (TS2741 on a deleted zh key), so "typing 505 keys compiles" is a measured claim, not a hope.
- The report lists its unpinned sites and branches instead of hiding them (Rule 12).

## P16 judgement — the seven sites and six branches

Measured in `$SCRATCH/rev-t2`, criterion = `npm run check --workspace web` (tsc + all 43 web files), baseline `rev-t2-baseline.txt`
rc=0, 43 files / 217 tests. Runner `$SCRATCH/rev-t2-mut.py` (exact replace, count==1 asserted, restore by the repo file's bytes,
`cmp` rc=0 and 0 bytes for every restore).

| Branch (deletion) | rc | Output | Verdict |
|---|---|---|---|
| B1 `if (i18n.isInitialized) return i18n;` (i18n.ts:616) deleted | 0 | `rev-t2-B1.txt` 217/217 | **unpinned** |
| B2 `...(options.lng === undefined ? {} : { lng })` (i18n.ts:624) deleted | 0 | `rev-t2-B2.txt` (en locale, overwritten; read before overwrite) 217/217 | **unpinned on an English host**; with `LC_ALL=LANG=zh_CN.UTF-8` rc=1: `App.test.tsx > App > renders the placeholder markup` — `expected '<main>orca 面板加载中…</main>' to contain 'orca panel'` (`rev-t2-B2-zhlocale.txt`; HEAD under the same locale rc=0, `rev-t2-baseline-zhlocale.txt`). Node 22.13.1 `navigator.language` is `zh-CN` under that locale (`rev-t2-node.txt`). |
| B3 `writeLanguage`'s try/catch (i18n.ts:599-603) removed | 0 | `rev-t2-B3.txt` 217/217 | **unpinned, and observable in production** (below) |
| B4 `typeof document !== "undefined"` guard (i18n.ts:612) removed | 1 | `rev-t2-B4.txt`: 18 suites fail, `ReferenceError: document is not defined ❯ syncHtmlLang src/i18n.ts:63` | pinned — the report's "expect green" was wrong |
| B5 `props.language ?? "en"` → `props.language` (Shell.tsx:532) | 0 | `rev-t2-B5.txt` 217/217 | equivalent: an uncontrolled select shows its first option, English, the same as `"en"` |
| B6 `resolvedLanguage === "zh" ? "zh" : "en"` → `resolvedLanguage as PanelLanguage` (i18n.ts:608) | 0 | `rev-t2-B6.txt` 217/217 | equivalent in reachable states (`supportedLngs` en/zh, callers run after init); changing the arm's value (`: "zh"`) is red by the detect criteria' `htmlLang` "en" |

B3 probe (my clone only, saved as `$SCRATCH/rev-t2-probe-i18nSwitch.test.tsx`): one extra case in `i18nSwitch` that makes
`Storage.prototype.setItem` throw after the switch has rendered, then chooses 中文 and waits for the `决策` link.
HEAD: rc=0, 2/2 (`rev-t2-probe-head.txt`). With B3: rc=1, `× … REVIEW PROBE: still switches when this browser refuses to store the
choice`, `Error: QuotaExceededError ❯ writeLanguage src/i18n.ts:50 ❯ onLanguage src/App.tsx:633` (`rev-t2-probe-B3.txt`, 1604 lines;
head and tail read, the middle is the jsdom DOM dump — same limitation the implementer disclosed). Restore `cmp` rc=0, 0 bytes; clone
test file restored from the repo.

Sites: none of the seven is asserted by a Task 2 criterion. Rendered in Chinese by `i18nDetect`/`i18nSwitch` but unasserted:
`aria-label={t("nav.sections")}`, `title={t("shell.brandTitle")}`, `t("shell.language")`, `enumText("theme", pref)`. Never rendered in
Chinese here: the two Badge titles (every fixture has `chainRunning:false`, `controlAlert:false`), `t("shell.loading")` (App starts in
English; `App.test.tsx:13` pins only the English text). Task 11's `i18nPseudo` "nav and shell footer" area renders `Shell` with
`chainRunning:true, controlAlert:true, language="zh"` and `leftovers()` reads text plus `title`/`aria-label` (plan lines 4610-4614,
4705-4707), which pins six of them; `shell.loading` is covered only by the scan backstop against a literal.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

1. **Three new branches are deletable with every web criterion green — `web/src/i18n.ts:599-603` (writeLanguage catch), `:616`
   (isInitialized guard), `:624` (the `lng` option).** Global Constraints: "Every new branch gets a named deletion mutation seen red
   (Rule 9, spec §6 last line)"; the controller ruled the same shape Important-and-fix in Task 1. Partly plan-mandated (the brief's
   criteria do not reach them), which does not lower it.
   - B3 is a user-visible defect guard: `App.tsx:425-426` calls `writeLanguage` *before* `i18n.changeLanguage`, so without the catch a
     browser whose `setItem` throws (quota, blocked storage) gets a Language switch that does nothing. The probe above is a ready
     criterion: add it to `web/tests/i18nSwitch.test.tsx` (restore the spy in the test), name it MT2-15.
   - B2 carries spec §6.1's "every web criterion renders in English": `tests/setup.ts:8` only holds that because `lng:"en"` beats
     detection; today it is invisible because this host's locale is English. Pin in `i18nDetect`: fresh module, `navigator.languages =
     ["zh-CN"]`, `initI18n({ lng: "en" })` → `resolvedLanguage` `"en"` (MT2-16: delete the spread, red).
   - B1: same fresh module, then a second `initI18n()` → still `"en"` (MT2-17: delete the guard; the re-init re-detects `zh`, red).
   All three cases reuse `detect()`'s overrides; none touches real storage (Rule 17).

### Minor (Nice to Have)

1. Seven t/enumText sites (`Shell.tsx:485, 486, 507, 508, 531, 527`; `App.tsx:398`) have no deletion mutation in this Task; six are
   pinned by Task 11's pseudo-locale area, `shell.loading` only by the scan backstop against a literal (a swap to `en.shell.loading`
   would pass both). Cheap now: in `i18nSwitch`, after switching, also assert `语言` and `深色` (pins `shell.language` and the
   `enumText` call site).
2. `web/tests/i18nKeys.test.ts:886` — `expect(enumText("theme","dark")).toBe("dark")` cannot tell "translated" from "shown as sent"
   (the English value equals the key); the Chinese assertions below carry the test. Not vacuous overall.
3. Report, "branches … I expect them green-under-deletion (not measured)": B4 is red (18 suites), B5/B6 are equivalent mutants. A
   prediction in a report should be measured or dropped (Rule 12/14); the table above now measures all six.

## Assessment

**Task quality:** Needs fixes

**Reasoning:** The code is the brief's text and 14 mutations are seen red, but three new branches in `i18n.ts` survive deletion,
one of which (the `writeLanguage` catch) guards a switch that would otherwise go dead on a storage-refusing browser; each has a
ready one-case criterion above.

## Re-review (fix round 1)

Re-reviewer: Claude Opus 5.5 scoped re-review subagent of session `e604b1ba`, 2026-10-01, read-only on the repo (HEAD `545f881`,
`git status --porcelain` → 0 lines). Inputs: `task-2-brief.md`, fix report at the end of `task-2-report.md`,
`review-5d70ca5..545f881.diff` (read whole). Mutations only in `$SCRATCH/rerev-t2` (`git clone --local` at `545f881`, rc=0;
node_modules symlinked, the only untracked entries). Runner `$SCRATCH/rerev-t2-mut.py` = `rev-t2-mut.py` with the clone path and
output prefix changed (same exact-replace, count==1, restore-from-repo-bytes, `cmp`). Criterion `npm run check --workspace web`.
Baseline `rerev-t2-baseline.txt` rc=0, 43 files / 220 tests.

### Finding Verdicts

- **B3 `writeLanguage` try/catch (`web/src/i18n.ts:50-54`) deletable green** — ADDRESSED. Criterion `web/tests/i18nSwitch.test.tsx`
  "still switches when this browser refuses to store the choice"; spy restored by `afterEach` `vi.restoreAllMocks()`. Deletion:
  `rerev-t2-B3.txt` rc=1, 1 failed / 219 passed, `× … still switches when this browser refuses …` → `Unable to find role="link"
  and name /决策/`, uncaught `QuotaExceededError`. Restore `cmp` rc=0, 0 bytes.
- **B2 `lng` option spread (`web/src/i18n.ts:75`) deletable green** — ADDRESSED. Criterion `web/tests/i18nDetect.test.tsx` "lets an
  explicit lng beat a Chinese browser …". Deletion: `rerev-t2-B2.txt` rc=1, 1 failed / 219, `expected 'zh' to be 'en'`. Now red on
  an English host (previously only under a zh locale). Restore `cmp` rc=0, 0 bytes.
- **B1 `isInitialized` guard (`web/src/i18n.ts:67`) deletable green** — ADDRESSED. Criterion `i18nDetect` "initialises once: a second
  initI18n does not re-detect …" (init without lng → `changeLanguage("en")` → re-init). Deletion: `rerev-t2-B1.txt` rc=1, 1 failed /
  219, `expected 'zh' to be 'en'`. Restore `cmp` rc=0, 0 bytes. The rewrite away from my proposed shape is accepted: its stated
  cause (i18next `init` merges the earlier `this.options`, so a first `lng:"en"` survives the re-init) is consistent with the
  proposed shape being green; the replacement case asserts after the call under test and reads a value the test did not write.

### New Breakage in the Fix Diff

None. Tests-only diff; `freshI18n` reuses the file's `override` (restored in `afterEach`) and resets modules per case; the
`Storage.prototype.setItem` spy cannot leak past its case.

### Out-of-Scope Observations

None new. Review Minors 1-3 remain open (not in the ruling), as the fix report states.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
