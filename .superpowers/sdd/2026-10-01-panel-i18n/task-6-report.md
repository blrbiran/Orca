# Task 6 report: the chains area, and the switch's helper-built case

Implementer: Task 6 subagent, session `e604b1ba` round, 2026-10-01. BASE 1d036e2. Commit: `4ff8d23` (on local `main`).
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

## Status: DONE

## What was built

- `web/src/locales/en.ts`: `ChainStopCategory` type import; `chainStopCategory` and `chainBanner` consts
  (`satisfies Record<ChainStopCategory, string>`); `chains` area placed after `decisions` (before `loopPlan`), values
  byte-identical to the brief's table; `enums.chainStopCategory`.
- `web/src/locales/zh.ts`: `chains` area and `enums.chainStopCategory`, values verbatim from the brief.
- `web/src/chainBanner.ts`: `BANNER_TEXT = en.chains.banner` (still exported, English, ruling F10); `bannersFor` text is
  `i18n.t(\`chains.banner.${category}\`)` at call time.
- `web/src/ChainPanel.tsx`: `chainStateText` / `costText` / `progressText` through `i18n.t` (signatures unchanged; the
  category via `enumText("chainStopCategory", …)`, a missing reason or category reads `common.unknown`); `ChainBanners`
  and `ChainPanel` use `useTranslation()` for every literal the brief lists.
- `web/src/App.tsx`: `Chains have not loaded.` → `t("chains.notLoaded")` (at HEAD this is line 645, not 630).
- `web/tests/chainsI18n.test.tsx` (new), `web/tests/i18nSwitch.test.tsx` (one `it` added after the first).
- `web/tests/chainPanel.test.tsx` not touched (F10); it stays green.

## Runs (all `> file 2>&1; echo rc=$?`, each file read whole)

| Run | Command | Output file | rc |
|---|---|---|---|
| red | `(cd web && ../node_modules/.bin/vitest run tests/chainsI18n.test.tsx tests/i18nSwitch.test.tsx)` | `t6-red.txt` | 1 |
| green | `(cd web && ../node_modules/.bin/vitest run tests/chainsI18n.test.tsx tests/i18nSwitch.test.tsx tests/chainPanel.test.tsx)` | `t6-green.txt` | 0 (3 files, 14 tests) |
| web check | `npm run check --workspace web` | `t6-web-check.txt` | 0 (tsc clean; 47 files, 272 tests) |

Red before (`t6-red.txt`): `chainsI18n` cases 1 and 2 red on the English state text (`stopped: r-1 (limit)`,
`stopped: unknown (unknown)`); `i18nSwitch … > re-renders a helper-built string too …` red with
`'Chain finished acme-alpha: r-1Got it'` not containing `链已完成`; the two Task 2 cases green. The third chainsI18n
case (not-loaded) was red at that point for a wrong reason (my first fetch stub refused `/api/todo`, so the page showed
its load-error page); I fixed the stub (todo + metrics answered as in `i18nSwitch`, `/api/chains` never answers), and
its red-for-the-right-reason evidence is MT6-5 below (English `Chains have not loaded.` rendered, criterion red).

The first green run was rc=1 because of my own added assertion (attribute order of `<input>` in static markup:
React emits `type… name` last); I corrected the three expected strings to the rendered order, then rc=0.

## Mutations (clone `SCRATCH/mut-t6`, `git clone --local`; copy check `t6-copy.txt` empty; script `t6-mutate.py`, summary `t6-mutations.txt`)

Each: exact edit in the clone, named criterion run into `t6-<id>.txt` (read whole), restore by `cat` + `cmp` into
`t6-<id>-restore.txt` (every one empty, rc=0). Final `cmp` of all seven Task files clone vs repo: `t6-clone-final-cmp.txt` empty.

| Id | Edit (site back to raw English) | rc | Red test(s) seen |
|---|---|---|---|
| MT6-1 | banner `i18n.t(\`chains.banner.…\`)` → `BANNER_TEXT[c.stop.category]` | 1 | i18nSwitch `re-renders a helper-built string too …` (`Chain finished …知道了`); chainsI18n cases 1, 2 (`Chain stopped at a limit`) |
| MT6-2 | `enumText("chainStopCategory", …)` → `chain.stop.category` | 1 | chainsI18n 1, 2 (`已停止：r-1（limit）`) |
| MT6-3 | `i18n.t("chains.costUnreadable")` → `"cost unreadable"` | 1 | chainsI18n 1, 2 |
| MT6-4 | `t("chains.stopRequested", …)` → English template | 1 | chainsI18n 1, 2 |
| MT6-5 | App `t("chains.notLoaded")` → `Chains have not loaded.` | 1 | chainsI18n 3 (`says the chains have not loaded in Chinese …`) |
| MT6-6 | `<h2>` title → `Chains` | 1 | chainsI18n 2 (`<h2>链</h2>`; case 1's `"链"` stays green — the weak check the addition exists for) |
| MT6-7 | noChain → `No chain yet.` | 1 | chainsI18n 1, 2 |
| MT6-8/9/10/11 | `<dt>` Goal / By / Progress / State → English | 1 each | chainsI18n 2 (and 1 for By) |
| MT6-12 | stop button → `Stop chain` | 1 | chainsI18n 1, 2 |
| MT6-13 | stopsAfter → English | 1 | chainsI18n 1, 2 |
| MT6-14..18 | form labels Repository / Goal / Max sessions / Max cost / Session timeout → English | 1 each | chainsI18n 2 (and 1 for timeout) |
| MT6-19 | start button → `Start chain` | 1 | chainsI18n 1, 2 |
| MT6-20 | started outcome → English template | 1 | chainsI18n 2 |
| MT6-21 | gotIt → `Got it` | 1 | chainsI18n 1, 2 |
| MT6-22 | stateStopped → English template (parts still translated) | 1 | chainsI18n 1, 2 (`stopped: r-1 (触达上限)`) |
| MT6-23 | stateRunning → `"running"` | 1 | chainsI18n 1, 2 |
| MT6-24 | stateOrphaned → English | 1 | chainsI18n 1 |
| MT6-25 | sessionProgress → English template | 1 | chainsI18n 1, 2 |
| MT6-26 | missing reason → `"unknown"` | 1 | chainsI18n 2 (`已停止：unknown（未知）`) |
| MT6-27 | missing category → `"unknown"` | 1 | chainsI18n 2 (`已停止：未知（unknown）`) |
| MT6-28 | `chains.cost` → `` `USD ${…}` `` | **0** | none — expected, see below |

## Deviations and why

1. **Criteria added beyond the brief's text** (dispatch's last bullet): chainsI18n gains two `it`s — per-node exact
   assertions (tag-bounded strings in the static markup) for every site, the `stop: null` → `已停止：未知（未知）`
   branch, `costText(1.5)`, the `started` outcome, and an App-level case for `chains.notLoaded` (rendered in jsdom
   with `/api/chains` never answering). The brief's own `it` is kept verbatim apart from deviation 2.
2. **Fixture repo keys** `repo-one/two/three` → `acme-alpha/beta/gamma` in both new fixtures, per the dispatch's
   ruling P2 note (avoid repo/ready/plan in fixture values). Other fixture values (`g-1`, `amy`, `cli`, `r-1`,
   `chain-0000000b`) contain none of those words.
3. **`// @vitest-environment jsdom`** added to `chainsI18n.test.tsx` (needed for the App case; `renderToStaticMarkup`
   works unchanged under jsdom). The file copies `i18nSwitch`'s `METRICS` constant verbatim (comment says so).
4. App site measured at line 645 at HEAD, not 630 as the brief says.

## Sites judged unobservable

- `chains.cost` (`USD {{amount}}`): the English and Chinese values are identical, so putting the raw English template
  back changes no rendered byte in either language (MT6-28 green, as predicted). The interpolation itself is pinned by
  `costText(1.5) === "USD 1.50"` and `<dd>第 2 个会话；USD 1.50</dd>`.

## Concerns

- None blocking. Clone `SCRATCH/mut-t6` is kept (deleting needs the human).
