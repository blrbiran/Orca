### Task 5: The decisions area

**Files:**
- Modify: `web/src/DecisionsView.tsx`, `web/src/DecisionList.tsx`, `web/src/DecisionDetail.tsx`, `web/src/kindRank.ts:29-32`, `web/src/App.tsx:130,550,557,580,585,588,594`
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`decisions` area; enum families `decisionKind`, `decisionScope`, `decisionVerdict`, `correctionKind`)
- Create: `web/tests/decisionsI18n.test.tsx`

**Interfaces:** exported constants keep their names and English values (`NO_QUESTION`, `HIDDEN_BY_FILTER`, `NOT_IN_LIST`, `AGREE_HELP`, `CORRECT_NOTE`, `KIND_HELP`: each `= en.decisions.<key>`; drafter finding F10); `kindLabel(kind)` keeps its signature.

**Keys** (English = today's text; Chinese drafted per spec §5):

| Key | English | 中文 | Site (today) |
|---|---|---|---|
| `decisions.title` | `Unreviewed high-tier decisions` | `未评审的高层级决策` | `DecisionsView.tsx:81` |
| `decisions.count` | `{{shown}} of {{total}}` | `{{shown}} / {{total}}` | `:82` |
| `decisions.lede` | `High-tier decisions an agent recorded that nobody has reviewed yet. Open one, read it, then Agree or Correct.` | `agent 记录下、还没人评审过的高层级决策。打开一条，读完，然后点「同意」或「纠正」。` | `:85` |
| `decisions.filterKind` / `filterScope` / `filterRepository` | `Kind` / `Scope` / `Repository` | `类型` / `范围` / `仓库` | `:88-90` |
| `decisions.any` | `any` | `任意` | `:56` |
| `decisions.nothingToReview` | `Nothing to review. Every high-tier decision has been reviewed.` | `没有要评审的。每条高层级决策都已评审。` | `:95` |
| `decisions.noMatch` | `No decision matches these filters.` | `没有符合这些筛选条件的决策。` | `:97` |
| `decisions.selectOne` | `Select a decision to read it.` | `选择一条决策来阅读。` | `:104` |
| `decisions.hiddenByFilter` | `This decision is hidden by the current filters.` | `这条决策被当前筛选条件隐藏了。` | `:19` |
| `decisions.notInList` | `This decision is no longer in the list: it has been reviewed.` | `这条决策已不在列表里：它已被评审。` | `:20` |
| `decisions.noQuestion` | `(no question recorded)` | `（没有记录问题）` | `DecisionList.tsx:42` |
| `decisions.chose` / `because` / `rejected` | `Chose` / `Because` / `Rejected alternatives` | `选择了` / `理由` / `被否决的备选` | `DecisionDetail.tsx:70,76,83` (and the form label `:126`) |
| `decisions.agree` | `Agree` | `同意` | `:100` |
| `decisions.agreeHelp` | `Mark reviewed: I read this and it needs no change. Counts toward review coverage.` | `标记为已评审：我读过了，不需要改。计入评审覆盖率。` | `:47` |
| `decisions.correctNote` | `This records a correction; it does not edit the ledger. To change the decision itself, close it with orca correct --close or let the fix agent do it.` | `这会记录一条纠正；它不改台账。要改决策本身，用 orca correct --close 关闭它，或交给修复 agent。` | `:48-49` |
| `decisions.kind` | `Kind` | `类型` | `:116` |
| `decisions.kindOption` | `{{kind}} — {{help}}` | `{{kind}} —— {{help}}` | `:120` |
| `decisions.kindHelp.wrong` / `not_my_taste` / `stale` | `the choice was wrong` / `defensible, but not what I would choose` / `it was right then, no longer true` | `选错了` / `说得通，但不是我会选的` / `当时对，现在不成立了` | `:51-53` |
| `decisions.choseInstead` | `Chose instead (optional)` | `改选（可选）` | `:130` |
| `decisions.correct` | `Correct` | `纠正` | `:133` |
| `decisions.recordedReviewed` | `Recorded as reviewed.` | `已记录为已评审。` | `App.tsx:580` |
| `decisions.correctionRecorded` | `Correction recorded.` | `纠正已记录。` | `App.tsx:585,594` |

Enum families (Records over the unions of `web/src/types.ts`):

| Family | Values: English = the value itself / 中文 |
|---|---|
| `decisionKind` (`DecisionKind`) | dependency 依赖 · interface 接口 · scheduling 调度 · abandon 放弃 · criteria 判据 · boundary 边界 · reconcile 协调 |
| `decisionScope` (`DecisionScope`) | file 文件 · task 任务 · repo 仓库 · cross-repo 跨仓库 |
| `decisionVerdict` (`DecisionObservation["verdict"]`) | ok 正常 · downgraded 已降级 |
| `correctionKind` (`CorrectionKind`) | wrong 错了 · not_my_taste 不合我意 · stale 过时 |

- [ ] **Step 1: Write the failing criterion** — `web/tests/decisionsI18n.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3, §3.5, §5: the decisions area in Chinese -- the heading, the filters and their options, the row's
 * pills (enum values in words; the data-* attributes keep the raw value), the missing-question placeholder, why an open
 * decision left the list, and the detail's form with each correction kind in words.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { DecisionDetail } from "../src/DecisionDetail.js";
import type { Decision } from "../src/DecisionDetail.js";
import { DecisionsView, NO_FILTER } from "../src/DecisionsView.js";
import type { DecisionListRow } from "../src/types.js";

const ROW: DecisionListRow = { projectKey: "github.com/x/y", id: "run/1", at: "2026-09-16T00:00:00.000Z", kind: "reconcile", scope: "cross-repo", verdict: "downgraded", question: null };
const DECISION: Decision = { id: "run/1", question: "q-1", chose: "c-1", because: "b-1", alternatives: [{ option: "o-1", why_not: "w-1" }] };
const optionTexts = (container: HTMLElement, name: string): Array<string | null> =>
  [...container.querySelectorAll(`select[name="${name}"] option`)].map((option) => option.textContent);

afterEach(cleanup);

describe("the decisions area in Chinese", () => {
  it("shows the list, its filters, the pills and the detail's form in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const { container } = render(<DecisionsView rows={[ROW]} filter={NO_FILTER} selected={ROW} detail={<DecisionDetail decision={DECISION} />} />);
    const text = container.textContent ?? "";
    for (const expected of ["未评审的高层级决策", "1 / 1", "（没有记录问题）", "选择了", "被否决的备选", "同意", "改选（可选）", "纠正"]) expect(text).toContain(expected);
    expect(container.querySelector(".field-kind")?.textContent).toBe("协调");
    expect(container.querySelector(".field-kind")?.getAttribute("data-level")).toBe("1");
    expect(container.querySelector(".field-scope")?.textContent).toBe("跨仓库");
    expect(container.querySelector(".field-verdict")?.textContent).toBe("已降级");
    expect(optionTexts(container, "filter-kind")).toEqual(["任意", "🔴 协调"]);
    expect(optionTexts(container, "filter-scope")).toEqual(["任意", "跨仓库"]);
    expect(optionTexts(container, "kind")).toEqual(["错了 —— 选错了", "不合我意 —— 说得通，但不是我会选的", "过时 —— 当时对，现在不成立了"]);
  });

  it("says in Chinese why an open decision is not in the list", async () => {
    await i18n.changeLanguage("zh");
    const reviewed = render(<DecisionsView rows={[]} filter={NO_FILTER} selected={ROW} detail={<p>detail</p>} />).container.textContent ?? "";
    expect(reviewed).toContain("这条决策已不在列表里：它已被评审。");
    expect(reviewed).toContain("没有要评审的。每条高层级决策都已评审。");
    cleanup();
    const hidden = render(<DecisionsView rows={[ROW]} filter={{ ...NO_FILTER, scope: "repo" }} selected={ROW} detail={<p>detail</p>} />).container.textContent ?? "";
    expect(hidden).toContain("这条决策被当前筛选条件隐藏了。");
    expect(hidden).toContain("没有符合这些筛选条件的决策。");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/decisionsI18n.test.tsx) > "$SCRATCH/t5-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`, both tests red (English text everywhere).

- [ ] **Step 3: Implement**

`web/src/locales/en.ts`: add `import type { CorrectionKind, DecisionKind, DecisionObservation, DecisionScope } from "../types.js";` (merge with the Task 4 import from `../types.js`) and, before `export const en`,
```ts
const decisionKind = {
  dependency: "dependency", interface: "interface", scheduling: "scheduling", abandon: "abandon", criteria: "criteria", boundary: "boundary", reconcile: "reconcile",
} as const satisfies Record<DecisionKind, string>;
const decisionScope = { file: "file", task: "task", repo: "repo", "cross-repo": "cross-repo" } as const satisfies Record<DecisionScope, string>;
const decisionVerdict = { ok: "ok", downgraded: "downgraded" } as const satisfies Record<DecisionObservation["verdict"], string>;
const correctionKind = { wrong: "wrong", not_my_taste: "not_my_taste", stale: "stale" } as const satisfies Record<CorrectionKind, string>;
const kindHelp = {
  wrong: "the choice was wrong",
  not_my_taste: "defensible, but not what I would choose",
  stale: "it was right then, no longer true",
} as const satisfies Record<CorrectionKind, string>;
```
In `en`, after `common` add:
```ts
  decisions: {
    title: "Unreviewed high-tier decisions",
    count: "{{shown}} of {{total}}",
    lede: "High-tier decisions an agent recorded that nobody has reviewed yet. Open one, read it, then Agree or Correct.",
    filterKind: "Kind",
    filterScope: "Scope",
    filterRepository: "Repository",
    any: "any",
    nothingToReview: "Nothing to review. Every high-tier decision has been reviewed.",
    noMatch: "No decision matches these filters.",
    selectOne: "Select a decision to read it.",
    hiddenByFilter: "This decision is hidden by the current filters.",
    notInList: "This decision is no longer in the list: it has been reviewed.",
    noQuestion: "(no question recorded)",
    chose: "Chose",
    because: "Because",
    rejected: "Rejected alternatives",
    agree: "Agree",
    agreeHelp: "Mark reviewed: I read this and it needs no change. Counts toward review coverage.",
    correctNote: "This records a correction; it does not edit the ledger. To change the decision itself, close it with orca correct --close or let the fix agent do it.",
    kind: "Kind",
    kindOption: "{{kind}} — {{help}}",
    kindHelp,
    choseInstead: "Chose instead (optional)",
    correct: "Correct",
    recordedReviewed: "Recorded as reviewed.",
    correctionRecorded: "Correction recorded.",
  },
```
and in `enums`: `theme, decisionKind, decisionScope, decisionVerdict, correctionKind`.

`web/src/locales/zh.ts`, after `common`:
```ts
  decisions: {
    title: "未评审的高层级决策",
    count: "{{shown}} / {{total}}",
    lede: "agent 记录下、还没人评审过的高层级决策。打开一条，读完，然后点「同意」或「纠正」。",
    filterKind: "类型",
    filterScope: "范围",
    filterRepository: "仓库",
    any: "任意",
    nothingToReview: "没有要评审的。每条高层级决策都已评审。",
    noMatch: "没有符合这些筛选条件的决策。",
    selectOne: "选择一条决策来阅读。",
    hiddenByFilter: "这条决策被当前筛选条件隐藏了。",
    notInList: "这条决策已不在列表里：它已被评审。",
    noQuestion: "（没有记录问题）",
    chose: "选择了",
    because: "理由",
    rejected: "被否决的备选",
    agree: "同意",
    agreeHelp: "标记为已评审：我读过了，不需要改。计入评审覆盖率。",
    correctNote: "这会记录一条纠正；它不改台账。要改决策本身，用 orca correct --close 关闭它，或交给修复 agent。",
    kind: "类型",
    kindOption: "{{kind}} —— {{help}}",
    kindHelp: { wrong: "选错了", not_my_taste: "说得通，但不是我会选的", stale: "当时对，现在不成立了" },
    choseInstead: "改选（可选）",
    correct: "纠正",
    recordedReviewed: "已记录为已评审。",
    correctionRecorded: "纠正已记录。",
  },
```
and in `enums`:
```ts
    decisionKind: { dependency: "依赖", interface: "接口", scheduling: "调度", abandon: "放弃", criteria: "判据", boundary: "边界", reconcile: "协调" },
    decisionScope: { file: "文件", task: "任务", repo: "仓库", "cross-repo": "跨仓库" },
    decisionVerdict: { ok: "正常", downgraded: "已降级" },
    correctionKind: { wrong: "错了", not_my_taste: "不合我意", stale: "过时" },
```

`web/src/DecisionsView.tsx`:
- imports: add `import { useTranslation } from "react-i18next";`, `import { enumText } from "./i18n.js";`, `import { en } from "./locales/en.js";`
- lines 19-20 → `/** In English (criteria read them); the render uses the reader's language (panel i18n spec §3.3). */` then `export const HIDDEN_BY_FILTER = en.decisions.hiddenByFilter;` and `export const NOT_IN_LIST = en.decisions.notInList;`
- `FilterSelect`: first body line `const { t } = useTranslation();`; `<option value="">any</option>` → `<option value="">{t("decisions.any")}</option>`
- `DecisionsView`: first body line `const { t } = useTranslation();`; `: !props.rows.some(same) ? NOT_IN_LIST` → `: !props.rows.some(same) ? t("decisions.notInList")`; `: !shown.some(same) ? HIDDEN_BY_FILTER` → `: !shown.some(same) ? t("decisions.hiddenByFilter")`; `<h1>Unreviewed high-tier decisions</h1>` → `<h1>{t("decisions.title")}</h1>`; `{shown.length} of {props.rows.length}` → `{t("decisions.count", { shown: shown.length, total: props.rows.length })}`; the lede text → `{t("decisions.lede")}`; `label="Kind"` → `label={t("decisions.filterKind")}`; `label="Scope"` → `label={t("decisions.filterScope")}` and add `optionText={(value) => enumText("decisionScope", value)}` to that `FilterSelect`; `label="Repository"` → `label={t("decisions.filterRepository")}`; the three empty texts → `{t("decisions.nothingToReview")}`, `{t("decisions.noMatch")}`, `{t("decisions.selectOne")}`.

`web/src/DecisionList.tsx`:
- imports: add `import { useTranslation } from "react-i18next";`, `import { enumText } from "./i18n.js";`, `import { en } from "./locales/en.js";`
- line 42 → `/** In English (criteria read it); the render uses the reader's language. */` and `export const NO_QUESTION = en.decisions.noQuestion;`
- `DecisionList`: first body line `const { t } = useTranslation();`; `{String(row.kind)}` (the pill's text, not `data-level`) → `{enumText("decisionKind", String(row.kind))}`; `{String(row.scope)}` → `{enumText("decisionScope", String(row.scope))}`; `{String(row.verdict)}` → `{enumText("decisionVerdict", String(row.verdict))}`; `{row.question ?? NO_QUESTION}` → `{row.question ?? t("decisions.noQuestion")}`.

`web/src/DecisionDetail.tsx`:
- imports: add `import { useTranslation } from "react-i18next";`, `import { enumText } from "./i18n.js";`, `import { en } from "./locales/en.js";`
- lines 47-54 → `/** In English (criteria read them); the render uses the reader's language (panel i18n spec §3.3). */`, `export const AGREE_HELP = en.decisions.agreeHelp;`, `export const CORRECT_NOTE = en.decisions.correctNote;`, `export const KIND_HELP: Record<CorrectionKind, string> = en.decisions.kindHelp;`
- `DecisionDetail`: first body line `const { t } = useTranslation();`; `<h3>Chose</h3>` → `<h3>{t("decisions.chose")}</h3>`; `<h3>Because</h3>` → `<h3>{t("decisions.because")}</h3>`; `<h3>Rejected alternatives</h3>` → `<h3>{t("decisions.rejected")}</h3>`; button text `Agree` → `{t("decisions.agree")}`; `{AGREE_HELP}` → `{t("decisions.agreeHelp")}`; label `Kind` → `{t("decisions.kind")}`; `{`${kind} — ${KIND_HELP[kind]}`}` → `{t("decisions.kindOption", { kind: enumText("correctionKind", kind), help: t(`decisions.kindHelp.${kind}`) })}`; label `Because` → `{t("decisions.because")}`; label `Chose instead (optional)` → `{t("decisions.choseInstead")}`; submit `Correct` → `{t("decisions.correct")}`; `{CORRECT_NOTE}` → `{t("decisions.correctNote")}`.

`web/src/kindRank.ts`: add `import { enumText } from "./i18n.js";`; line 31 `return rank ? `${MARK[rank.level]} ${kind}` : kind;` → `return rank ? `${MARK[rank.level]} ${enumText("decisionKind", kind)}` : kind;`

`web/src/App.tsx` (panel i18n spec §3.3: the recorded outcome keeps its key, so a switch re-renders it):
- line 130 `type Outcome = { kind: "recorded"; text: string } | …` → `type RecordedKey = "decisions.recordedReviewed" | "decisions.correctionRecorded";` and `type Outcome = { kind: "recorded"; text: RecordedKey } | { kind: "refused"; refusal: PanelRefusal };`
- line 550 `const send = async (post: () => Promise<PostResult<unknown>>, recorded: string): Promise<void> => {` → `recorded: RecordedKey`
- line 580 `"Recorded as reviewed."` → `"decisions.recordedReviewed"`; lines 585 and 594 `"Correction recorded."` → `"decisions.correctionRecorded"`
- line 588 `{outcome?.kind === "recorded" && <p role="status">{outcome.text}</p>}` → `{outcome?.kind === "recorded" && <p role="status">{t(outcome.text)}</p>}`

- [ ] **Step 4: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/decisionsI18n.test.tsx tests/decisionsView.test.tsx tests/decisionList.test.tsx tests/decisionDetail.test.tsx tests/kindRank.test.ts tests/appSelection.test.tsx tests/outcome.test.tsx) > "$SCRATCH/t5-green.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t5-web-check.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t5`; criterion `(cd "$M/web" && ../node_modules/.bin/vitest run tests/decisionsI18n.test.tsx)`)
  - MT5-1 kind label raw: `kindRank.ts` `enumText("decisionKind", kind)` → `kind`. Red: `… > shows the list, its filters …` (`🔴 reconcile`).
  - MT5-2 scope pill raw: `enumText("decisionScope", String(row.scope))` → `String(row.scope)`. Red: same test (`.field-scope`).
  - MT5-3 verdict pill raw: `enumText("decisionVerdict", String(row.verdict))` → `String(row.verdict)`. Red: same test.
  - MT5-4 correction kind raw: `enumText("correctionKind", kind)` → `kind`. Red: same test (the `kind` options).
  - MT5-5 note from the English constant: `t("decisions.notInList")` → `NOT_IN_LIST`. Red: `… > says in Chinese why an open decision is not in the list`.
  - MT5-6 placeholder from the English constant: `t("decisions.noQuestion")` → `NO_QUESTION` (with its import). Red: `… > shows the list …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/DecisionsView.tsx web/src/DecisionList.tsx web/src/DecisionDetail.tsx web/src/kindRank.ts web/src/App.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/decisionsI18n.test.tsx
/usr/bin/git commit -F - <<'MSG'
feat(web): translate the decisions area

The to-do list, its filters, the row pills, the detail and the correction form
read in the chosen language; decision kinds, scopes, verdicts and correction
kinds are enum families in words, while data attributes and form values keep
the raw values. The exported English constants other criteria read are kept.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

