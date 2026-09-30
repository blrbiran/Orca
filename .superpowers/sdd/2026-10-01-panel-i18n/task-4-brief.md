### Task 4: Codes beside the metrics sentences, and the metrics area

Spec §3.4, §6.10. Additive on the server: the sentences stay (the CLI prints them); the panel shows `metrics.note.<code>`
and falls back to the sentence.

**Files:**
- Modify: `src/metrics/types.ts` (new type before `CorrectionRate`; `CorrectionRate` :121; `RepairRate` :143-150; `ReviewCoverage` :178-181)
- Modify: `src/metrics/compute.ts` (imports :5-16; :127-137; :164-171; :230)
- Modify: `src/panel/coverage.ts:5-11,48-56`
- Modify: `web/src/types.ts` (mirror, optional fields), `web/src/MetricsView.tsx`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Create: `tests/metrics/noteCodes.test.ts`, `web/tests/metricsNotes.test.tsx`
- Modify (existing criteria, H18): `tests/fixtures/metrics/golden.json` (expected value of `tests/metrics/cli.test.ts` "matches the golden byte for byte"), `tests/panel/webParity.test.ts:116-118,122-124`

**Interfaces:**
- Produces (`src/metrics/types.ts`): `export type MetricsNoteCode = "no-review-coverage" | "unresolved-decisions" | "stale-bias";` `CorrectionRate.caveatCodes: MetricsNoteCode[]` and `RepairRate.caveatCodes: MetricsNoteCode[]` (index for index with `caveats`), `RepairRate.stale_only.knownBiasCode: MetricsNoteCode`, `ReviewCoverage.reasonCode: MetricsNoteCode`; (`src/panel/coverage.ts`) `PanelCoverage.caveatCode: "reviewed-is-deliberate"`.
- Web mirror (`web/src/types.ts`): the same fields, optional.

- [ ] **Step 1: Write the failing criteria**

`tests/metrics/noteCodes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/metrics/compute.js";
import { computePanelCoverage } from "../../src/panel/coverage.js";
import { en } from "../../web/src/locales/en.js";
import { OBS } from "./fixture.js";

/**
 * Panel i18n spec §3.4, §6.10: every sentence the metrics and the coverage carry has a stable code beside it, index for
 * index, so the panel can show it in the reader's language; and the panel's English note for each code is the server's
 * sentence byte for byte, so English stays what it was (spec §2).
 */
const notes = en.metrics.note as Record<string, string>;

describe("metrics sentence codes (spec §3.4, §6.10)", () => {
  it("puts a code beside each sentence, index for index, and the panel's English note is the sentence", () => {
    const r = computeMetrics(OBS, { bucket: "month" }); // OBS has one correction whose decision was not scanned
    expect(r.correction_rate.caveatCodes).toEqual(["no-review-coverage", "unresolved-decisions"]);
    expect(r.repair_rate.caveatCodes).toEqual(["no-review-coverage"]);
    const pairs: Array<[string, string]> = [
      ...r.correction_rate.caveats.map((sentence, i): [string, string] => [r.correction_rate.caveatCodes[i]!, sentence]),
      ...r.repair_rate.caveats.map((sentence, i): [string, string] => [r.repair_rate.caveatCodes[i]!, sentence]),
      [r.repair_rate.stale_only.knownBiasCode, r.repair_rate.stale_only.known_bias],
      [r.review_coverage.reasonCode, r.review_coverage.reason],
    ];
    for (const [code, sentence] of pairs) expect(notes[code], code).toBe(sentence);
  });

  it("gives no unresolved code when nothing is unresolved", () => {
    expect(computeMetrics({ ...OBS, unresolvedDecisions: [] }, { bucket: "month" }).correction_rate.caveatCodes).toEqual(["no-review-coverage"]);
  });

  it("gives the coverage caveat its code, and the panel's English note is the caveat", () => {
    const coverage = computePanelCoverage([], []);
    expect(coverage.caveatCode).toBe("reviewed-is-deliberate");
    expect(notes["reviewed-is-deliberate"]).toBe(coverage.caveat);
  });
});
```

`web/tests/metricsNotes.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §3.4, §6.10: a metrics sentence whose code this panel knows is shown in the reader's language; one whose
 * code it does not know (a newer server), or that has no code, is shown as the server sent it -- never as a key.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";
import { MetricsView } from "../src/MetricsView.js";
import type { MetricsNoteCode, MetricsReport, PanelCoverage } from "../src/types.js";

const UNKNOWN = "a-code-this-panel-does-not-know" as unknown as MetricsNoteCode;
const KNOWN_SENTENCE = "the server's sentence beside the known code";
const UNKNOWN_SENTENCE = "the server's sentence beside the unknown code";
const report: MetricsReport = {
  as_of: "2026-10-01T00:00:00.000Z", as_of_mode: "wall_clock", repos: [],
  correction_rate: {
    numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0,
    by_decision_kind: [], buckets: [], caveats: [KNOWN_SENTENCE, UNKNOWN_SENTENCE], caveatCodes: ["no-review-coverage", UNKNOWN],
  },
  repair_rate: {
    numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null,
    stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "the server's bias sentence", knownBiasCode: "stale-bias" },
    buckets: [], caveats: ["the server's repair sentence, no code"],
  },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [],
  review_coverage: { available: false, reason: "the server's reason sentence", reasonCode: "no-review-coverage" },
  excluded_as_future: 0, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [],
};
const coverage: PanelCoverage = { reviewed_high_tier: 1, high_tier_total: 4, rate: 0.25, caveat: "the server's coverage sentence", caveatCode: "reviewed-is-deliberate" };

afterEach(cleanup);

describe("metrics notes in the reader's language (spec §6.10)", () => {
  it("shows a known code's note in Chinese, and the server's sentence for an unknown code or none", async () => {
    await i18n.changeLanguage("zh");
    const text = render(<MetricsView report={report} coverage={coverage} />).container.textContent ?? "";
    expect(text).toContain(zh.metrics.note["no-review-coverage"]);
    expect(text).toContain(zh.metrics.note["stale-bias"]);
    expect(text).toContain(zh.metrics.note["reviewed-is-deliberate"]);
    expect(text).toContain(UNKNOWN_SENTENCE);
    expect(text).toContain("the server's repair sentence, no code");
    expect(text).not.toContain(KNOWN_SENTENCE);
    expect(text).not.toContain("metrics.note");
    expect(text).toContain("纠正率");
  });

  it("shows a known code's English note in English, and the server's sentence for an unknown code", () => {
    const text = render(<MetricsView report={report} coverage={coverage} />).container.textContent ?? "";
    expect(text).toContain(en.metrics.note["no-review-coverage"]);
    expect(text).toContain(UNKNOWN_SENTENCE);
    expect(text).toContain("Correction rate");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/metrics/noteCodes.test.ts > "$SCRATCH/t4-red-root.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/metricsNotes.test.tsx) > "$SCRATCH/t4-red-web.txt" 2>&1; echo rc=$?
```
Expected both `rc=1` (no `caveatCodes`; `en.metrics` undefined; web type import `MetricsNoteCode` missing → the file fails to load).

- [ ] **Step 3: Implement**

`src/metrics/types.ts` — before `export interface CorrectionRate` add:
```ts
/**
 * Panel i18n spec §3.4: the stable code beside each sentence the metrics carry, so the panel can show the note in the
 * reader's language. The sentences stay: the CLI prints them.
 */
export type MetricsNoteCode = "no-review-coverage" | "unresolved-decisions" | "stale-bias";
```
In `CorrectionRate`, after `caveats: string[];` add `/** Index for index with caveats (panel i18n spec §3.4). */` and `caveatCodes: MetricsNoteCode[];`. In `RepairRate.stale_only`, after `known_bias: string;` add `knownBiasCode: MetricsNoteCode;`; after `RepairRate`'s `caveats: string[];` add `/** Index for index with caveats (panel i18n spec §3.4). */` and `caveatCodes: MetricsNoteCode[];`. In `ReviewCoverage`, after `reason: string;` add `reasonCode: MetricsNoteCode;`.

`src/metrics/compute.ts`: add `MetricsNoteCode,` to the type import from `./types.js`. Lines 127-128 become:
```ts
  const correctionCaveats = [NO_REVIEW_COVERAGE];
  // Panel i18n spec §3.4: a stable code beside each sentence, index for index; the sentences stay for the CLI.
  const correctionCaveatCodes: MetricsNoteCode[] = ["no-review-coverage"];
  if (obs.unresolvedDecisions.length > 0) {
    correctionCaveats.push(UNRESOLVED_CAVEAT);
    correctionCaveatCodes.push("unresolved-decisions");
  }
```
`caveats: correctionCaveats,` (in `correction_rate`) → `caveats: correctionCaveats,` followed by `caveatCodes: correctionCaveatCodes,`; `known_bias: STALE_BIAS,` → followed by `knownBiasCode: "stale-bias",`; `caveats: [NO_REVIEW_COVERAGE],` (in `repair_rate`) → followed by `caveatCodes: ["no-review-coverage"],`; line 230 → `review_coverage: { available: false, reason: NO_REVIEW_COVERAGE, reasonCode: "no-review-coverage" },`.

`src/panel/coverage.ts`: in `PanelCoverage` after `caveat: string;` add `/** Panel i18n spec §3.4: the caveat's stable code. */` and `caveatCode: "reviewed-is-deliberate";`; in `computePanelCoverage`'s return, after the `caveat:` string (line 55) add `caveatCode: "reviewed-is-deliberate",`.

`web/src/types.ts`: before `export interface CorrectionRateSlice` add
```ts
/** Mirrors src/metrics/types.ts's MetricsNoteCode (panel i18n spec §3.4). */
export type MetricsNoteCode = "no-review-coverage" | "unresolved-decisions" | "stale-bias";
```
and, each marked `// Panel i18n spec §3.4: optional here so literal fixtures need no edit; the server always sends it.`: `CorrectionRate.caveatCodes?: MetricsNoteCode[];`, `RepairRate.stale_only.knownBiasCode?: MetricsNoteCode;`, `RepairRate.caveatCodes?: MetricsNoteCode[];`, `ReviewCoverage.reasonCode?: MetricsNoteCode;`, `PanelCoverage.caveatCode?: "reviewed-is-deliberate";`.

`web/src/locales/en.ts`: add `import type { MetricsNoteCode } from "../types.js";` and, before `export const en`,
```ts
// Panel i18n spec §3.4: each English note is the server's sentence byte for byte (tests/metrics/noteCodes.test.ts).
const metricsNote = {
  "no-review-coverage": "review coverage has no data: its only producer is the panel (E2 spec §3.5), and A' §4.4 says the correction rate must never be read on its own",
  "unresolved-decisions": "some corrections point at decisions outside what was scanned (see unresolved_decisions); they count in the totals but sit in no decision-kind bucket",
  "stale-bias": "systematically low: closing a stale correction requires the chose_instead field (CLI flag --chose-instead) that corrections/schema.ts says a stale may not have (E2 spec §3.2.1, A' ERRATUM 3)",
  "reviewed-is-deliberate": "`reviewed` is a deliberate act, so this number can sit near zero for a long time -- and a long-zero coverage is not distinguishable from nobody looking. Read it with the backlog, not on its own.",
} as const satisfies Record<MetricsNoteCode | "reviewed-is-deliberate", string>;
```
and in `en`, after `loopPlan`:
```ts
  metrics: {
    unknownRate: "unknown",
    correctionRate: "Correction rate",
    repairRate: "Repair rate",
    reviewCoverage: "Review coverage",
    unresolvedTitle: "Unresolved decisions",
    unresolvedCount: "Unresolved decisions: {{n}}",
    malformedTitle: "Malformed lines",
    malformedCount: "Malformed lines: {{n}}",
    futureTitle: "Excluded as future",
    futureCount: "Excluded as future: {{n}}",
    note: metricsNote,
  },
```
`web/src/locales/zh.ts`, after `loopPlan`:
```ts
  metrics: {
    unknownRate: "未知",
    correctionRate: "纠正率",
    repairRate: "修复率",
    reviewCoverage: "评审覆盖率",
    unresolvedTitle: "未解析的决策",
    unresolvedCount: "未解析的决策：{{n}}",
    malformedTitle: "格式错误的行",
    malformedCount: "格式错误的行：{{n}}",
    futureTitle: "因日期在未来而排除",
    futureCount: "因日期在未来而排除：{{n}}",
    note: {
      "no-review-coverage": "评审覆盖率没有数据：它唯一的来源是面板（E2 spec §3.5），而 A' §4.4 规定纠正率绝不能单独解读",
      "unresolved-decisions": "有些纠正指向的决策不在扫描范围内（见 unresolved_decisions）；它们计入总数，但不属于任何决策类型分组",
      "stale-bias": "系统性偏低：关闭一条 stale 纠正需要 chose_instead 字段（CLI 参数 --chose-instead），而 corrections/schema.ts 规定 stale 不能带它（E2 spec §3.2.1，A' ERRATUM 3）",
      "reviewed-is-deliberate": "`reviewed` 是一个有意的动作，所以这个数字可能长时间接近零——而长期为零的覆盖率与没人看无法区分。请结合积压一起看，不要单独看。",
    },
  },
```

`web/src/MetricsView.tsx` (keep the header comment; replace from the imports to the end):
```tsx
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n.js";
import { en } from "./locales/en.js";
import type { MetricsReport, PanelCoverage } from "./types.js";

/** The one literal the null-rate branch prints (task 8 ruling K4), in English; the render uses the reader's language. */
export const UNKNOWN_RATE = en.metrics.unknownRate;

/** Formats what it is given. It does not divide anything. */
function formatRate(rate: number | null): string {
  return rate === null ? i18n.t("metrics.unknownRate") : `${(rate * 100).toFixed(0)}%`;
}

/** Panel i18n spec §3.4: a metrics sentence in the reader's language when its code is known here, else as the server sent it. */
function noteText(sentence: string, code: string | undefined): string {
  const key = `metrics.note.${code ?? ""}`;
  return code !== undefined && i18n.exists(key) ? (i18n.t(key as never) as string) : sentence;
}

export function MetricsView({ report, coverage }: { report: MetricsReport; coverage: PanelCoverage }): JSX.Element {
  const { t } = useTranslation();
  return (
    <section>
      <h2>{t("metrics.correctionRate")}</h2>
      <p data-testid="correction-rate">{formatRate(report.correction_rate.rate_excluding_stale)}</p>
      <ul className="caveats" data-testid="correction-rate-caveats">
        {report.correction_rate.caveats.map((caveat, index) => (
          <li key={caveat}>{noteText(caveat, report.correction_rate.caveatCodes?.[index])}</li>
        ))}
      </ul>

      <h2>{t("metrics.repairRate")}</h2>
      <p data-testid="repair-rate">{formatRate(report.repair_rate.rate)}</p>
      <ul className="caveats" data-testid="repair-rate-caveats">
        {report.repair_rate.caveats.map((caveat, index) => (
          <li key={caveat}>{noteText(caveat, report.repair_rate.caveatCodes?.[index])}</li>
        ))}
      </ul>
      <p className="stale-bias" data-testid="stale-bias">
        {noteText(report.repair_rate.stale_only.known_bias, report.repair_rate.stale_only.knownBiasCode)}
      </p>

      <h2>{t("metrics.reviewCoverage")}</h2>
      <p className="caveat" data-testid="review-coverage-reason">
        {noteText(report.review_coverage.reason, report.review_coverage.reasonCode)}
      </p>
      <p data-testid="panel-coverage-rate">{formatRate(coverage.rate)}</p>
      <p className="caveat" data-testid="panel-coverage-caveat">
        {noteText(coverage.caveat, coverage.caveatCode)}
      </p>

      <h2>{t("metrics.unresolvedTitle")}</h2>
      <p data-testid="unresolved-count">{t("metrics.unresolvedCount", { n: report.unresolved_decisions.length })}</p>

      <h2>{t("metrics.malformedTitle")}</h2>
      <p data-testid="malformed-count">{t("metrics.malformedCount", { n: report.malformed_lines.length })}</p>

      <h2>{t("metrics.futureTitle")}</h2>
      <p data-testid="excluded-as-future">{t("metrics.futureCount", { n: report.excluded_as_future })}</p>
    </section>
  );
}
```

**Existing criteria rewritten (spec §6.1 "Any criterion pinning the exact metrics or coverage JSON (additive fields)", H18):**

- `tests/fixtures/metrics/golden.json` (the expected bytes of `tests/metrics/cli.test.ts` "matches the golden byte for byte"; drafter finding F8). Four insertions, every other byte unchanged:
  - line 79 `    ]` (end of `correction_rate.caveats`) → the five lines
    ```
        ],
        "caveatCodes": [
          "no-review-coverage",
          "unresolved-decisions"
        ]
    ```
  - line 89 (`      "known_bias": "systematically low: …"`) gains a trailing `,` and is followed by `      "knownBiasCode": "stale-bias"`
  - line 109 `    ]` (end of `repair_rate.caveats`) → the four lines
    ```
        ],
        "caveatCodes": [
          "no-review-coverage"
        ]
    ```
  - line 159 (`    "reason": "review coverage has no data: …"`) gains a trailing `,` and is followed by `    "reasonCode": "no-review-coverage"`
- `tests/panel/webParity.test.ts:116-118` and `:122-124` (compile-time mutual assignability; drafter finding F12) become:
  ```ts
  // Rewritten under human ruling H18 (2026-10-01) for panel i18n: the metrics note codes are optional on the Web side so
  // literal fixtures need no edit (spec §3.4); an absent code is normalised here, so the rest is still checked both ways.
  function reportWebToServer(x: WebMetricsReport): ServerMetricsReport {
    return {
      ...x,
      correction_rate: { ...x.correction_rate, caveatCodes: x.correction_rate.caveatCodes ?? [] },
      repair_rate: {
        ...x.repair_rate,
        caveatCodes: x.repair_rate.caveatCodes ?? [],
        stale_only: { ...x.repair_rate.stale_only, knownBiasCode: x.repair_rate.stale_only.knownBiasCode ?? "stale-bias" },
      },
      review_coverage: { ...x.review_coverage, reasonCode: x.review_coverage.reasonCode ?? "no-review-coverage" },
    };
  }
  ```
  and
  ```ts
  function coverageWebToServer(x: WebPanelCoverage): ServerPanelCoverage {
    return { ...x, caveatCode: x.caveatCode ?? "reviewed-is-deliberate" };
  }
  ```

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/metrics tests/panel/webParity.test.ts tests/panel/metricsApi.test.ts tests/panel/compactClassify.test.ts tests/panel/coverageDuplicates.test.ts > "$SCRATCH/t4-green-root.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t4-tsc.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t4-web-check.txt" 2>&1; echo rc=$?
```
Expected all `rc=0` (`web/tests/metricsView.test.tsx` unmodified and green: its fixture carries no codes, so it shows the sentences).

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t4`; files: every file of this Task)
  - MT4-1 unresolved code missing: delete `correctionCaveatCodes.push("unresolved-decisions");`. Red: `noteCodes … > puts a code beside each sentence …`.
  - MT4-2 wrong code for the bias: `knownBiasCode: "stale-bias"` → `knownBiasCode: "no-review-coverage"`. Red: same test (the note is not the sentence).
  - MT4-3 English note drifts: in `en.ts`, `"stale-bias"`'s value loses its last character. Red: same test.
  - MT4-4 coverage code missing: in `coverage.ts` delete `caveatCode: "reviewed-is-deliberate",` and the interface line. Red: `noteCodes … > gives the coverage caveat its code …`.
  - MT4-5 codes ignored by the panel: `noteText` body → `return sentence;`. Red: `metricsNotes … > shows a known code's note in Chinese …`.
  - MT4-6 unknown code shown as a key: `noteText` body → `return code !== undefined ? (i18n.t(\`metrics.note.${code}\` as never) as string) : sentence;`. Red: same test (`metrics.note.a-code-…` appears; `UNKNOWN_SENTENCE` missing).
  - MT4-7 index mismatch: `report.correction_rate.caveatCodes?.[index]` → `report.correction_rate.caveatCodes?.[0]`. Red: same test (the unknown code's sentence is replaced by the known note).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/metrics/types.ts src/metrics/compute.ts src/panel/coverage.ts web/src/types.ts web/src/MetricsView.tsx web/src/locales/en.ts web/src/locales/zh.ts tests/metrics/noteCodes.test.ts web/tests/metricsNotes.test.tsx tests/fixtures/metrics/golden.json tests/panel/webParity.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(metrics): give each metrics sentence a stable code the panel can translate

Correction and repair caveats, the stale bias and the review-coverage reason
carry codes beside their sentences (index for index); the coverage caveat has
one too. The sentences stay for the CLI; the golden JSON gains the four fields
(human ruling H18). The metrics area shows the note for a known code in the
reader's language and the server's sentence otherwise.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

