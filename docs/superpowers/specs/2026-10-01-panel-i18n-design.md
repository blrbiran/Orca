# Panel languages (English / Chinese) — design

Session `e604b1ba` (controller), 2026-10-01, on Orca `main` after `97b39e6`. Ledger:
`.superpowers/sdd/2026-10-01-loop-plans-followups/progress.md` (H5, H13).

## 0. What this builds

Every piece of text the Orca web panel shows as its own UI can be read in English or Chinese. The language
follows the browser by default; a manual choice is remembered in that browser. English stays byte-identical to
today's panel.

### 0.1 Not in this design

- Terminal output of `orca panel` (the ready line on stdout, the hint on stderr) and every CLI string.
- Content that is data, not UI: ledger decision text, evidence, task goals and inputs typed by a person, ids,
  paths, check commands, model names, repo keys, error **codes**.
- A third language (the structure allows one; nothing here builds it).
- Server-side language negotiation: the server never learns the viewer's language.

## 1. Rulings (human's words quoted)

| # | Question | Ruling |
|---|---|---|
| L1 | Should the panel's language be switchable | "面板文案在 Orca 的 web UI 上要可以选择，可以切换"; this supersedes R-F5's "the panel speaks English" as the only language, not its English strings |
| L2 | Default and memory | "跟浏览器语言，手动切换按浏览器记住" |
| L3 | Scope | "整个面板的界面文案" |
| L4 | Mechanism | "走标准的 i18n 方案不行吗？" → "好，就用 react-i18next" |
| L5 | The four design sections presented in the conversation | "其他都同意。写spec吧" |

Consequence of L4: the loop-plan summary is no longer built as English sentences on the server (loop plans spec
C7). The server sends keys and parameters; the panel translates (§3). This is the usual i18n split and it keeps
every UI string in one place.

## 2. Structure

- Dependencies (web workspace only): `i18next`, `react-i18next`, `i18next-browser-languagedetector`, pinned to
  exact versions in `web/package.json`. Bundled by vite; nothing is fetched at run time.
- `web/src/i18n.ts` creates one i18next instance: `initReactI18next`, the language detector (§4), resources
  imported statically from `web/src/locales/en.ts` and `web/src/locales/zh.ts`, `initImmediate: false`
  (synchronous, so the first render already has text), `fallbackLng: "en"`, `supportedLngs: ["en", "zh"]`,
  `load: "languageOnly"`, `interpolation.escapeValue: false` (React escapes).
- Keys are grouped by panel area: `nav`, `shell`, `decisions`, `chains`, `control`, `budget`, `loopPlan`,
  `agents`, `metrics`, `recovery`, `errors`, `enums`, `common`.
- Typed keys: `web/src/i18n.d.ts` declares `CustomTypeOptions.resources` from the English resource, so an unknown
  key is a compile error. `zh.ts` is typed as the same shape, so a missing Chinese key is also a compile error;
  the parity criterion (§6) is the run-time backstop.
- Components use `useTranslation()`. Pure helpers that build text today (`LoopPlanCard`'s header and summary
  lines, `BudgetEditor`'s consequence text, `chainBanner.ts`'s `BANNER_TEXT`, `Shell`'s `LABELS`) take `t` as a
  parameter and stay pure.
- Plurals use i18next's plural suffixes: English `_one` / `_other` (P1's singular forms), Chinese `_other` only.
- **The English resource reproduces today's strings byte for byte.** Every existing web criterion that pins an
  English string therefore stays valid unchanged (§6).

## 3. Server output the panel shows

The plan's first task lists every server field the panel renders as human text, by reading `web/src` renders of
view fields (a code scan that prints each site, not `grep`), and classifies each one as **key + params** or
**shown as sent**. Known today:

| Source | Today | Change |
|---|---|---|
| Loop plan view (`src/panel/controlViews.ts` via `describeLoopPlan`, `src/control/loopPlans.ts:240`) | `planName` and `summary: string[]`, English sentences | **key + params** (§3.1) |
| Refusal `message` (`controlErrorBody`, `src/panel/controlErrors.ts`) | English sentence per response | §3.2 |
| Enum values rendered raw (`view.summary.state`, `stopMode`/`stopState`, chain state, blocker scope, theme names) | the raw value | displayed through `enums.<family>.<value>`; English value = today's text; `data-*` attributes keep the raw value |
| Chain stop `reason`, metrics `review_coverage.reason` | server codes | shown as sent (they are codes) |

### 3.1 Loop plan view

`WorkItemViewV1.loopPlan` drops `planName` and `summary` and carries what the text is made from:

```
{ planId, planVersion, chosenBy, chosenByLabel, amended, loopVersion, inputs,
  maxFiles, checkCount, disciplineKey: string | null }
```

- `maxFiles` is the expanded contract's `safetyPolicy.maxFilesTouched`; `checkCount` its
  `verification.requiredChecks.length`; `disciplineKey` is `loopPlan.discipline.<planId>.v<planVersion>` or
  `null` for a plan without one. Keys carry the plan version so a v1 task keeps v1 wording after a v2 exists.
- Plan names: `loopPlan.name.<planId>`.
- The panel builds the summary lines with `t`; English output equals today's `describeLoopPlan` output for every
  plan and version (criterion 3).
- `describeLoopPlan` is removed from the server; the projection's recipe re-expansion check (A5) is unchanged.
- The server's strict view schema (`src/control/webProtocol.ts`), its web mirror (`web/src/controlTypes.ts`) and
  the parity criterion change together.

### 3.2 Refusal messages

The response keeps `code` and `message` unchanged (other clients and criteria read `message`). The panel shows:

- English: `message` as sent — byte-identical to today.
- Chinese: `errors.<code>` when the Chinese resource has it, else `message` as sent. The code is always shown next
  to it (as today, `data-testid="refusal-code"`).

Chinese entries exist for every code in the durable and non-durable catalogs of `src/control/errors.ts` and for
the panel's own codes (`src/panel/*`): a criterion compares the catalog to the Chinese keys (§6). A Chinese entry
is a sentence about the code, not a translation of one response's `message`, since some messages carry details.

## 4. Detection and switch

- Detector order: `localStorage` key `orca.panel.lang` (same naming as `orca.panel.theme`), then
  `navigator.languages`. `zh`, `zh-CN`, `zh-TW`, `zh-Hans`… → `zh`; anything else → `en`.
- The detector writes nothing (`caches: []`): the detector's own cache also fires on the initial detection,
  which would freeze today's browser language as a choice and break L2. The switch writes
  `orca.panel.lang` itself, wrapped like `writeTheme`. Storage that is missing or throws leaves the panel
  working: detection falls back to the browser, a lost choice costs one click.
- Switch: a `Language` select in the sidebar footer beside `Theme`, options `English` / `中文` (each named in its
  own language, not translated). Changing it calls `changeLanguage` and sets `<html lang>` (`en` / `zh`).
- The theme select's option labels go through `enums.theme.*`; its stored values do not change.

## 5. Chinese wording

The controller drafts `zh.ts`; the human reviews it before the round closes (task in the plan). Terms used
consistently:

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

1. **Existing web criteria unchanged.** Test setup fixes the language to `en` (a vitest `setupFiles` entry for
   the web workspace that initializes `i18n.ts` with `lng: "en"`). The ~37 existing web test files run
   unmodified except where §6.1 names them.
2. **Key parity**: the flattened key sets of `en` and `zh` are equal (both directions; a key in one only is red),
   plural families compared by base key.
3. **Loop summary equivalence**: for every plan and version in the registry and a set of inputs (one path / two
   paths, protected paths empty / not, 1 / 25 files, 1 / 2 checks), the English lines built from the new view
   equal what `describeLoopPlan` produced before its removal (the expected lines are pinned in the test).
4. **Refusal coverage**: every catalog code (§3.2) has `errors.<code>` in `zh`; English refusals render `message`
   byte-identically.
5. **Chinese render**, one per area (nav, decisions, chains, task control incl. loop card and budget table,
   metrics, recovery): with `lng: "zh"` a known string renders in Chinese and no English UI string from that
   area's resource appears (the check reads the area's English values from `en.ts`, so it cannot pass vacuously).
6. **Detection**: stored `zh` beats a browser `en-US`; browser `zh-TW` → `zh`; `fr` → `en`; storage that throws
   → the browser's language, and rendering works.
7. **Switch**: choosing `中文` writes `orca.panel.lang = zh`, sets `<html lang="zh">`, and re-renders a visible
   string; choosing `English` reverses it.
8. **Server view**: the loop plan view carries the fields of §3.1 and no `summary`/`planName`; strict schema
   refuses an extra field.

Every new branch gets a named deletion mutation seen red (Rule 9), run in a `git clone --local` copy.

### 6.1 Existing criteria that change (need the human's naming)

Changing the server's loop view (§3.1) touches criteria written in the 2026-09-30 round. Known today:
`tests/control/loopPlanSummary.test.ts` (tests `describeLoopPlan`, which is removed), `tests/control/loopPlanView.test.ts`
(asserts `summary`), and web fixtures that build a `loopPlan` view with `summary`/`planName`
(`web/tests/loopPlanCard.test.tsx`, `loopPlanEdit.test.tsx`, `loopPlanDraft.test.tsx`, `loopBudgetRows.test.tsx` —
their assertions on rendered English stay; their fixtures change shape). The plan lists every affected criterion
by a code scan for `summary`, `planName` and `describeLoopPlan` under `tests/` and `web/tests/`, each with the
exact change, and the human names them before implementation starts.

## 7. Order against the other work of this round

W5/W6 (estimate apply and staleness) and W3b (sticky "changed") add or change panel strings and the loop view;
W7 (plans v2) adds plan versions. This design is implemented **after** those land, so its key inventory and
criterion 3 see their final strings and versions. Strings those tasks add are English until then.

## 8. Assumptions the plan re-checks

- That no panel code path renders a server field as text other than those found by the §3 scan.
- `i18next-browser-languagedetector`'s behavior with a throwing `localStorage` (read its source at the pinned
  version; the criterion in §6.6 is the proof).
- That `scripts/verify-panel.ts` and `tests/panel/*` pin no panel UI text beyond the ready line (if they do, the
  English default keeps them green; list them).
