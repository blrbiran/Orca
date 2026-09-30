# Task 2 report — i18n instance, resources, detection, switch, shell

Implementer: Claude Opus 5.5 subagent of session `e604b1ba`, 2026-10-01. BASE `fdc7343`, local `main`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

Status: **DONE_WITH_CONCERNS** (concerns are minor; see the end).

## Commit

- `5d70ca5` feat(web): switch the panel between English and Chinese — 13 files, +491/−16. Message read back
  (`git log -1 --format=%B > $SCRATCH/t2-commit-msg.txt`): ends with exactly the two trailer lines. Pre-commit hook printed
  `ok: CLAUDE.md is 150/200 lines`.

## Built

Exactly the brief's Step 4, verbatim: `web/src/i18n.ts`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`, `web/tests/setup.ts`
were extracted from the brief by line range (sed) and are byte-for-byte the brief's blocks; `web/vite.config.ts` gains
`setupFiles: ["tests/setup.ts"]`; `main.tsx` calls `initI18n()` before `applyTheme`; `Shell.tsx` (NAV_KEY, Badge titles,
aria-label, brand title, theme label and options via `enumText`, the Language select, the two optional props, header line);
`App.tsx` (`useTranslation` import, `i18n`/`currentLanguage`/`writeLanguage` import, `ControlSummaryV1` type import, exported
`footerLines` after `pageHidden`, `const { t }` as App's first line, `shell.loading`, `footer={footerLines(summary)}`,
`language`/`onLanguage` props). Line numbers re-measured at HEAD before edits: `pageHidden` 122, `App` 132, loading 565, footer
620 — matched the brief. The three criteria files are the brief's blocks verbatim.

## Commands, outputs, results

| Step | Command (output file) | rc | Result |
|---|---|---|---|
| 1 | `npm install --workspace web i18next@^26.4.2 react-i18next@^17.0.15 i18next-browser-languagedetector@^8.2.1` (`t2-install.txt`) | 0 | "added 5 packages, audited 242"; npm prints 5 vulnerabilities (3 moderate, 1 high, 1 critical) — not investigated, see concerns |
| 1 | `git diff -- web/package.json` (`t2-pkg-diff.txt`) | 0 | adds exactly `"i18next": "^26.4.2"`, `"i18next-browser-languagedetector": "^8.2.1"`, `"react-i18next": "^17.0.15"` under `dependencies` |
| 1 | `git diff --stat -- package-lock.json` (`t2-lock-stat.txt`) | 0 | `package-lock.json | 90 +++…--`, 87 insertions, 3 deletions |
| 1 | lock-file versions via node over `package-lock.json` (`t2-lock-versions.txt`) | 0 | `node_modules/i18next 26.4.2`, `node_modules/i18next-browser-languagedetector 8.2.1`, `node_modules/react-i18next 17.0.15` |
| P15 | `tsc -p` over the assembled 505-key en/zh probe (`t2-p15-tsc.txt`, probe in `$SCRATCH/t2-p15/`) | 0 | Check time 0.36s, instantiations 199987; no TS2589 |
| P15 | same probe with zh `nav.metrics` deleted (`t2-p15-tsc-mut.txt`) | 2 | `TS2741: Property '"metrics"' is missing …` — the typing is live; probe restored (cmp rc=0) |
| 3 | three new criteria (`t2-red.txt`) | 1 | i18nKeys and i18nDetect: suite fails to load `../src/i18n.js`; i18nSwitch: "no language switch yet" |
| 5 | three new criteria (`t2-green.txt`) | 0 | 3 files, 15 tests passed |
| 5 | `npm run check --workspace web` (`t2-web-check.txt`) | 0 | tsc clean; **43 files / 217 tests passed** (40 existing files, unmodified, + 3 new) |
| 5 | `npm run typecheck` (`t2-tsc.txt`) | 0 | root tsc clean |
| extra | `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts` (`t2-scan-test.txt`) | 0 | Task 1 criterion still green (2 tests) |

P15 probe detail: `pf/res.json` (the preflight's flattened 505+505 keys from the plan's Tasks 2–10 blocks) re-nested into
`en.ts` (`as const`) and `zh.ts` (`Translation<typeof en>`), compiled with web's compiler options plus the brief's
`CustomTypeOptions` declaration, `createInstance` + detector + `initReactI18next` init, the `enumText` template-literal key,
`i18n.t` with interpolation, a template-literal `nav.${k}` key, a `useTranslation` component (with `import type { JSX }`), and a
`// @ts-expect-error` on an unknown key (which proves unknown keys do not compile; tsc would report TS2578 otherwise).
Probe limitation: the enum families are plain `as const` literals, not `as const satisfies Record<Union, string>` as the plan
writes them; the satisfies clause adds a check but no key-type depth.

## Mutations (clone `$SCRATCH/mut-t2`, `git clone --local` at fdc7343 + the 13 Task files copied, `t2-copy.txt` empty; clone baseline green `t2-clone-green.txt`)

Runner: `$SCRATCH/t2-mut.py` (exact string replace with a count==1 assert, run the criterion, restore by writing the repo
file's bytes, `cmp` into `t2-<M>-restore.txt`). Every restore: rc=0, 0 bytes.

| Mutation | Criterion run (file) | rc | Red seen |
|---|---|---|---|
| MT2-1 switch not wired | i18nSwitch (`t2-MT2-1-i18nSwitch.txt`) | 1 | `switches the page to Chinese and back…` — "Unable to find role="link" and name /决策/" |
| MT2-2 choice not remembered | i18nSwitch (`t2-MT2-2-i18nSwitch.txt`) | 1 | same test, `expected null to be 'zh'` at the storage assertion (line 46) |
| MT2-3 `<html lang>` not followed | i18nSwitch (`t2-MT2-3-i18nSwitch.txt`) | 1 | same test, `expected 'en' to be 'zh'` at `document.documentElement.lang` (line 47) |
| MT2-4 browser before choice | i18nDetect (`t2-MT2-4-i18nDetect.txt`) | 1 | `lets a stored zh beat … en-US` and `lets a stored en beat … zh-CN` (exactly these two) |
| MT2-5 detection persists | i18nDetect (`t2-MT2-5-i18nDetect.txt`) | 1 | `writes nothing while detecting…` (`expected 1 to be +0`); also `…touching localStorage at all throws` (the detector's cache write throws) |
| MT2-6 language not resolvedLanguage | i18nDetect (`t2-MT2-6-i18nDetect.txt`) | 1 | `resolves a zh-TW browser to zh…` — `[ 'zh', 'en' ]` |
| MT2-7 unguarded storage access | i18nDetect (`t2-MT2-7-i18nDetect.txt`) | 1 | `…touching localStorage at all throws` — SecurityError from `browserStorage` |
| MT2-8 unguarded read | i18nDetect (`t2-MT2-8-i18nDetect.txt`) | 1 | `…when reading storage throws` — SecurityError from `readLanguage` |
| MT2-9 nav not translated | i18nSwitch (`t2-MT2-9-i18nSwitch.txt`), i18nDetect (`t2-MT2-9-i18nDetect.txt`) | 1, 1 | switch: no link /Decisions/ (line 43); detect: 5 red incl. `lets a stored zh beat …` (no `决策`) |
| MT2-10 key parity | i18nKeys (`t2-MT2-10-i18nKeys.txt`) | 1 | `gives Chinese exactly the English keys…` — `nav.metrics` missing |
| MT2-11 placeholder dropped | i18nKeys (`t2-MT2-11-i18nKeys.txt`) | 1 | `keeps every placeholder…` — `shell.epoch: expected [] to deeply equal [ '{{epoch}}' ]` |
| MT2-12 unknown enum as key | i18nKeys (`t2-MT2-12-i18nKeys.txt`) | 1 | `shows a known value … unknown one as sent` — `'enums.theme.sepia'` |
| MT2-13 (added, P16) theme label not translated: `{t("shell.theme")}` → `Theme` | i18nSwitch (`t2-MT2-13-i18nSwitch.txt`) | 1 | same switch test, `…to contain '主题'` (line 49) |
| MT2-14 (added, new branch) delete `footerLines`' `if (summary === null) return [];` | i18nSwitch (`t2-MT2-14-i18nSwitch.txt`) | 1 | same switch test: App throws `Cannot read properties of null (reading 'epoch')`, no language switch rendered |

## Deviations and why

1. **MT2-10 edit text**: the brief says delete `metrics: "指标", ` from `nav`, but `metrics` is the last entry of `zh.nav`
   (`… metrics: "指标" },`), so that literal text does not exist. Applied `, metrics: "指标" }` → ` }` (same intent: the key is gone).
2. **MT2-5 anchor**: `caches: []` also occurs in i18n.ts's header comment, so the replacement anchored on `, caches: [] }`
   (the init option). The first runner pass stopped on the ambiguity before touching the file (the clone file was `cmp`-equal after).
3. **Two added mutations** (MT2-13, MT2-14) per P16 / "every new branch".
4. **Rule 14 reading**: for the two long outputs (`t2-MT2-1-i18nSwitch.txt` 1545 lines, `t2-MT2-9-i18nSwitch.txt` 1392 lines)
   I read the head (failing test name and message) and the tail (assertion location and totals); the middle is the jsdom DOM dump.
   Every other output file was read whole.

## New t/enumText sites and branches without a mutation seen red (P16)

- Badge titles `shell.chainRunning`, `shell.needsAttention`; `aria-label={t("nav.sections")}`; `title={t("shell.brandTitle")}`;
  `t("shell.language")` label; `enumText("theme", pref)` in the theme options (the function is pinned by MT2-12, the call site is
  not); `t("shell.loading")` in App. No criterion of this Task asserts these in Chinese; replacing them with the English literal
  keeps every criterion green. (`footerLines`' text is Task 11's pseudo-locale criterion per the brief.)
- Branches: `initI18n`'s `if (i18n.isInitialized) return i18n;`, the `options.lng` spread, `writeLanguage`'s catch,
  `syncHtmlLang`'s `typeof document` guard, `props.language ?? "en"`, `currentLanguage`'s `"en"` arm. Not mutated; I expect
  them green-under-deletion with the current criteria (not measured).

## Concerns

- npm reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) after the install; I did not check whether they predate
  this install or come from the 5 added packages.
- Mutation clone `$SCRATCH/mut-t2` and probe dir `$SCRATCH/t2-p15` are kept (P10: deletion needs the human).

---

## Fix round 1/5 (review `task-2-review.md`, Important 1) — same implementer, 2026-10-01, on top of `5d70ca5`

Controller ruling: one criterion per unpinned branch of `web/src/i18n.ts` (MT2-15..17), each seen red under its deletion mutation
in `$SCRATCH/mut-t2` (clone re-synced from the repo: `t2f-copy.txt` empty; then `t2f-copy2.txt` empty after the MT2-17 rewrite).
Runner `$SCRATCH/t2-mut.py` extended with MT2-15..17 (same replace/run/restore/cmp shape).

Criteria added (tests only; no source change):
- `web/tests/i18nSwitch.test.tsx`: `still switches when this browser refuses to store the choice (…)` — reviewer's probe, with
  `setItem` throwing `QuotaExceededError`; also asserts `<html lang>` = zh. `afterEach` now also runs `vi.restoreAllMocks()` so the
  spy cannot leak on failure (the probe restored inside the test body).
- `web/tests/i18nDetect.test.tsx`: helper `freshI18n(languages)` (reset modules, override `navigator.languages`/`language` via the
  file's existing `override`, restored in `afterEach`); `lets an explicit lng beat a Chinese browser, so web criteria render English
  on any machine (…)`; `initialises once: a second initI18n does not re-detect and undo a language chosen since the first`.

| Mutation | Criterion (file) | rc | Red seen |
|---|---|---|---|
| MT2-15 `writeLanguage` try/catch removed | i18nSwitch (`t2-MT2-15-i18nSwitch.txt`, 1604 lines; head+tail read, middle is the DOM dump) | 1 | the new case: `Unable to find role="link" and name /决策/`; uncaught `QuotaExceededError ❯ writeLanguage src/i18n.ts:50 ❯ onLanguage src/App.tsx:633` |
| MT2-16 `...(options.lng === undefined ? {} : { lng: options.lng }),` deleted | i18nDetect (`t2-MT2-16-i18nDetect.txt`) | 1 | `lets an explicit lng beat a Chinese browser…` — `expected 'zh' to be 'en'` |
| MT2-17 `if (i18n.isInitialized) return i18n;` deleted | i18nDetect (`t2-MT2-17-i18nDetect.txt`) | 1 | `initialises once…` — `expected 'zh' to be 'en'` |

All three restores: `cmp` rc=0, 0 bytes.

**Deviation — MT2-17's case differs from the review's proposal.** The proposed shape (`initI18n({ lng: "en" })` then `initI18n()`)
stayed green under the guard's deletion (first run: rc=0, 12/12, recorded in `t2-MT2-17-i18nDetect.txt` before it was overwritten
by the rerun; summary line in `t2f-mut-summary.txt`). Cause, read in `node_modules/i18next/dist/esm/i18next.js:1802-1805`: `init`
builds `this.options = { ...defOpts, ...this.options, ...transformOptions(options) }`, so a re-init keeps the earlier `lng: "en"`. A
re-init only re-detects when the first init had no `lng`, so the case is now: fresh module under a zh-CN browser, `initI18n()`,
`changeLanguage("en")`, `initI18n()` → still `en`. That red is the one in the table (`t2f-mut-summary2.txt`).

Runs:
- new criteria green: `t2f-green.txt` (rc=0, i18nDetect 12 + i18nSwitch 2); `t2f-detect-green.txt` after the rewrite (rc=0, 12).
- `npm run check --workspace web` → `t2f-web-check.txt` rc=0: tsc clean, **43 files / 220 tests passed**.
- `npm run typecheck` → `t2f-tsc.txt` rc=0.
- extra: `LC_ALL=zh_CN.UTF-8 LANG=zh_CN.UTF-8 npm run check --workspace web` → `t2f-web-check-zh.txt` rc=0, 43 / 220. The suite
  stays English on a zh locale (the reviewer's B2 locale scenario).

Correction to my earlier report: its "branches … I expect them green-under-deletion (not measured)" was wrong for the
`typeof document` guard (the reviewer measured it red: 18 suites) and moot for `props.language ?? "en"` and `currentLanguage`'s arm
(equivalent mutants per the review). Review Minors 1–3 were not addressed in this round (not in the ruling).
