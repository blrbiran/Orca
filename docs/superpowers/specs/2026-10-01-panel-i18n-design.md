# Panel languages (English / Chinese) — design

Session `e604b1ba` (controller), 2026-10-01, on Orca `main` after `97b39e6`. Revision 2, after an independent
review (§9). Ledger: `.superpowers/sdd/2026-10-01-loop-plans-followups/progress.md` (H5, H13, H17).

## 0. What this builds

Every piece of text the Orca web panel shows can be read in English or Chinese. The language follows the browser
by default; a manual choice is remembered in that browser. English stays byte-identical to today's panel.

### 0.1 Not in this design

- Terminal output of `orca panel` (the ready line on stdout, the hint on stderr) and every CLI string, including
  `orca metrics` output.
- Content that is data, not UI: ledger decision text, evidence, task goals and inputs typed by a person, ids,
  paths, check commands, model names, repo keys, error **codes**, and the two dynamic error texts named in §3.4.
- A third language (the structure allows one; nothing here builds it).
- Server-side language negotiation: the server never learns the viewer's language.

## 1. Rulings (human's words quoted)

| # | Question | Ruling |
|---|---|---|
| L1 | Should the panel's language be switchable | "面板文案在 Orca 的 web UI 上要可以选择，可以切换"; supersedes R-F5's "the panel speaks English" as the only language, not its English strings |
| L2 | Default and memory | "跟浏览器语言，手动切换按浏览器记住" |
| L3 | Scope | "整个面板的界面文案" |
| L4 | Mechanism | "走标准的 i18n 方案不行吗？" → "好，就用 react-i18next" |
| L5 | The four design sections presented in the conversation | "其他都同意。写spec吧" |
| L6 | Review before the human reads it | "需要你启动一个 subagent review spec" (done, §9) |

Consequence of L4: the loop-plan summary is no longer built as English sentences on the server (loop plans spec
C7). The server sends fields; the panel translates (§3.1). The correction to C7 is recorded as a new section at the
end of `docs/superpowers/specs/2026-09-30-loop-plans-design.md`, not as an edit of C7 (Rule 13).

## 2. Structure

- Dependencies (web workspace only): `i18next`, `react-i18next`, `i18next-browser-languagedetector`, with caret
  ranges like the workspace's other dependencies (Rule 11); the lock file pins them. Bundled by vite; nothing is
  fetched at run time.
- `web/src/i18n.ts` exports the shared instance and `initI18n(options?: { lng?: string })`: `initReactI18next`, the
  detector (§4), resources imported statically from `web/src/locales/en.ts` and `zh.ts`, `initAsync: false`
  (inline resources make init synchronous in any case), `fallbackLng: "en"`, `supportedLngs: ["en", "zh"]`,
  `load: "languageOnly"`, `interpolation.escapeValue: false` (React escapes). `main.tsx` calls `initI18n()`;
  the web test setup calls `initI18n({ lng: "en" })`.
- Keys are grouped by panel area: `nav`, `shell`, `decisions`, `chains`, `control`, `budget`, `loopPlan`,
  `agents`, `metrics`, `recovery`, `enums`, `common`, `panelErrors`. The `errors` namespace is Chinese-only
  (§3.2).
- Typing: `en.ts` is the source shape (`as const`). `zh.ts` has the type `Translation<typeof en>` — the same key
  set, every value widened to `string`. **Chinese carries the `_one` plural keys too** (with the same text as
  `_other`), so the two key sets are exactly equal and a missing Chinese key is a compile error.
  `CustomTypeOptions.resources` is declared from `en`, so an unknown key is a compile error.
- Components use `useTranslation()` (it re-renders them on a language change). **Helpers keep their current
  signatures** and translate through the shared instance (`i18n.t`); since every helper is called during a render
  of a component that uses `useTranslation`, a language change reaches them. Module-level English constants
  (`BANNER_TEXT`, `Shell`'s `LABELS`, `FIELD_LABEL`, `BAD_BUDGET`, `BAD_FILE_CAP`, `WEB_LOOP_PLANS[].name`) become
  key maps or lookups at call time; the criteria that read them are named in §6.1.
- Plurals: English `_one` / `_other` (the loop plans round's P1 singular forms), Chinese both keys, same text.
- **The English resource reproduces today's strings byte for byte.**

## 3. Text that is not a JSX literal today

The plan's first task lists every rendered text source by a code scan that prints each site (not `grep`), and
classifies each one. §9's review found the following; the plan's scan must find at least these.

### 3.1 Loop plan view

`WorkItemViewV1.loopPlan` drops `planName` and `summary`:

```
{ planId, planVersion, chosenBy, chosenByLabel, amended, loopVersion, inputs, maxFiles, hasDiscipline }
```

- `maxFiles` is the expanded contract's `safetyPolicy.maxFilesTouched` (it differs from `inputs` for
  `investigate`); the check count is `inputs.checks.length`, already on the view.
- The panel builds keys itself: `loopPlan.plan.<planId>.v<planVersion>.name` and `….discipline` (when
  `hasDiscipline`). **Both are versioned**, so a v2 rename or rewording never retitles a v1 task.
- The server registry keeps `name` and `discipline` (`src/control/loopPlans.ts`) as the **English source of
  record** and the anchor of the loop plans rule "any change to a plan's text adds a version". A criterion (§6.9)
  iterates the registry: for every (planId, version) the English resource's name/discipline equal the registry's
  text and the Chinese resource has both keys. `WEB_LOOP_PLANS[].name` is removed; the picker uses the key.
- The panel builds the summary lines with `t`; English output equals today's `describeLoopPlan` output for every
  plan and version (§6.3). `describeLoopPlan` is removed; `recipeExpandsTo` does not call it.
- The server's strict view schema (`src/control/webProtocol.ts`), the web mirror (`web/src/controlTypes.ts`) and
  the parity criterion change together.

### 3.2 Refusal messages

The response keeps `code` and `message` unchanged. The panel shows:

- English: `message` as sent — byte-identical to today (`Refusal.tsx:29`, `ControlPanel.tsx:168`).
- Chinese: `errors.<code>` when the Chinese `errors` namespace has it, else `message` as sent. The code is always
  shown (`data-testid="refusal-code"`), so a fallback is visible, not silent.
- The `errors` namespace exists only in Chinese and is excluded from key parity (§6.2) and typed separately
  (`Record<string, string>`).
- Coverage (§6.4) is mechanical for the codes with a machine-readable source: every code of `controlErrorCatalog`
  (`src/panel/controlErrors.ts`) and every code the web itself makes (`http-<n>` as one entry `http-status`,
  `http-unreachable`, `panel-unreachable`, `command-result-invalid`, and any the §3 scan finds). Inline server
  codes without a catalog (`src/panel/api.ts`: `decision-not-found`, `panel-bad-request`, `panel-internal-error`,
  correction rejections; chains: `chain-args-invalid`, `chain-start-failed`, `chain-start-timeout`,
  `repo-not-found`) get Chinese entries listed by hand in the plan; a code with no entry falls back as above.

### 3.3 Panel-made sentences

These are the panel's own text and are keyed like any JSX literal (English value = today's text):
`retryNotice` and the footer `epoch … / dispatch blocked|live` (`App.tsx`), `chainStateText` / `costText` /
`progressText` (`ChainPanel.tsx`), `progressText` (`TaskDetail.tsx`), `provenanceText` (`BudgetEditor.tsx`),
`consequenceOf` (`LoopPlanCard.tsx`), `contextLabel` and `LabelChips` "none" (`AgentFields.tsx`), `ErrorPage`'s
"answered N", and the web-made refusal messages (`api.ts` `` `${what} answered ${status}` ``,
`controlApi.ts` "never answered" / "may not have committed this command" / "The panel answered without a command
outcome.").

### 3.4 Server sentences about data

| Field | Source | Change |
|---|---|---|
| metrics `review_coverage.reason`, `correction_rate.caveats`, `repair_rate.caveats`, `repair_rate.stale_only.known_bias` | constants in `src/metrics/compute.ts` | server adds a stable code beside each sentence (`reasonCode`, `caveatCodes`, `knownBiasCode`) — additive, the sentences stay for the CLI; the panel shows `metrics.note.<code>` and falls back to the sentence |
| coverage `caveat` | `src/panel/coverage.ts` | same: an added `caveatCode` |
| chain `problem` | an `Error.message` (`src/panel/chains.ts`) | shown as sent (dynamic) |
| panel-unreachable detail | a browser `Error.message` (`api.ts`) | shown as sent (dynamic) |

### 3.5 Enum values rendered raw

Every family below is displayed through `enums.<family>.<value>`, keyed by a `Record` over the value union so a
new value is a compile error; English value = today's raw text; `data-*` attributes and control values keep the raw
value. Families: group `state`, `stopMode`, `stopState`, work item `status`, run `phase` / `state`, request
`state`, estimate `state` / `mode` / `reasonCode`, proposal `state`, allocation `ownerKind` / `bucket` / `state`,
task `complexity`, `handoffControl`, progress `step`, evidence `kind`, field provenance, agent row `kind`, chain
state, blocker `scope`, theme names. The plan's scan adds any it finds.

## 4. Detection and switch

- Detector order: `localStorage` key `orca.panel.lang` (same naming as `orca.panel.theme`), then
  `navigator.languages`, first supported match: `zh`, `zh-CN`, `zh-TW`, `zh-Hans`… match `zh`; a browser list
  with no Chinese entry resolves to `en` (`["fr", "zh-CN"]` resolves to `zh`).
- The detector never persists a language (`caches: []`): its cache would also fire on the initial detection and
  freeze today's browser language as a choice, breaking L2. (Its storage probe writes and removes a test key; that
  is not a persisted language.) The switch writes `orca.panel.lang` itself, wrapped like `writeTheme`. Storage that
  is missing or throws leaves the panel working: detection falls back to the browser, a lost choice costs one click.
- The panel reads `i18n.resolvedLanguage` (not `i18n.language`, which stays `zh-TW` for a Taiwanese browser) for
  the switch's value and for `<html lang>`, which is set after init and on every change (`web/index.html` ships
  `lang="en"`).
- Switch: a `Language` select in the sidebar footer beside `Theme`, options `English` / `中文` (each named in its
  own language, not translated).

## 5. Chinese wording

The controller drafts `zh.ts`; the human reviews it before the round closes (a task in the plan). Terms:

| English | 中文 |
|---|---|
| Decisions / Chains / Task control / Metrics | 决策 / 链 / 任务控制 / 指标 |
| Theme / Language | 主题 / 语言 |
| Plan (a loop plan) | 做法 |
| Standard / Bug fix (red first) / Safe refactor / Design / docs first / Investigate only | 标准 / 修 bug（先红后绿）/ 安全重构 / 先写设计／文档 / 只调研不改代码 |
| Goal / Done when / Only changes / Must not change | 目标 / 完成条件 / 只改 / 不许改 |
| Budget / group reserve / estimate / suggestion | 预算 / 组余量 / 估算 / 建议 |
| Confirm / Start / Pause / Handoff | 确认 / 开跑 / 暂停 / 交接 |
| attempt / active time / tokens | 尝试 / 活跃时间 / token |
| changed | 已修改 |

The loop plans spec's Chinese strings (its §2.2, §4.1, §4.2, and the plan's R-F5 table left column) are the
starting point for `loopPlan.*`.

## 6. Criteria

1. **Existing web criteria keep passing.** The web test setup (`setupFiles` added to `web/vite.config.ts`) calls
   `initI18n({ lng: "en" })`. Every existing web test file runs unmodified except the ones §6.1 names.
2. **Key parity**: the flattened key sets of `en` and `zh` are exactly equal (both directions), `errors` excluded.
3. **Loop summary equivalence**: for every plan and version in the registry and a set of inputs (one path / two
   paths, protected paths empty / not, 1 / 25 files, 1 / 2 checks), the English lines built from the new view
   equal the lines `describeLoopPlan` produced before its removal, pinned in the test as literals.
4. **Refusal coverage**: every code of the mechanical sources in §3.2 has `errors.<code>` in Chinese; English
   refusals render `message` byte-identically.
5. **Everything visible goes through `t`**: a test-only pseudo-locale wraps every value as `⟦…⟧`. Each area (nav,
   shell footer, decisions, chains, task control incl. loop card and budget table, agents, metrics, recovery, error
   page) is rendered with a fixture in the pseudo-locale; every English resource value that is at least 4
   characters, contains no `{{`, and differs from its Chinese value must not appear as text. The same fixture in
   `zh` shows a named Chinese string per area.
6. **Detection**, each case in its own module instance (`vi.resetModules()`; the detector caches storage support at
   module level): stored `zh` beats a browser `en-US`; browser `zh-TW` → resolved `zh`; `fr` → `en`;
   `["fr","zh-CN"]` → `zh`; storage that throws → the browser's language, and rendering works.
7. **Switch**: choosing `中文` writes `orca.panel.lang = zh`, sets `<html lang="zh">`, and re-renders a visible
   string, a helper-built string included; choosing `English` reverses it.
8. **Server view**: the loop plan view carries exactly the fields of §3.1; the strict schema refuses a view that
   still carries `summary` or `planName`.
9. **Plan text registry parity** (§3.1): for every (planId, version) of the registry, English name/discipline equal
   the registry's text and Chinese has both keys.
10. **Metrics codes** (§3.4): each metrics/coverage sentence has its code; the panel shows the Chinese note for a
    known code and the sentence for an unknown one.

Every new branch gets a named deletion mutation seen red (Rule 9), run in a `git clone --local` copy.

### 6.1 Existing criteria that change (need the human's naming)

Known today (the plan completes the list by a code scan for `summary`, `planName`, `describeLoopPlan`,
`BANNER_TEXT`, `bannersFor`, `progressText`, `WEB_LOOP_PLANS`, `LABELS`, `FIELD_LABEL`, `BAD_BUDGET`,
`BAD_FILE_CAP`, and the metrics/coverage JSON shape, under `tests/` and `web/tests/`, each with the exact change):

- `tests/control/loopPlanSummary.test.ts` — tests `describeLoopPlan`, which is removed; replaced by §6.3.
- `tests/control/loopPlanView.test.ts` — asserts `summary`.
- `tests/panel/taskLoopApi.test.ts` — compares `WEB_LOOP_PLANS` names with the registry; replaced by §6.9.
- `web/tests/chainPanel.test.tsx` — `expect(BANNER_TEXT).toEqual(…)` and `bannersFor`'s `text`.
- `web/tests/taskLabels.test.tsx` — calls `progressText` (signature kept; listed in case the scan shows a change).
- Web fixtures that build a `loopPlan` view with `summary`/`planName` (`loopPlanCard`, `loopPlanEdit`,
  `loopPlanDraft`, `loopBudgetRows`) — assertions on rendered English stay; fixtures change shape.
- Any criterion pinning the exact metrics or coverage JSON (additive fields).

## 7. Order against the other work of this round

W5 web half, W3b (sticky "changed") and W7 (plans v2) change panel strings, the loop view and plan versions. This
design is implemented **after** they land, so its key inventory and §6.3/§6.9 see their final strings and versions.

## 8. Assumptions the plan re-checks

- That no text source exists beyond §3 (the scan is the proof; §6.5 is the backstop).
- `scripts/verify-panel.ts` and `tests/panel/*` pin no panel UI text beyond the ready line (the English default
  keeps them green either way; list them).
- The library behavior §4 and §6.6 rely on, at the versions the lock file resolves (the review measured i18next
  26.4.2, react-i18next 17.0.15, i18next-browser-languagedetector 8.2.1).

## 9. Independent review (revision 1 → 2)

An independent read-only agent reviewed revision 1 against the code and a scratch install of the three libraries;
the controller re-checked C1, C3 and I3 against the source before acting. Finding → change:

- **C1** `initImmediate` does not exist in i18next 26 (`initAsync`; tsc TS2769). → §2 `initAsync: false`.
- **C2** "zh typed as en's shape" contradicted "zh `_other` only" (TS2741). → zh carries `_one` keys; values widened.
- **C3** Metrics `reason`/`caveats`/`known_bias`, coverage `caveat` and chain `problem` are English sentences, not
  codes. → §3.4 (additive codes; two dynamic texts shown as sent).
- **I1** Many raw enum families were missing. → §3.5.
- **I2** Helper list incomplete (and `consequenceOf` is in `LoopPlanCard.tsx`); web-made refusal messages. → §3.3.
- **I3** "Existing web tests run unmodified" was false for helper/constant readers. → helpers keep signatures;
  §6.1 names the readers.
- **I4** The English plan text's home and unversioned names. → registry stays the English source; versioned keys;
  §6.9.
- **I5** A server-sent `disciplineKey` string loses typing and renders a raw key on a miss; `checkCount`
  duplicated `inputs.checks.length`. → `hasDiscipline`; `checkCount` dropped.
- **I6** `errors.*` vs key parity; the refusal code set is not one catalog. → Chinese-only `errors` namespace,
  excluded from parity; mechanical sources plus a hand list; fallback visible.
- **I7** The detector caches storage support per module; its probe writes a test key. → §6.6 isolates cases;
  §4 wording.
- **I8** Criterion 5 could be vacuous or falsely red. → pseudo-locale render, length/`{{`/en≠zh filter, all areas.
- Minor: `resolvedLanguage` and initial `<html lang>` (§4); caret ranges (§2); `initI18n` and `setupFiles` (§2,
  §6.1); C7 correction as a new section (§1); §6.8 names the old fields.
